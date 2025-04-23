const express = require('express');
const bodyParser = require('body-parser');
const { scheduleBooking } = require('./index');
const { getBookedClasses } = require('./bookedclasses');

const app = express();
app.use(bodyParser.json());
// Log startup and catch uncaught errors
console.log('📡 Starting Booking‑API process, PID:', process.pid);
process.on('uncaughtException', err => {
  console.error('🔴 Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔴 Unhandled rejection at:', promise, 'reason:', reason);
});

// log every request
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (Object.keys(req.body).length) console.log('  body:', req.body);
  next();
});

// quick health-check endpoint
app.get('/', (req, res) => {
  res.send('Booking API is up');
});

app.post('/schedule-booking', (req, res) => {
  const { club, date, time, className } = req.body;
  if (!club || !date || !time || !className) {
    console.log('  → 400 missing fields');
    return res.status(400).json({ error: 'missing fields' });
  }

  console.log(`  → scheduling booking: ${club} ${date} ${time} "${className}"`);
  scheduleBooking(club, date, time, className)
    .then(result => console.log('  ← scheduledFor:', result))
    .catch(err => console.error('  Booking job failed:', err));
  return res.json({ success: true, message: 'Booking job scheduled' });
});

// endpoint to fetch booked classes
app.post('/booked-classes', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    console.log('  → 400 missing credentials');
    return res.status(400).json({ error: 'missing credentials' });
  }
  try {
    const result = await getBookedClasses(username, password);
    res.json(result);
  } catch (err) {
    console.error('🔴 Error fetching booked classes:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// endpoint to book a class
app.post('/book-class', async (req, res) => {
  const { username, password, classInstanceId } = req.body;
  if (!username || !password || !classInstanceId) {
    console.log('  → 400 missing fields');
    return res.status(400).json({ error: 'missing fields' });
  }

  try {
    const bookClass = require('./bookclass');
    const result = await bookClass(username, password, classInstanceId);
    res.json({ success: true, result });
  } catch (err) {
    console.error('🔴 Error booking class:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () =>
  console.log(`🏃‍♂️  Booking‑API listening on http://0.0.0.0:${PORT}`)
);
server.on('error', err => {
  console.error('🔴 HTTP server error:', err);
});
