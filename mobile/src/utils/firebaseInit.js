import { Platform } from 'react-native';
import Constants from 'expo-constants';
import firebase from '@react-native-firebase/app';
import appCheck from '@react-native-firebase/app-check';

// Переменная для хранения статуса инициализации
let isInitializing = false;
let initPromise = null;

// Функция настройки App Check
const setupAppCheck = (app) => {
  if (!app) return;
  try {
    const provider = appCheck().newReactNativeFirebaseAppCheckProvider();
    provider.configure({
      android: {
        // Play Integrity (рекомендуется для Google Play)
        // Для отладки на эмуляторе можно использовать 'debug' и получить debug token в логах
        provider: __DEV__ ? 'debug' : 'playIntegrity',
      },
      apple: {
        provider: 'deviceCheck',
      },
    });
    // Активируем App Check. Второй параметр true включает автообновление токена.
    appCheck().activate(provider, true);
    console.log('[AppCheck] Activated successfully');
  } catch (e) {
    console.log('[AppCheck] Failed to activate App Check:', e);
  }
};

// Initialize Firebase
const initializeFirebase = async () => {
  if (Platform.OS === 'web') return null;
  
  const firebaseConfig = {
    apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
    appId: "1:176773891332:android:01174694c19132ed0ffc51",
    projectId: "fastapi-f628e",
    storageBucket: "fastapi-f628e.firebasestorage.app",
    messagingSenderId: "176773891332",
    databaseURL: "https://fastapi-f628e-default-rtdb.firebaseio.com",
  };
  
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
  if (firebase.apps.length > 0) {
    console.log('[FCM] Firebase already initialized (native)');
    const app = firebase.app();
    setupAppCheck(app);
    return app;
  }

  if (isInitializing) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      // Пытаемся получить дефолтное приложение
      try {
        const app = firebase.app();
        console.log('[FCM] Successfully got default Firebase app');
        return app;
      } catch (e) {
        if (Platform.OS === 'android') {
          console.log('[FCM] Native auto-init failed, performing manual init...');
          const app = firebase.initializeApp(firebaseConfig);
          console.log('[FCM] firebase.initializeApp SUCCESS (Manual Fallback)');
          setupAppCheck(app);
          return app;
        }
        throw e;
      }
    } catch (err) {
      console.error('[FCM] CRITICAL: firebase.initializeApp failed:', err.message);
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
