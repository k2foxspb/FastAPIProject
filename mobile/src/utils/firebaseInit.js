import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import { Platform, Alert } from 'react-native';
import Constants from 'expo-constants';

// Initialize Firebase
const initializeFirebase = () => {
  if (Platform.OS === 'web') return null;

  // Проверка на Expo Go
  const isExpoGo = Constants.appOwnership === 'expo' || Constants.executionEnvironment === 'storeClient';
  if (isExpoGo) {
    const msg = 'React Native Firebase (Messaging) NOT supported in Expo Go. Use a Development Build (npx expo run:android).';
    console.warn('⚠️ ' + msg);
    // Показываем Alert только один раз при загрузке, чтобы не спамить
    if (__DEV__) {
       // Мы не можем вызвать Alert прямо здесь, так как UI может быть не готов, 
       // но мы логируем это максимально заметно.
    }
  }

  try {
    if (firebase.apps.length > 0) {
      console.log('Firebase already initialized, apps count:', firebase.apps.length);
      return firebase.app();
    }

    // Attempting to use the native auto-initialization first
    console.log('No apps found, checking if we can just use the default app...');
    try {
      const app = firebase.app();
      if (app) {
        console.log('Default app found via firebase.app()');
        return app;
      }
    } catch (e) {
      console.log('Default app not found via firebase.app(), will try initializeApp');
    }

// Manual configuration from google-services.json
    const firebaseConfig = {
      apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
      appId: "1:176773891332:android:01174694c19132ed0ffc51",
      projectId: "fastapi-f628e",
      storageBucket: "fastapi-f628e.firebasestorage.app",
      messagingSenderId: "176773891332"
    };

    console.log('Calling firebase.initializeApp(config)...');
    const app = firebase.initializeApp(firebaseConfig);
    console.log('firebase.initializeApp result:', app ? 'Success' : 'Failed');
    console.log('firebase.apps.length after init:', firebase.apps.length);
    if (firebase.apps.length > 0) {
      console.log('Apps:', firebase.apps.map(a => a.name).join(', '));
    }
    return app;
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('already initialized')) {
      console.log('Firebase app already exists, returning default.');
      return firebase.app();
    }
    console.error('Firebase initialization error:', error);
    return null;
  }
};

// Execute initialization immediately
const firebaseApp = initializeFirebase();

// Background message handler
if (Platform.OS !== 'web') {
  try {
    // Check if app is initialized before calling messaging()
    if (firebase.apps.length > 0) {
      messaging().setBackgroundMessageHandler(async remoteMessage => {
        console.log('Message handled in the background!', remoteMessage);
      });
      console.log('Background message handler registered');
    } else {
      console.warn('Cannot register background handler: Firebase not initialized');
    }
  } catch (error) {
    console.error('Failed to register background message handler:', error);
  }
}

export { firebaseApp };
export default initializeFirebase;
