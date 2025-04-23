const puppeteer = require('puppeteer');
/**
 * Logs in to Virgin Active using provided credentials and retrieves the user's booked classes.
 * @param {string} username User’s Virgin Active email
 * @param {string} password User’s Virgin Active password
 * @returns {Promise<Object>}
 */
async function getBookedClasses(username, password) {
  try {
    console.log('[getBookedClasses] Starting booking fetch for user:', username);
    // Launch Chromium with headless mode and sandbox args
  const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: null
});
    const page = await browser.newPage();

    // Navigate to the login page
    await page.goto(
      'https://www.virginactive.co.uk/login?sf_cntrl_id=ctl00%24Body%24C001&ReturnUrl=https%3A%2F%2Fwww.virginactive.co.uk',
      { waitUntil: 'networkidle2' }
    );
    console.log('[getBookedClasses] Login page loaded');

    // Accept cookie banner if present
    try {
      await page.waitForSelector('button', { timeout: 5000 });
      const accepted = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const acceptBtn = btns.find(b => b.textContent?.toLowerCase().includes('accept all cookies'));
        if (acceptBtn) { acceptBtn.click(); return true; }
        return false;
      });
      if (accepted) await page.waitForTimeout(1000);
    } catch (e) {
      console.log('No cookie banner to accept');
    }

    // Dismiss any notifications prompt
    try {
      const [noThanksBtn] = await page.$x(
        "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'no thanks')]"
      );
      if (noThanksBtn) {
        await noThanksBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      // ignore if not present
    }

    console.log('[getBookedClasses] Typing username');
    // Fill in credentials
    await page.type('#UserName', username, { delay: 50 });
    console.log('[getBookedClasses] Typing password');
    await page.type('#Password', password, { delay: 50 });

    console.log('[getBookedClasses] Submitting login form');
    // Submit and wait for navigation
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
    ]);
    console.log('[getBookedClasses] Navigation after login complete');

    console.log('[getBookedClasses] Fetching booked classes from API');
    // Fetch booked classes via the API, handling invalid JSON
    const bookedClasses = await page.evaluate(async () => {
      const response = await fetch('/api/class/getBookedClasses', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (err) {
        console.error('Invalid JSON from booked-classes API:', text);
        return { error: 'Invalid JSON response', raw: text };
      }
    });

    await browser.close();
    console.log('[getBookedClasses] Browser closed');
    console.log('[getBookedClasses] Returning booked classes:', bookedClasses);
    return bookedClasses;
  } catch (err) {
    console.error('[getBookedClasses] Error:', err);
    return { error: 'Failed to fetch booked classes', details: err.message };
  }
}

module.exports = { getBookedClasses };
