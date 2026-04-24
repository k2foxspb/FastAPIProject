import { Platform } from 'react-native';
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};
const firebaseConfig = {
  apiKey: extra.firebaseApiKey,
  appId: extra.firebaseAppId,
  projectId: extra.firebaseProjectId,
  storageBucket: extra.firebaseStorageBucket,
  messagingSenderId: extra.firebaseMessagingSenderId,
  databaseURL: extra.firebaseDatabaseURL,
};
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';

// Переменная для хранения статуса инициализации
let isInitializing = false;
let initPromise = null;

// Функция настройки App Check
const setupAppCheck = () => {
  try {
    // Используем современный модульный API Firebase (v22+)
    const { initializeAppCheck } = require('@react-native-firebase/app-check');
    initializeAppCheck(undefined, {
      provider: 'playIntegrity',
      isTokenAutoRefreshEnabled: true,
    });
    console.log('[AppCheck] Activated successfully (Modular SDK)');
  } catch (e) {
    console.log('[AppCheck] Failed to activate App Check:', e.message);
  }
};

// Initialize Firebase
const initializeFirebase = async () => {
  if (Platform.OS === 'web') return null;
  
  // Expo Go doesn't support @react-native-firebase/messaging.
  // IMPORTANT: `appOwnership === 'expo'` can also be true for Dev Client / development builds,
  // where FCM DOES work. So we ONLY block if explicitly in 'storeClient' (Expo Go).
  const isExpoGo = Constants.executionEnvironment === 'storeClient';
  if (isExpoGo) {
    if (__DEV__) {
      console.warn(
        '⚠️ React Native Firebase (Messaging) NOT supported in Expo Go. Use a Development Build (npx expo run:android). ' +
          `(executionEnvironment=${Constants.executionEnvironment}, appOwnership=${Constants.appOwnership})`
      );
    }
    return null;
  }

  // Если приложение уже инициализировано (нативно)
  if (getApps().length > 0) {
    console.log('[FCM] Firebase already initialized (native)');
    setupAppCheck();
    return getApp();
  }

  if (isInitializing) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      // Пытаемся получить дефолтное приложение
      try {
        const app = getApp();
        console.log('[FCM] Successfully got default Firebase app');
        setupAppCheck();
        return app;
      } catch (e) {
        if (Platform.OS === 'android') {
          console.log('[FCM] Native auto-init failed, performing manual init...');
          const app = initializeApp(firebaseConfig);
          console.log('[FCM] initializeApp SUCCESS (Manual Fallback)');
          setupAppCheck();
          return app;
        }
        throw e;
      }
    } catch (err) {
      console.error('[FCM] CRITICAL: initializeApp failed:', err.message);
      return null;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
};

// Экспортируем функцию для явного вызова при старте приложения
export { initializeFirebase };
export default initializeFirebase;
