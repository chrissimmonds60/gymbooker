// server.js
require('dotenv').config();
const express = require('express');
const scheduleBooking = require('./index');

const app = express();
app.use(express.json());

app.post('/schedule-booking', async (req, res) => {
  const { club, date, time, className, test } = req.body;
  if (!club || !date || !time || !className) {
    return res.status(400).json({ error: 'missing fields' });
  }
  try {
    const when = scheduleBooking(club, date, time, className.toLowerCase(), !!test);
    return res.json({ success: true, scheduledFor: when });
  } catch (err) {
    console.error('API scheduling error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏃‍♂️  Booking‑API listening on http://localhost:${PORT}`);
});
