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

const schedule = require('node-schedule');

// simple sleep helper in lieu of page.waitForTimeout()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (require.main === module) {
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
  //   (7 days before + 5 minutes after class end; assumes 45 min duration)
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
    return;
  }
  // ──────────────────────────────────────────────────────────────
}

async function runBooking() {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
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
            document.querySelector('.va__accordion') ||
            document.scrollingElement ||
            document.body;

          let lastHeight = 0;
          let unchanged  = 0;
          const distance = 600;
          const delay    = 800;

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

      await sleep(10000);
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
        await sleep(10000);
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
    await sleep(10000);

    console.log('Clicking login button...');
    await page.click('button[type="submit"]');
    await sleep(10000);

    console.log('Waiting for post-login content...');
    try {
      await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });
      console.log('✅ Login successful.');
    } catch (e) {
      console.error('❌ Login likely failed or took too long.');
      const content = await page.content();
      console.log('Page content snapshot:\n', content.slice(0, 1000));
    }

    const timetableUrl = `https://www.virginactive.co.uk/clubs/${clubSlug}/timetable?activeDay=${targetDateISO}`;
    console.log(`Navigating to class timetable: ${timetableUrl}`);
    await page.goto(timetableUrl, { waitUntil: 'networkidle2' });
    
    await selectDateTab(page, targetDateISO);
    await sleep(20000);

    await page.waitForSelector('dt.va__accordion-section', { timeout: 20000 });
    await autoScroll(page);
    await sleep(5000);
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

        const timeTxt = dt.querySelector('.class-timetable__class-time time')
          ?.textContent.trim().toLowerCase() || 'unknown time';

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

    await sleep(5000);

    console.log('📋 Searching for target class...');
    // …remaining booking logic…
    await browser.close();
  } catch (err) {
    console.error('🔴 Unhandled error in script:\n', err.stack || err);
  }
}

module.exports = {
  scheduleBooking: async (club, date, time, className) => {
    // …existing scheduling wrapper…
    if (new Date() < bookingOpenTime) {
      schedule.scheduleJob(bookingOpenTime, runBooking);
      console.log(`Booking scheduled for ${bookingOpenTime}`);
      return bookingOpenTime;
    }
    await runBooking();
    return new Date();
  }
};
