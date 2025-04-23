const puppeteer = require("puppeteer");

async function bookClass(classSessionId, clubId, email, password) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  try {
    await page.goto("https://www.virginactive.co.uk/");
    await page.click("a[href='/account/login']");
    await page.waitForSelector("#emailAddress");

    await page.type("#emailAddress", email);
    await page.type("#password", password);
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle0" })
    ]);

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