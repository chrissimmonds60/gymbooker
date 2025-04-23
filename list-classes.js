// list‑classes.js
require('dotenv').config();
const puppeteer = require('puppeteer');
// simple sleep helper in lieu of page.waitForTimeout()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  /* ───────────────────── 1. launch headed for debugging ───────────────────── */
  console.log("🚀 Launching browser...");
  const browser = await puppeteer.launch({
  headless: true,          // run in headless (Chromium >=109); use true if on older versions
  // slowMo: 80,            // you can keep this if you still want a little delay
  // devtools: false,
    args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1920,1080'
  ],
  defaultViewport: { width: 1920, height: 1080 },
});
  const page = await browser.newPage();
  console.log("🧭 New page opened.");

  /* ───────────────────── 2. helpers ───────────────────── */
  const todayPlus8 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);           // yyyy‑mm‑dd
  })();

  async function clickCookieBanner() {
    try {
      await page.waitForSelector('button', { timeout: 5000 });
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => /accept all cookies/i.test(b.textContent));
        btn && btn.click();
      });
    } catch { /* no banner */ }
  }

  async function autoScroll() {
    await page.evaluate(async () => {
      const scrollEl = document.querySelector('.va__accordion') ||
                       document.scrollingElement ||
                       document.body;
      let last = 0, still = 0;
      while (still < 5) {
        scrollEl.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 500));
        if (scrollEl.scrollHeight === last) still++;
        else { last = scrollEl.scrollHeight; still = 0; }
      }
    });
  }

  async function selectDateTab(dateISO) {
    await page.evaluate(d => {
      const t = [...document.querySelectorAll('[datetime]')]
        .find(el => el.getAttribute('datetime') === d);
      t?.closest('button, a, div')?.click();
    }, dateISO);
    await sleep(1200);
  }

  /* ───────────────────── 3. log in ───────────────────── */
  console.log("🔐 Navigating to login page...");
  await page.goto('https://www.virginactive.co.uk/login', { waitUntil: 'networkidle2' });
  await clickCookieBanner();
  if (!process.env.VA_USER || !process.env.VA_PASS) {
    console.error("❌ Environment variables VA_USER or VA_PASS not set.");
    process.exit(1);
  }
  await page.type('#UserName', process.env.VA_USER, { delay: 60 });
  await page.type('#Password', process.env.VA_PASS, { delay: 60 });
  await page.click('button[type="submit"]');
  await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });
  console.log("✅ Login successful.");

  /* ───────────────────── 4. timetable page ───────────────────── */
  // ─────────── iterate through all clubs we care about ────────────
  const clubs = [
    { slug: 'wimbledon-worple-road', name: 'wimbledon' },
    { slug: 'bank',                 name: 'bank' },
    { slug: 'walbrook',             name: 'walbrook' },
    { slug: 'moorgate',             name: 'moorgate' },
    { slug: 'aldersgate',           name: 'aldersgate' },
  ];

  const allClasses = [];

  for (const club of clubs) {
    console.log(`📅 Navigating to timetable for ${club.name} (${club.slug})`);
    const url = `https://www.virginactive.co.uk/clubs/${club.slug}/timetable?activeDay=${todayPlus8}`;
    await page.goto(url, { waitUntil: 'networkidle2' });

    // pick the correct day tab
    await selectDateTab(todayPlus8);

    // wait for first rows to appear, then scroll to load the rest
    try {
      await page.waitForSelector('dt.va__accordion-section', { timeout: 15_000 });
    } catch { /* some clubs might legitimately have no rows */ }
    await autoScroll();

    // harvest rows for this club / date
    const clubClasses = await page.evaluate((targetDate, clubName, clubSlug) => {
      const rows = Array.from(document.querySelectorAll('dt.va__accordion-section'));
      const clubId = document.querySelector('#va__class-timetable-finder')?.getAttribute('data-club-id') || 'unknown';
      return rows.flatMap(dt => {
        const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
                         ?.getAttribute('datetime');
        if (rowDate !== targetDate) return [];
        const time   = dt.querySelector('.class-timetable__class-time time')
                         ?.textContent.trim();
        const titles = [...dt.querySelectorAll('.class-timetable__class-title')]
                         .map(t => t.textContent.trim().toLowerCase());
        return titles.map(title => {
          const classId = dt.getAttribute('data-id') || 'unknown';
          return { club: clubName, time, title, clubId, classId };
        });
      });
    }, todayPlus8, club.name, club.slug);

    // fetch API timetable data to find real classIds
    const apiTimetable = await page.evaluate(async (id) => {
      const res = await fetch(`/api/club/getclubtimetable?id=${id}`, {
        credentials: 'include'
      });
      return await res.json();
    }, clubClasses[0]?.clubId);

    if (apiTimetable?.TimetableEntries?.length) {
      for (const entry of clubClasses) {
        const match = apiTimetable.TimetableEntries.find(e =>
          e.ClassName?.toLowerCase().includes(entry.title) &&
          e.ClassTime?.includes(entry.time?.split(" - ")[0]));
        if (match?.Id) entry.classId = match.Id.toString();
      }
    }

    console.log(`📦 Found ${clubClasses.length} classes for ${club.name}`);
    allClasses.push(...clubClasses);
  }

  // dump everything we found in one JSON payload
  console.log(JSON.stringify(allClasses, null, 2));

  await browser.close();
})();
