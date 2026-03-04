import 'expo-dev-client';
import { Platform } from 'react-native';
import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';

// 1. Initialize and Register Handlers IMMEDIATELY
if (Platform.OS !== 'web') {
  try {
    // В Expo с плагином @react-native-firebase/app, Firebase инициализируется автоматически на нативном уровне.
    // Если нативная инициализация по какой-то причине не сработала, App.js вызовет initializeFirebase().
    
    // Register Background FCM Handler
    // Важно: вызываем messaging() напрямую, чтобы он зарегистрировал фоновый обработчик
    try {
      messaging().setBackgroundMessageHandler(async remoteMessage => {
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
      console.warn('[Entry] Could not register FCM background handler:', e.message);
    }

    // Notifee Background Event Handler
    try {
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
        console.log('[Entry] Notifee Background handler registered');
      }
    } catch (e) {
      console.warn('[Entry] Could not register Notifee background handler:', e.message);
    }
  } catch (err) {
    console.error('[Entry] Critical failure in background registration:', err.message);
  }
}

// 2. Main App Entry (loads App.js)
import 'expo/AppEntry';
