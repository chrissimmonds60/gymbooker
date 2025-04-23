// testBooked.js
require('dotenv').config();             // if you store creds in .env
const { getBookedClasses } = require('./bookedclasses');

(async () => {
  try {
    console.log('🔐 Logging in and fetching booked classes…');
    const classes = await getBookedClasses();
    console.log('📋 Your booked classes:\n', JSON.stringify(classes, null, 2));
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
})();