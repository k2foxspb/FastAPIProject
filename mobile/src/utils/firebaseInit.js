import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import { Platform, Alert } from 'react-native';
import Constants from 'expo-constants';
import { usersApi } from '../api';
import { storage } from './storage';

// Initialize Firebase
const initializeFirebase = async () => {
  if (Platform.OS === 'web') return null;

  // Проверка на Expo Go
  const isExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';
  if (isExpoGo) {
    const msg = 'React Native Firebase (Messaging) NOT supported in Expo Go. Use a Development Build (npx expo run:android).';
    console.warn('⚠️ ' + msg);
  }

  try {
    if (firebase.apps.length > 0) {
      console.log('Firebase already initialized, apps count:', firebase.apps.length);
      return firebase.app();
    }

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
        messagingSenderId: "176773891332"
      };
    }

    if (firebaseConfig) {
      console.log('Calling firebase.initializeApp(config) for', Platform.OS);
      try {
        // Проверяем, не инициализировано ли уже приложение (например, нативным кодом)
        if (firebase.apps.length > 0) return firebase.app();
        
        const app = firebase.initializeApp(firebaseConfig);
        console.log('firebase.initializeApp result: SUCCESS');
        return app;
      } catch (err) {
        if (err.message.includes('already exists')) {
          return firebase.app();
        }
        console.error('Error during firebase.initializeApp:', err);
        return null;
      }
    } else {
      console.warn('No Firebase config provided for', Platform.OS, '. Relying on native auto-initialization.');
      try {
        return firebase.app();
      } catch (e) {
        console.error('Failed to get default Firebase app:', e);
        return null;
      }
    }
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('already initialized')) {
      console.log('Firebase app already exists, returning default.');
      try {
        return firebase.app();
      } catch (e) {
        return null;
      }
    }
    console.error('Firebase initialization error:', error);
    return null;
  }
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
