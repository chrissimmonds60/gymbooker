// send-notification.js

const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

// load from env
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const PROJECT_ID          = process.env.FIREBASE_PROJECT_ID;

if (!SERVICE_ACCOUNT_JSON) {
  console.error('ERROR: missing FIREBASE_SERVICE_ACCOUNT_JSON');
  process.exit(1);
}
if (!PROJECT_ID) {
  console.error('ERROR: missing FIREBASE_PROJECT_ID');
  process.exit(1);
}

// parse your service account JSON
let serviceAccount;
try {
  serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
} catch (e) {
  console.error('ERROR: invalid FIREBASE_SERVICE_ACCOUNT_JSON');
  process.exit(1);
}

async function getAccessToken() {
  const auth = new GoogleAuth({
    // directly pass in your credentials object
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function sendSilentPush() {
  const token = await getAccessToken();
  const url   = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

  const body = {
    message: {
      topic: 'timetable-updates',
      apns: {
        payload: {
          aps: { 'content-available': 1 }  // silent push
        }
      },
      data: {
        update: 'classes.json updated'
      }
    }
  };

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      Authorization              : `Bearer ${token}`,
      'Content-Type'             : 'application/json; charset=UTF-8',
    },
    body   : JSON.stringify(body),
  });

  if (!res.ok) {
    console.error('FCM error:', await res.text());
    process.exit(1);
  }

  console.log('✅ Silent push sent!');
}

sendSilentPush().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
