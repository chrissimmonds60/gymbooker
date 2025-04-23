const puppeteer = require("puppeteer-core");

// On server, use the system Chromium path
const executablePath = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/usr/bin/chromium-browser";

async function bookClass(classSessionId, clubId, email, password) {
  console.log('[bookClass] Starting booking for user:', email);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null
  });
  const page = await browser.newPage();

  // Navigate directly to the login page
  await page.goto(
    'https://www.virginactive.co.uk/login?sf_cntrl_id=ctl00%24Body%24C001&ReturnUrl=https%3A%2F%2Fwww.virginactive.co.uk',
    { waitUntil: 'networkidle2' }
  );
  console.log('[bookClass] Login page loaded');

  // Accept cookie banner if present
  try {
    const accepted = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /accept all cookies/i.test(b.textContent || ''));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (accepted) await page.waitForTimeout(1000);
  } catch {}

  // Dismiss notifications prompt if present
  try {
    const [noThanks] = await page.$x("//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'no thanks')]");
    if (noThanks) {
      await noThanks.click();
      await page.waitForTimeout(1000);
    }
  } catch {}

  console.log('[bookClass] Typing username');
  await page.type('#UserName', email, { delay: 50 });
  console.log('[bookClass] Typing password');
  await page.type('#Password', password, { delay: 50 });

  console.log('[bookClass] Submitting login form');
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 })
  ]);
  console.log('[bookClass] Login complete');

  console.log('[bookClass] Booking classSessionId=%s, clubId=%s', classSessionId, clubId);
  const result = await page.evaluate(async ({ classSessionId, clubId }) => {
    const token = localStorage.getItem('access_token');
    const payload = { classId: classSessionId, clubId };
    const res = await fetch('/api/Class/BookClass', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    return { status: res.status, data: await res.json() };
  }, { classSessionId, clubId });

  await browser.close();
  console.log('[bookClass] Booking response:', result);
  return result;
}

// Example usage:
const sessionId = 216535; // Replace with the actual session-specific ID (not the shared classId)
const clubId = 408;
const email = "your@email.com"; // Replace with actual email passed from app
const password = "yourPassword"; // Replace with actual password passed from app
bookClass(sessionId, clubId, email, password);

module.exports = bookClass;