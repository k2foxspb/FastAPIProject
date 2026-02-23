import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import { Platform, Alert } from 'react-native';
import Constants from 'expo-constants';
import { usersApi } from '../api';
import { storage } from './storage';

// Переменная для хранения статуса инициализации
let isInitializing = false;
let initPromise = null;

// Initialize Firebase
const initializeFirebase = async () => {
  if (Platform.OS === 'web') return null;
  
  if (firebase.apps.length > 0) {
    return firebase.app();
  }

  if (isInitializing) {
    return initPromise;
  }

  isInitializing = true;
  initPromise = (async () => {
    // Проверка на Expo Go
    const isExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';
    if (isExpoGo) {
      const msg = 'React Native Firebase (Messaging) NOT supported in Expo Go. Use a Development Build (npx expo run:android).';
      console.warn('⚠️ ' + msg);
    }

    try {
      // Manual configuration (fallback for some environments)
      let firebaseConfig = null;
      
      // Пытаемся получить конфиг с сервера для динамической настройки
      try {
        console.log('Fetching Firebase config from server...');
        const response = await usersApi.getFirebaseConfig();
        if (response.data && response.data.apiKey) {
          firebaseConfig = response.data;
          console.log('Firebase config fetched from server successfully');
          // Кэшируем конфиг
          await storage.saveItem('firebase_remote_config', JSON.stringify(firebaseConfig));
        }
      } catch (e) {
        console.log('Failed to fetch Firebase config from server, checking cache...');
        try {
          const cachedConfig = await storage.getItem('firebase_remote_config');
          if (cachedConfig) {
            firebaseConfig = JSON.parse(cachedConfig);
            console.log('Using cached Firebase config');
          }
        } catch (cacheErr) {
          console.log('No cached config found');
        }
      }

      if (!firebaseConfig && Platform.OS === 'android') {
        console.log('Using hardcoded fallback Firebase config for Android');
        firebaseConfig = {
          apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
          appId: "1:176773891332:android:01174694c19132ed0ffc51",
          projectId: "fastapi-f628e",
          storageBucket: "fastapi-f628e.firebasestorage.app",
          messagingSenderId: "176773891332",
          databaseURL: "https://fastapi-f628e-default-rtdb.firebaseio.com"
        };
      }

      if (firebaseConfig) {
        console.log('[FCM] Calling firebase.initializeApp(config) for', Platform.OS);
        try {
          if (firebase.apps.length > 0) {
            console.log('[FCM] App already exists during initializeApp, returning existing');
            return firebase.app();
          }
          const app = firebase.initializeApp(firebaseConfig);
          console.log('[FCM] firebase.initializeApp result: SUCCESS');
          return app;
        } catch (err) {
          if (err.message.includes('already exists')) {
            console.log('[FCM] App already exists (caught error), returning existing');
            return firebase.app();
          }
          console.error('[FCM] Error during firebase.initializeApp:', err);
          return null;
        }
      } else {
        console.warn('[FCM] No Firebase config provided for', Platform.OS, '. Relying on native auto-initialization.');
        try {
          const app = firebase.app();
          console.log('[FCM] Native auto-initialization app found');
          return app;
        } catch (e) {
          console.error('[FCM] Failed to get default Firebase app (auto-init failed):', e);
          return null;
        }
      }
    } catch (error) {
      console.error('Firebase initialization error:', error);
      return null;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
};

// Background message handler
if (Platform.OS !== 'web') {
  const registerBackgroundHandler = (attempts = 0) => {
    try {
      if (firebase.apps.length > 0) {
        messaging().setBackgroundMessageHandler(async remoteMessage => {
          console.log('Message handled in the background!', remoteMessage);
        });
        console.log('Background message handler registered successfully');
      } else {
        if (attempts < 20) {
          setTimeout(() => registerBackgroundHandler(attempts + 1), 1000);
        }
      }
    } catch (error) {
      console.error('Failed to register background message handler:', error);
    }
  };

  registerBackgroundHandler();
}

// Экспортируем функцию для явного вызова при старте приложения
export { initializeFirebase };
export default initializeFirebase;
