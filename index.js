const puppeteer = require('puppeteer');

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: false,          // run with a visible (“headed”) browser window
      slowMo: 80,               // slow actions a bit so we can watch what happens
      devtools: false,          // set true if you’d like Chrome DevTools to auto‑open
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    
    // ──────────────────────────────────────────────────────────────
    //  Helper: auto‑scroll until the page stops growing
    // ──────────────────────────────────────────────────────────────
    async function autoScroll(page) {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          // Scroll only inside the timetable accordion, so we don’t nudge the
          // horizontal day selector sideways.
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
        // Look for an element containing a <time datetime="yyyy‑mm‑dd"> tag
        const dateEl = Array.from(document.querySelectorAll('[datetime]'))
          .find(el => el.getAttribute('datetime') === targetDateISO);

        if (dateEl) {
          // The clickable element might be the <time> itself or a parent button
          const clickable = dateEl.closest('button, a, div') || dateEl;
          clickable.click();
        }
      }, targetDateISO);

      // Give the timetable a moment to refresh
      await page.waitForTimeout(1500);
    }

    console.log('Navigating to login page...');
    await page.goto('https://www.virginactive.co.uk/login', { waitUntil: 'networkidle2' });

    await page.screenshot({ path: 'login-debug.png' });

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
    await page.type('#UserName', 'chrissimmonds60@me.com', { delay: 100 });
    await page.type('#Password', 'vustuk-fuqvow-3jepjA', { delay: 100 });
    await page.waitForTimeout(1000);

    console.log('Clicking login button...');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'post-login-debug.png' });

    console.log('Waiting for post-login content...');
    try {
      await page.waitForSelector('.login-container__user-greeting', { timeout: 30000 });
      console.log('✅ Login successful.');
    } catch (e) {
      console.error('❌ Login likely failed or took too long.');
      const content = await page.content();
      console.log('Page content snapshot:\n', content.slice(0, 1000));
    }

    const clubSlug = 'wimbledon-worple-road';
    // -------- desired day --------------------------------------------------
    const targetDateISO = '2025-04-22';     // yyyy‑mm‑dd for 22 Apr 2025
    const timetableUrl  = `https://www.virginactive.co.uk/clubs/${clubSlug}/timetable?activeDay=${targetDateISO}`;
    // -----------------------------------------------------------------------

    console.log(`Navigating to class timetable: ${timetableUrl}`);
    await page.goto(timetableUrl, { waitUntil: 'networkidle2' });
    
    // Make sure the correct day is still selected (the bar sometimes auto‑slides)
    await selectDateTab(page, targetDateISO);

    await page.waitForTimeout(20000);

    await page.screenshot({ path: 'timetable-scrolled.png' });
    
    await page.waitForTimeout(8000);
    // ──────────────────────────────────────────────────────────────
    //  Collect every row in the timetable (after fully auto‑scrolling)
    // ──────────────────────────────────────────────────────────────
    await page.waitForSelector('dt.va__accordion-section', { timeout: 20000 });
    await autoScroll(page);

    // Extra settling time and second pass for late‑loading rows
    await page.waitForTimeout(5000);
    await autoScroll(page);

    const allClasses = await page.evaluate((targetDateISO) => {
      const collected = new Set();
      const out       = [];

      // expand closed rows and record every (time – title) pair
      document.querySelectorAll('dt.va__accordion-section').forEach(dt => {
        const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
          ?.getAttribute('datetime') || '';
      
        // Skip rows that are not for the target day
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
    // Capture the timetable exactly as it appears after harvesting classes
    await page.screenshot({ path: 'timetable-after-list.png' });
    
    // Wait 5 seconds before continuing with the 18:45 search/debug logic
    await page.waitForTimeout(5000);

    // Give the page 5 seconds to settle (lazy‑loading, animations, etc.)
    await page.waitForTimeout(5000);

    // ──────────────────────────────────────────────────────────────
    // DEBUG: list every row whose time starts with 18:45
    // ──────────────────────────────────────────────────────────────
    console.log('🔎 Dumping every 18:45 row that the page can see...');
    const debugRows1845 = await page.evaluate((targetDateISO) => {
      return Array.from(document.querySelectorAll('dt.va__accordion-section'))
        .filter(dt => {
          const rowDate = dt.querySelector('.class-timetable-panel__class-date time')
            ?.getAttribute('datetime') || '';
          if (rowDate !== targetDateISO) return false;
      
          return (dt.querySelector('.class-timetable__class-time time')?.textContent.trim().toLowerCase() || '')
            .startsWith('18:45');
        })
        .map((dt, i) => {
          const time   = dt.querySelector('.class-timetable__class-time time')?.textContent.trim() || '';
          const titles = Array.from(dt.querySelectorAll('.class-timetable__class-title'))
            .map(t => t.textContent.trim())
            .join(' | ');
          const button = dt.querySelector('button.class-timetable__book-button')
            ?.textContent.trim() || 'no button';
          return `[#${i + 1}] ${time} — ${titles} — button: ${button}`;
        });
    }, targetDateISO);
    if (debugRows1845.length) {
      debugRows1845.forEach(row => console.log(row));
    } else {
      console.log('⚠️  No 18:45 rows visible in the DOM at this point.');
    }
    console.log('📋 Searching for 18:45 Pilates Athletic class...');

    const clicked = await page.evaluate((targetDateISO) => {
      const TARGET_TIME  = '18:45';                     // HH:MM (24‑h)
    const TARGET_CLASS = 'pilates athletic.';         // match label on site (note trailing period)

      // 1️⃣  Find the <dt> row whose time starts with 18:45 and whose
      //     title list contains "pilates athletic"
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

      // 2️⃣  Within that row, pick the primary button:
      //     - "Book"  → class-timetable__book-button--available
      //     - "Waitlist" → class-timetable__book-button--waitlist
      const button =
        targetRow.querySelector(
          'button.class-timetable__book-button--available, button.class-timetable__book-button--waitlist'
        );

      if (!button) return 'button-not-found';

      // 3️⃣  Click it
      button.click();
      return button.classList.contains('class-timetable__book-button--available')
        ? 'book-clicked'
        : 'waitlist-clicked';
    }, targetDateISO);

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

    await page.screenshot({ path: 'final-timetable.png' });
    await page.screenshot({ path: 'post-login.png' });

    await browser.close();
  } catch (err) {
    console.error('Unhandled error in script:', err);
  }
})();