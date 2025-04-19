const puppeteer = require('puppeteer');
require('dotenv').config();
const fs = require('fs');
const util = require('util');
const logFile = fs.createWriteStream('booking.log', { flags: 'a' });
const originalLog = console.log;
console.log = (...args) => {
  const msg = util.format(...args) + '\n';
  logFile.write(msg);
  originalLog(...args);
};
const originalError = console.error;
console.error = (...args) => {
  const msg = util.format(...args) + '\n';
  logFile.write(msg);
  originalError(...args);
};
const schedule  = require('node-schedule');
let args = process.argv.slice(2);
const isTest = args.includes('--test');
if (isTest) {
  // remove the test flag so it doesn't interfere with the rest of the args
  args = args.filter(a => a !== '--test');
}
const clubSlug      = args[0];
const targetDateISO = args[1];
const targetTime    = args[2];
const targetClass   = args.slice(3).join(' ').toLowerCase();

if (!clubSlug || !targetDateISO || !targetTime || !targetClass) {
  console.error('Usage: node index.js <clubSlug> <yyyy-mm-dd> <HH:MM> <className>');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
//  Scheduling: calculate when the class booking opens
//   (7 days before + 5 minutes after class end; assumes 45 min duration)
const [hour, minute] = targetTime.split(':').map(Number);
const classStart   = new Date(`${targetDateISO}T${targetTime}:00`);
const classEnd     = new Date(classStart.getTime() + 45 * 60000);
let bookingOpenTime = new Date(classEnd.getTime() - 7 * 24 * 60 * 60000 + 5 * 60000);
if (isTest) {
  // schedule test run 10 seconds from now
  console.log('⚙️  Test mode: overriding bookingOpenTime to 10s from now');
  bookingOpenTime = new Date(Date.now() + 10000);
}

if (new Date() < bookingOpenTime) {
  schedule.scheduleJob(bookingOpenTime, runBooking);
  console.log(`Booking scheduled for ${bookingOpenTime}`);
    // prevent process from exiting before scheduled job runs
    process.stdin.resume();
  // Keep the process alive for the scheduled booking
  return;
}
// ──────────────────────────────────────────────────────────────

async function runBooking() {
  try {
    const browser = await puppeteer.launch({
      headless: "new",           // run in modern headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--start-maximized'
      ],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    
    // ──────────────────────────────────────────────────────────────
    //  Helper: auto‑scroll until the page stops growing
    // ──────────────────────────────────────────────────────────────
    async function autoScroll(page) {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          const scrollEl =
            document.querySelector('.va__accordion') || // main timetable list
            document.scrollingElement ||                // fallback
            document.body;

          let lastHeight = 0;
          let unchanged  = 0;
          const distance = 600;  // px per scroll
          const delay    = 800;  // ms between scrolls

          const timer = setInterval(() => {
            scrollEl.scrollBy(0, distance);

            const { scrollHeight } = scrollEl;
            if (scrollHeight === lastHeight) {
              unchanged += 1;
              if (unchanged >= 5) {
                clearInterval(timer);
                resolve();
              }
            } else {
              unchanged  = 0;
              lastHeight = scrollHeight;
            }
          }, delay);
        });
      });
    }

    // ──────────────────────────────────────────────────────────────
    //  Helper: click the horizontal date tab that matches the target
    //  yyyy‑mm‑dd (e.g. "2025-04-19") so we’re sure we’re on the
    //  correct day even if the bar has scrolled sideways.
    // ──────────────────────────────────────────────────────────────
    async function selectDateTab(page, targetDateISO) {
      await page.evaluate((targetDateISO) => {
        const dateEl = Array.from(document.querySelectorAll('[datetime]'))
          .find(el => el.getAttribute('datetime') === targetDateISO);

        if (dateEl) {
          const clickable = dateEl.closest('button, a, div') || dateEl;
          clickable.click();
        }
      }, targetDateISO);

      await page.waitForTimeout(1500);
    }

    console.log('Navigating to login page...');
    await page.goto('https://www.virginactive.co.uk/login', { waitUntil: 'networkidle2' });

    console.log('Checking for cookie banner...');
    try {
      await page.waitForSelector('button', { timeout: 5000 });

      const accepted = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const acceptButton = buttons.find(btn => btn.textContent?.toLowerCase().includes('accept all cookies'));
        if (acceptButton) {
          acceptButton.click();
          return true;
        }
        return false;
      });

      if (accepted) {
        console.log('Accepted cookies.');
        await page.waitForTimeout(1000);
      } else {
        console.log('No "accept all cookies" button found.');
      }
    } catch (err) {
      console.log('Error checking or clicking cookie banner:', err);
    }
    console.log('Filling in login form...');
    await page.waitForSelector('#UserName', { timeout: 10000 });
    await page.type('#UserName', process.env.VA_USER, { delay: 100 });
    await page.type('#Password', process.env.VA_PASS, { delay: 100 });
    await page.waitForTimeout(1000);

    console.log('Clicking login button...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    console.log('Waiting for post-login content...');
    try {
      await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });
      console.log('✅ Login successful.');
    } catch (e) {
      console.error('❌ Login likely failed or took too long.');
      const content = await page.content();
      console.log('Page content snapshot:\n', content.slice(0, 1000));
    }

    // -------- desired day --------------------------------------------------
    const timetableUrl  = `https://www.virginactive.co.uk/clubs/${clubSlug}/timetable?activeDay=${targetDateISO}`;
    // -----------------------------------------------------------------------

    console.log(`Navigating to class timetable: ${timetableUrl}`);
    await page.goto(timetableUrl, { waitUntil: 'networkidle2' });
    
    await selectDateTab(page, targetDateISO);

    await page.waitForTimeout(20000);
    
    await page.waitForTimeout(8000);
    // ──────────────────────────────────────────────────────────────
    //  Collect every row in the timetable (after fully auto‑scrolling)
    // ──────────────────────────────────────────────────────────────
    await page.waitForSelector('dt.va__accordion-section', { timeout: 20000 });
    await autoScroll(page);

    await page.waitForTimeout(5000);
    await autoScroll(page);

    const allClasses = await page.evaluate((targetDateISO) => {
      const collected = new Set();
      const out       = [];

      document.querySelectorAll('dt.va__accordion-section').forEach(dt => {
        const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
          ?.getAttribute('datetime') || '';
      
        if (rowDate !== targetDateISO) return;
        if (dt.getAttribute('aria-expanded') === 'false') {
          (dt.querySelector('.va__accordion-title') || dt).click();
        }

        const timeTxt =
          dt.querySelector('.class-timetable__class-time time')?.textContent
            .trim()
            .toLowerCase() || 'unknown time';

        dt.querySelectorAll('.class-timetable__class-title').forEach(t => {
          const titleTxt = t.textContent.trim().toLowerCase() || 'unknown class';
          const key      = `${timeTxt} - ${titleTxt}`;
          if (!collected.has(key)) {
            collected.add(key);
            out.push(key);
          }
        });
      });

      return out;
    }, targetDateISO);

    console.log(`🧮 Classes harvested: ${allClasses.length}`);
    allClasses.forEach(cls => console.log(`  - ${cls}`));
    
    // Wait 5 seconds before continuing with the 18:45 search/debug logic
    await page.waitForTimeout(5000);

    // Give the page 5 seconds to settle (lazy‑loading, animations, etc.)
    await page.waitForTimeout(5000);

    console.log('📋 Searching for 18:45 Pilates Athletic class...');

    const clicked = await page.evaluate((targetDateISO, TARGET_TIME, TARGET_CLASS) => {
      const targetRow = Array.from(
        document.querySelectorAll('dt.va__accordion-section')
      ).find(dt => {
        const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
          ?.getAttribute('datetime') || '';
        if (rowDate !== targetDateISO) return false;

        const timeTxt =
          dt.querySelector('.class-timetable__class-time time')?.textContent
            .trim()
            .toLowerCase() ?? '';
        if (!timeTxt.startsWith(TARGET_TIME)) return false;

        const titles = Array.from(
          dt.querySelectorAll('.class-timetable__class-title')
        ).map(t => t.textContent.trim().toLowerCase());

        return titles.includes(TARGET_CLASS);
      });

      if (!targetRow) return 'row-not-found';

      const button =
        targetRow.querySelector(
          'button.class-timetable__book-button--available, button.class-timetable__book-button--waitlist'
        );

      if (!button) return 'button-not-found';

      button.click();
      return button.classList.contains('class-timetable__book-button--available')
        ? 'book-clicked'
        : 'waitlist-clicked';
    }, targetDateISO, targetTime, targetClass);

    switch (clicked) {
      case 'book-clicked':
        console.log('✅ 18:45 Pilates Athletic – Book button clicked.');
        break;
      case 'waitlist-clicked':
        console.log('ℹ️ 18:45 Pilates Athletic found – joined the waitlist.');
        break;
      case 'button-not-found':
        console.log('❌ 18:45 Pilates Athletic row found, but no Book/Waitlist button present.');
        break;
      case 'row-not-found':
      default:
        console.log('❌ Couldn’t find any 18:45 Pilates Athletic row.');
    }

    await browser.close();
  } catch (err) {
    console.error('Unhandled error in script:', err);
  }
}

runBooking();
