// index.js
require('dotenv').config();
const puppeteer = require('puppeteer');
const schedule  = require('node-schedule');

/**
 * Kick off a booking run immediately (or when scheduled).
 */
async function runBooking(clubSlug, targetDateISO, targetTime, targetClass) {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: 'chromium',
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
    page.setDefaultNavigationTimeout(60000);

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
              unchanged = 0;
              lastHeight = scrollHeight;
            }
          }, delay);
        });
      });
    }

    // Helper: pick the correct date tab
    async function selectDateTab(page, targetDateISO) {
      await page.evaluate((d) => {
        const el = Array.from(document.querySelectorAll('[datetime]'))
          .find(x => x.getAttribute('datetime') === d);
        if (el) (el.closest('button, a, div') || el).click();
      }, targetDateISO);
      await page.waitForTimeout(1500);
    }

    // 1) Login
    await page.goto('https://www.virginactive.co.uk/login', { waitUntil: 'networkidle2' });
    try {
      const accepted = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent.toLowerCase().includes('accept all cookies'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (accepted) await page.waitForTimeout(1000);
    } catch {}
    await page.type('#UserName', process.env.VA_USER, { delay: 100 });
    await page.type('#Password', process.env.VA_PASS, { delay: 100 });
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });

    // 2) Navigate to timetable
    const url = `https://www.virginactive.co.uk/clubs/${clubSlug}/timetable?activeDay=${targetDateISO}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await selectDateTab(page, targetDateISO);
    await page.waitForTimeout(20000);

    // 3) Harvest and click
    await page.waitForSelector('dt.va__accordion-section', { timeout: 20000 });
    await autoScroll(page);
    await page.waitForTimeout(5000);
    await autoScroll(page);

    // find & click
    const clicked = await page.evaluate((d, T, C) => {
      const dt = Array.from(document.querySelectorAll('dt.va__accordion-section'))
        .find(el => {
          if (el.querySelector('.class-timetable-panel__class-date time')?.getAttribute('datetime') !== d)
            return false;
          const t = el.querySelector('.class-timetable__class-time time')?.textContent.trim().toLowerCase() || '';
          if (!t.startsWith(T)) return false;
          const titles = Array.from(el.querySelectorAll('.class-timetable__class-title'))
            .map(x => x.textContent.trim().toLowerCase());
          return titles.includes(C);
        });
      if (!dt) return 'row-not-found';
      const btn = dt.querySelector(
        'button.class-timetable__book-button--available, button.class-timetable__book-button--waitlist'
      );
      if (!btn) return 'button-not-found';
      btn.click();
      return btn.classList.contains('class-timetable__book-button--available')
        ? 'book-clicked' : 'waitlist-clicked';
    }, targetDateISO, targetTime, targetClass);

    console.log({ result: clicked });
    await browser.close();
  } catch (err) {
    console.error('Booking error:', err);
  }
}

/**
 * Schedule a booking job 7 days before + 5min after end.
 * @returns {Date} the time it was scheduled for
 */
function scheduleBooking(clubSlug, targetDateISO, targetTime, targetClass, isTest = false) {
  // parse
  const [h, m] = targetTime.split(':').map(Number);
  const classStart = new Date(`${targetDateISO}T${targetTime}:00`);
  const classEnd   = new Date(classStart.getTime() + 45 * 60000);
  let bookingOpenTime = new Date(classEnd.getTime() - 7 * 24*60*60000 + 5*60000);

  if (isTest) {
    console.log('⚙️ Test mode: booking in 10s');
    bookingOpenTime = new Date(Date.now() + 10_000);
  }

  if (new Date() < bookingOpenTime) {
    schedule.scheduleJob(bookingOpenTime, () =>
      runBooking(clubSlug, targetDateISO, targetTime, targetClass)
    );
    console.log(`✅ Scheduled booking for ${bookingOpenTime.toString()}`);
    return bookingOpenTime;
  } else {
    // if it's already past, fire immediately
    runBooking(clubSlug, targetDateISO, targetTime, targetClass);
    return new Date();
  }
}

// CLI entry‐point
if (require.main === module) {
  const argv = process.argv.slice(2);
  const isTest = argv.includes('--test');
  const args   = argv.filter(a => a !== '--test');
  const [clubSlug, date, time, ...rest] = args;
  const className = rest.join(' ').toLowerCase();
  if (!clubSlug || !date || !time || !className) {
    console.error('Usage: node index.js <clubSlug> <yyyy-mm-dd> <HH:MM> <className> [--test]');
    process.exit(1);
  }
  scheduleBooking(clubSlug, date, time, className, isTest);
}

module.exports = scheduleBooking;
