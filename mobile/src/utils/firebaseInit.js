import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { initializeAppCheck } from '@react-native-firebase/app-check';

// Переменная для хранения статуса инициализации
let isInitializing = false;
let initPromise = null;

// Функция настройки App Check
const setupAppCheck = () => {
  try {
    // Используем современный модульный API Firebase (v22+)
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
  // so we primarily rely on `executionEnvironment === 'storeClient'` (Expo Go).
  const isExpoGo =
    Constants.executionEnvironment === 'storeClient' ||
    (Constants.executionEnvironment == null && Constants.appOwnership === 'expo');
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
          const firebaseConfig = {
            apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
            appId: "1:176773891332:android:01174694c19132ed0ffc51",
            projectId: "fastapi-f628e",
            storageBucket: "fastapi-f628e.firebasestorage.app",
            messagingSenderId: "176773891332",
            databaseURL: "https://fastapi-f628e-default-rtdb.firebaseio.com",
          };
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
