const express = require('express');
const bodyParser = require('body-parser');
const scheduleBooking = require('./index'); // assume index.js exports your booking fn

const app = express();
app.use(bodyParser.json());

app.post('/schedule-booking', async (req, res) => {
  const { club, date, time, className } = req.body;
  if (!club || !date || !time || !className) {
    return res.status(400).json({ error: 'missing fields' });
  }
  try {
    // call your existing scheduler:
    await scheduleBooking(club, date, time, className);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'booking failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
