// list‑classes.js
const puppeteer = require('puppeteer');

(async () => {
  /* ───────────────────── 1. launch headed for debugging ───────────────────── */
  const browser = await puppeteer.launch({
        headless: false,          // run with a visible (“headed”) browser window
        slowMo: 80,               // slow actions a bit so we can watch what happens
        devtools: false,          // set true if you’d like Chrome DevTools to auto‑open
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
        defaultViewport: null,
  });
  const page = await browser.newPage();

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
    await page.waitForTimeout(1200);
  }

  /* ───────────────────── 3. log in ───────────────────── */
  await page.goto('https://www.virginactive.co.uk/login', { waitUntil: 'networkidle2' });
  await clickCookieBanner();
  await page.type('#UserName',      process.env.VA_USER, { delay: 60 });
  await page.type('#Password',      process.env.VA_PASS, { delay: 60 });
  await page.click('button[type="submit"]');
  await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });

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
    const clubClasses = await page.evaluate((targetDate, clubName) => {
      const rows = Array.from(document.querySelectorAll('dt.va__accordion-section'));
      return rows.flatMap(dt => {
        const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
                         ?.getAttribute('datetime');
        if (rowDate !== targetDate) return [];
        const time   = dt.querySelector('.class-timetable__class-time time')
                         ?.textContent.trim();
        const titles = [...dt.querySelectorAll('.class-timetable__class-title')]
                         .map(t => t.textContent.trim().toLowerCase());
        return titles.map(title => ({ club: clubName, time, title }));
      });
    }, todayPlus8, club.name);

    allClasses.push(...clubClasses);
  }

  // dump everything we found in one JSON payload
  console.log(JSON.stringify(allClasses, null, 2));

  await browser.close();
})();