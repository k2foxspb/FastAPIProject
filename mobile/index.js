import 'expo-dev-client';
import { getApps, initializeApp } from '@react-native-firebase/app';
import { setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import { Platform } from 'react-native';
import { registerRootComponent } from 'expo';

// 1. ПЕРВООЧЕРЕДНАЯ РЕГИСТРАЦИЯ ФОНОВЫХ ОБРАБОТЧИКОВ (Критично для Android Headless JS)
// Согласно документации RNFirebase, setBackgroundMessageHandler должен быть вызван 
// как можно раньше, ДО регистрации основного компонента и даже до импорта App.js.

console.log(`[Entry] index.js execution started, Platform: ${Platform.OS}`);
console.log(`[Entry] Firebase apps initialized: ${getApps().length}`);

if (Platform.OS === 'android') {
  // Гарантированная инициализация Firebase для Headless JS
  if (getApps().length === 0) {
    try {
      initializeApp({
        apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
        appId: "1:176773891332:android:01174694c19132ed0ffc51",
        projectId: "fastapi-f628e",
        storageBucket: "fastapi-f628e.firebasestorage.app",
        messagingSenderId: "176773891332",
        databaseURL: "https://fastapi-f628e-default-rtdb.firebaseio.com",
      });
      console.log('[Entry] Firebase manual initialization SUCCESS (Headless Task)');
    } catch (e) {
      console.error('[Entry] Firebase manual initialization failed:', e);
    }
  }

  // Регистрируем обработчик для FCM (Firebase Cloud Messaging)
  const fcmBackgroundHandler = async (remoteMessage) => {
    console.log(`[Entry] FCM Background message received: ${remoteMessage?.messageId}`);
    try {
      const { displayBundledMessage } = require('./src/utils/notificationUtils');
      await displayBundledMessage(remoteMessage);
    } catch (err) {
      console.error('[Entry] Error in FCM background handler:', err);
    }
  };

  try {
    // Вызываем setBackgroundMessageHandler ПРЯМО ЗДЕСЬ, максимально рано.
    setBackgroundMessageHandler(fcmBackgroundHandler);
    console.log('[Entry] FCM Background handler registered SUCCESSFULLY');
    
    // НЕ регистрируем AppRegistry.registerHeadlessTask вручную, так как 
    // RNFirebase v12+ делает это автоматически при вызове setBackgroundMessageHandler.
  } catch (e) {
    console.error('[Entry] Critical error registering FCM background handler:', e);
  }
}

// Регистрация обработчика фоновых событий Notifee (Android и iOS)
if (Platform.OS !== 'web') {
  try {
    notifee.onBackgroundEvent(async (event) => {
      const { type, detail } = event;
      if (type === EventType.DELIVERED) return;
      
      console.log(`[Entry] Notifee Background event (type=${type}):`, detail?.notification?.id);
      try {
        const { handleNotificationResponse } = require('./src/utils/notificationUtils');
        await handleNotificationResponse(event);
      } catch (err) {
        console.error('[Entry] Error in Notifee background handler:', err);
      }
    });
    console.log('[Entry] Notifee Background handler registered');
  } catch (e) {
    console.warn('[Entry] Could not register Notifee background handler:', e);
  }
}

// 2. ОТЛОЖЕННЫЙ ИМПОРТ И РЕГИСТРАЦИЯ ОСНОВНОГО КОМПОНЕНТА
// Мы используем require вместо import, чтобы ГАРАНТИРОВАТЬ, что App.js
// загрузится ТОЛЬКО ПОСЛЕ того, как зарегистрированы фоновые обработчики.
const App = require('./App').default;

console.log('[Entry] Registering root component');
registerRootComponent(App);
