import 'expo-dev-client';
import { Platform } from 'react-native';
import messaging from '@react-native-firebase/messaging';

console.log('[Entry] Starting index.js (JS Entrypoint)');

// Headless JS check for debugging
if (Platform.OS === 'android') {
  const isHeadless = !!require('react-native').NativeModules.DeviceEventManager?.isHeadless;
  if (isHeadless) {
    console.log('[Entry] Running in Headless JS Mode (Background/Quit state)');
  }
}

// Register background handlers at the absolute top level for Headless mode
// This must happen before any other async operations to ensure reliability.
if (Platform.OS !== 'web') {
  try {
    // FCM Background Handler
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      try {
        console.log('[FCM Background] New message:', remoteMessage?.data?.type || 'unknown');
        
        // ВАЖНО: В Headless JS (когда приложение закрыто) мы должны 
        // немедленно вызвать отрисовку уведомления.
        const { displayBundledMessage } = require('./src/utils/notificationUtils');
        await displayBundledMessage(remoteMessage);
        
        console.log('[FCM Background] Notification scheduled successfully');
      } catch (err) {
        console.log('[FCM Background] Error:', err?.message || err);
      }
    });

    console.log('[Init] Background handlers registered synchronously in index.js');
  } catch (e) {
    console.log('[Init] Failed to register background handlers in index.js:', e?.message || e);
  }
}

// Try to ensure Firebase is initialized
if (Platform.OS !== 'web') {
  try {
    const { initializeFirebase } = require('./src/utils/firebaseInit');
    // We don't await this to avoid blocking the main thread/Headless task
    initializeFirebase().catch(e => console.log('[Init] Async initialization failed:', e));
  } catch (e) {
    console.log('[Init] Could not load firebaseInit in index.js:', e);
  }
}

// Preserve Expo entry behavior
import 'expo/AppEntry';
