// index.js
const puppeteer = require('puppeteer');
require('dotenv').config();
const fs = require('fs');
const util = require('util');
const logFile = fs.createWriteStream('booking.log', { flags: 'a' });

// Pipe console.log and console.error into booking.log as well as stdout/stderr
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

  // Calculate booking time (7 days before + 5 min after class end, 45 min class)
  const classStart   = new Date(`${targetDateISO}T${targetTime}:00`);
  const classEnd     = new Date(classStart.getTime() + 45 * 60000);
  let bookingOpenTime = new Date(classEnd.getTime() - 7 * 24 * 60 * 60000 + 5 * 60000);

  if (isTest) {
    console.log('⚙️  Test mode: overriding bookingOpenTime to 10s from now');
    bookingOpenTime = new Date(Date.now() + 10000);
  }

  if (new Date() < bookingOpenTime) {
    schedule.scheduleJob(bookingOpenTime, runBooking);
    console.log(`Booking scheduled for ${bookingOpenTime}`);
    process.stdin.resume(); // keep alive until job runs
    return;
  }
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

    // Helper: auto‑scroll until the page stops growing
    async function autoScroll(page) {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          const scrollEl =
            document.querySelector('.va__accordion') ||
            document.scrollingElement ||
            document.body;

          let lastHeight = 0, unchanged = 0;
          const distance = 600, delay = 800;
          const timer = setInterval(() => {
            scrollEl.scrollBy(0, distance);
            const { scrollHeight } = scrollEl;
            if (scrollHeight === lastHeight) {
              if (++unchanged >= 5) {
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

    // Helper: click the date tab for the target date
    async function selectDateTab(page, targetDateISO) {
      await page.evaluate((d) => {
        const el = Array.from(document.querySelectorAll('[datetime]'))
          .find(e => e.getAttribute('datetime') === d);
        if (el) (el.closest('button, a, div') || el).click();
      }, targetDateISO);
      await new Promise(res => setTimeout(res, 10000));
    }

    console.log('Navigating to login page...');
    await page.goto('https://www.virginactive.co.uk/login', { waitUntil: 'networkidle2' });

    console.log('Checking for cookie banner...');
    try {
      await page.waitForSelector('button', { timeout: 5000 });
      const accepted = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const accept = btns.find(b => b.textContent?.toLowerCase().includes('accept all cookies'));
        if (accept) { accept.click(); return true; }
        return false;
      });
      console.log(accepted ? 'Accepted cookies.' : 'No cookie banner found.');
    } catch (e) {
      console.log('Error handling cookie banner:', e);
    }

    console.log('Filling in login form...');
    await page.waitForSelector('#UserName', { timeout: 10000 });
    await page.type('#UserName', process.env.VA_USER, { delay: 100 });
    await page.type('#Password', process.env.VA_PASS, { delay: 100 });
    await new Promise(res => setTimeout(res, 10000));

    console.log('Clicking login button...');
    await page.click('button[type="submit"]');
    await new Promise(res => setTimeout(res, 10000));

    console.log('Waiting for post-login content...');
    try {
      await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });
      console.log('✅ Login successful.');
    } catch (e) {
      console.error('❌ Login failed or timed out.');
      console.log('Page snapshot:', (await page.content()).slice(0, 1000));
    }

    const timetableUrl = `https://www.virginactive.co.uk/clubs/${clubSlug}/timetable?activeDay=${targetDateISO}`;
    console.log(`Navigating to timetable: ${timetableUrl}`);
    await page.goto(timetableUrl, { waitUntil: 'networkidle2' });
    await selectDateTab(page, targetDateISO);

    // Give the page time to load completely
    await new Promise(res => setTimeout(res, 10000));

    await page.waitForSelector('dt.va__accordion-section', { timeout: 20000 });
    await autoScroll(page);
    await new Promise(res => setTimeout(res, 10000));

    // Harvest the class rows
    const allClasses = await page.evaluate((d) => {
      const seen = new Set(), out = [];
      document.querySelectorAll('dt.va__accordion-section').forEach(dt => {
        const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
          ?.getAttribute('datetime') || '';
        if (rowDate !== d) return;
        if (dt.getAttribute('aria-expanded') === 'false') (dt.querySelector('.va__accordion-title') || dt).click();
        const timeTxt = dt.querySelector('.class-timetable__class-time time')
          ?.textContent.trim().toLowerCase() || 'unknown';
        dt.querySelectorAll('.class-timetable__class-title').forEach(t => {
          const title = t.textContent.trim().toLowerCase();
          const key = `${timeTxt} - ${title}`;
          if (!seen.has(key)) { seen.add(key); out.push(key); }
        });
      });
      return out;
    }, targetDateISO);

    console.log(`🧮 Classes harvested: ${allClasses.length}`);
    allClasses.forEach(c => console.log(`  - ${c}`));

    // Pause before the book/search step
    await new Promise(res => setTimeout(res, 10000));

    console.log('📋 Searching for', targetTime, targetClass);
    const clicked = await page.evaluate(
      ({ d, t, c }) => {
        const row = Array.from(document.querySelectorAll('dt.va__accordion-section'))
          .find(dt => {
            if (dt.querySelector('.class-timetable-panel__class-date time')?.getAttribute('datetime') !== d) return false;
            const timeTxt = dt.querySelector('.class-timetable__class-time time')?.textContent.trim().toLowerCase() || '';
            if (!timeTxt.startsWith(t)) return false;
            const titles = Array.from(dt.querySelectorAll('.class-timetable__class-title'))
              .map(el => el.textContent.trim().toLowerCase());
            return titles.includes(c);
          });
        if (!row) return 'row-not-found';
        const btn = row.querySelector('button.class-timetable__book-button--available, button.class-timetable__book-button--waitlist');
        if (!btn) return 'button-not-found';
        btn.click();
        return btn.classList.contains('class-timetable__book-button--available') ? 'book-clicked' : 'waitlist-clicked';
      },
      { d: targetDateISO, t: targetTime, c: targetClass }
    );

    console.log(`Result: ${clicked}`);
    await browser.close();
  } catch (err) {
    console.error('🔴 Unhandled error in script:\n', err.stack || err);
  }
}

module.exports = {
  scheduleBooking: async (club, date, time, className) => {
    const isTest = process.argv.includes('--test');
    const [clubSlug, targetDateISO, targetTime, ...rest] = [club, date, time, ...className.split(' ')];
    const targetClass = className.toLowerCase();

    // Calculate booking time
    const classStart = new Date(`${targetDateISO}T${targetTime}:00`);
    const classEnd   = new Date(classStart.getTime() + 45 * 60000);
    let bookingOpenTime = new Date(classEnd.getTime() - 7 * 24 * 60 * 60000 + 5 * 60000);
    if (isTest) {
      console.log('⚙️  Test mode: overriding bookingOpenTime to 10s from now');
      bookingOpenTime = new Date(Date.now() + 10000);
    }

    if (new Date() < bookingOpenTime) {
      schedule.scheduleJob(bookingOpenTime, runBooking);
      console.log(`Booking scheduled for ${bookingOpenTime}`);
      return bookingOpenTime;
    }

    await runBooking();
    return new Date();
  }
};
