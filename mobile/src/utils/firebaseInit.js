import { Platform } from 'react-native';
import Constants from 'expo-constants';
import firebase from '@react-native-firebase/app';

// Переменная для хранения статуса инициализации
let isInitializing = false;
let initPromise = null;

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
  
  // Проверка на Expo Go
  const isExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';
  if (isExpoGo) {
    if (__DEV__) {
      console.warn('⚠️ React Native Firebase (Messaging) NOT supported in Expo Go. Use a Development Build (npx expo run:android).');
    }
    return null;
  }

  // Если приложение уже инициализировано (нативно)
  if (firebase.apps.length > 0) {
    console.log('[FCM] Firebase already initialized (native)');
    return firebase.app();
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
