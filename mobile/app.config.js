const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

module.exports = ({ config }) => {
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      "./plugins/withPlugin.js"
    ],
    extra: {
      ...(config.extra || {}),
      firebaseApiKey: process.env.FIREBASE_API_KEY,
      firebaseAppId: process.env.FIREBASE_APP_ID,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      firebaseDatabaseURL: process.env.FIREBASE_DATABASE_URL,
    },
  };
};
