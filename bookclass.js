const puppeteer = require("puppeteer-core");

async function bookClass(classSessionId, clubId, email, password) {
 const browser = await puppeteer.launch({
   executablePath: '/usr/bin/chromium-browser',
   headless: true,
   args: ['--no-sandbox', '--disable-setuid-sandbox'],
   defaultViewport: null
 });
 const page = await browser.newPage();
 // Increase navigation timeout to 60 seconds
 await page.setDefaultNavigationTimeout(60000);
  try {
    console.log("[bookClass] Navigating to home page");
    await page.goto("https://www.virginactive.co.uk/", { waitUntil: "networkidle2", timeout: 60000 });
    console.log("[bookClass] Home page loaded");
    console.log("[bookClass] Clicking login link");
    await page.click("a[href='/account/login']");
    await page.waitForSelector("#emailAddress");
    console.log("[bookClass] Login page loaded");
    console.log("[bookClass] Typing username");
    await page.type("#emailAddress", email);
    console.log("[bookClass] Typing password");
    await page.type("#password", password);
    console.log("[bookClass] Submitting login form");
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 })
    ]);
    console.log("[bookClass] Login navigation complete");
    console.log(`[bookClass] Performing booking for classSessionId=${classSessionId}, clubId=${clubId}`);
    const response = await page.evaluate(async ({ classSessionId, clubId }) => {
      const token = localStorage.getItem("access_token");
      if (!token) {
        throw new Error("No access token found in localStorage.");
      }

      const payload = {
        classId: classSessionId,
        clubId: clubId
      };

      const res = await fetch("https://www.virginactive.co.uk/api/Class/BookClass", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      return { status: res.status, data };
    }, { classSessionId, clubId });

    console.log("Booking response:", response);
  } catch (error) {
    console.error("Booking failed:", error);
  } finally {
    await browser.close();
  }
}

// Example usage:
const sessionId = 216535; // Replace with the actual session-specific ID (not the shared classId)
const clubId = 408;
const email = "your@email.com"; // Replace with actual email passed from app
const password = "yourPassword"; // Replace with actual password passed from app
bookClass(sessionId, clubId, email, password);

module.exports = bookClass;