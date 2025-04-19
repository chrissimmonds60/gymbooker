const express = require('express');
const bodyParser = require('body-parser');
const scheduleBooking = require('./index');

const app = express();

// 1️⃣ Parse JSON first, on *every* request:
app.use(bodyParser.json());

// 2️⃣ Then log (now req.body is always at least `{}`):
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  // guard in case body is undefined/null:
  const body = req.body || {};
  if (Object.keys(body).length) console.log('  body:', body);
  next();
});

app.post('/schedule-booking', async (req, res) => {
  const { club, date, time, className } = req.body;
  if (!club || !date || !time || !className) {
    console.log('  → 400 missing fields');
    return res.status(400).json({ error: 'missing fields' });
  }

  try {
    console.log(`  → scheduling booking: ${club} ${date} ${time} "${className}"`);
    const scheduledFor = await scheduleBooking(club, date, time, className);
    console.log('  ← result:', scheduledFor);
    res.json({ success: true, scheduledFor });
  } catch (err) {
    console.error('  Booking error:', err);
    res.status(500).json({ error: 'booking failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🏃‍♂️ Booking‑API listening on http://0.0.0.0:${PORT}`)
);
