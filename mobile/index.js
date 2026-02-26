import 'expo-dev-client';
console.log('[Entry] Starting index.js (JS Entrypoint)');
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';

// Register background handlers at the true JS entrypoint for Headless mode
if (Platform.OS !== 'web') {
  try {
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      try {
        console.log('[FCM] Background message received (index.js):', JSON.stringify(remoteMessage));
      } catch (_) {
        console.log('[FCM] Background message received (index.js)');
      }
      if (Platform.OS === 'android') {
        const hasSystemNotification = !!(remoteMessage?.notification && (remoteMessage.notification.title || remoteMessage.notification.body));
        if (!hasSystemNotification) {
          try {
            const { displayBundledMessage } = require('./src/utils/notificationUtils');
            await displayBundledMessage(remoteMessage);
          } catch (err) {
            console.log('[FCM] Error displaying bundled message in background:', err?.message || err);
          }
        }
      }
    });

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      try {
        const { handleNotifeeEvent } = require('./src/utils/notificationUtils');
        await handleNotifeeEvent(type, detail);
      } catch (err) {
        console.log('[Notifee] Background event handler error (index.js):', err?.message || err);
      }
    });

    console.log('[Init] Background handlers registered in index.js');
  } catch (e) {
    console.log('[Init] Failed to register background handlers in index.js:', e?.message || e);
  }
}

// Preserve Expo entry behavior
import 'expo/AppEntry';
