const express = require('express');
const bodyParser = require('body-parser');
const scheduleBooking = require('./index');

const app = express();
app.use(bodyParser.json());

// log every request
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (Object.keys(req.body).length) console.log('  body:', req.body);
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
    const result = await scheduleBooking(club, date, time, className);
    console.log('  ← result:', result);
    res.json({ success: true, scheduledFor: result });
  } catch (err) {
    console.error('  Booking error:', err);
    res.status(500).json({ error: 'booking failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏃‍♂️  Booking‑API listening on http://localhost:${PORT}`));
