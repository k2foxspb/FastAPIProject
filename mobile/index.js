import 'expo-dev-client';
import { Platform } from 'react-native';

// Standard default imports for better compatibility
import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';

// 1. Firebase configuration (Fallback for when native auto-init is missing)
const firebaseConfig = {
  apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
  appId: "1:176773891332:android:01174694c19132ed0ffc51",
  projectId: "fastapi-f628e",
  storageBucket: "fastapi-f628e.firebasestorage.app",
  messagingSenderId: "176773891332",
  databaseURL: "https://fastapi-f628e-default-rtdb.firebaseio.com",
};

// 2. Initialize and Register Handlers IMMEDIATELY
if (Platform.OS !== 'web') {
  try {
    // Determine the correct firebase object
    const fb = firebase?.initializeApp ? firebase : (firebase?.default?.initializeApp ? firebase.default : firebase);
    
    console.log('[Entry] Firebase resolution check (Junie v2):', {
      fbType: typeof fb,
      hasInitialize: typeof fb?.initializeApp === 'function',
      appsLength: fb?.apps?.length || 0
    });

    if (fb && typeof fb.initializeApp === 'function' && (fb?.apps?.length || 0) === 0) {
      console.log('[Entry] No Firebase app detected, performing manual init');
      try {
        fb.initializeApp(firebaseConfig);
      } catch (e) {
        console.error('[Entry] Manual init call failed:', e.message);
      }
    }

    // Register Background FCM Handler
    // Note: Use fb.messaging if messaging import fails
    const msg = typeof messaging === 'function' ? messaging : (typeof fb?.messaging === 'function' ? fb.messaging : null);
    
    if (msg) {
      try {
        msg().setBackgroundMessageHandler(async remoteMessage => {
          console.log(`[Entry] FCM Background message: ${remoteMessage?.messageId}`);
          try {
            const { displayBundledMessage } = require('./src/utils/notificationUtils');
            await displayBundledMessage(remoteMessage);
          } catch (err) {
            console.error('[Entry] Error in background handler:', err);
          }
        });
        console.log('[Entry] FCM Background handler registered');
      } catch (e) {
        console.error('[Entry] Failed to register FCM background handler:', e.message);
      }
    } else {
      console.error('[Entry] Messaging is NOT available, registration skipped');
    }

    // Notifee Background Event Handler
    if (notifee && typeof notifee.onBackgroundEvent === 'function') {
      notifee.onBackgroundEvent(async (event) => {
        // Ignore type 3 (DELIVERED) events to reduce noise
        if (event.type === 3) return;
        
        console.log(`[Entry] Notifee Background event: ${event.type}`);
        try {
          const { handleNotificationResponse } = require('./src/utils/notificationUtils');
          await handleNotificationResponse(event);
        } catch (err) {
          console.error('[Entry] Error in Notifee background handler:', err);
        }
      });
      console.log('[Entry] Background handlers registered');
    } else {
       console.error('[Entry] Notifee is NOT available, registration skipped');
    }
  } catch (err) {
    console.error('[Entry] Critical failure in background registration:', err.message);
  }
}

// 3. Main App Entry (loads App.js)
import 'expo/AppEntry';
