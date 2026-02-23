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

// Manual configuration (fallback for some environments)
    let firebaseConfig = null;
    if (Platform.OS === 'android') {
      firebaseConfig = {
        apiKey: "AIzaSyAwKCJuxsxfnY6aloE5lnDn-triTVBswxE",
        appId: "1:176773891332:android:01174694c19132ed0ffc51",
        projectId: "fastapi-f628e",
        storageBucket: "fastapi-f628e.firebasestorage.app",
        messagingSenderId: "176773891332"
      };
    } else if (Platform.OS === 'ios') {
      // Add your iOS Firebase config here if auto-init from GoogleService-Info.plist fails
      /*
      firebaseConfig = {
        apiKey: "...",
        appId: "...",
        projectId: "...",
        storageBucket: "...",
        messagingSenderId: "..."
      };
      */
    }

    if (firebaseConfig) {
      console.log('Calling firebase.initializeApp(config) for', Platform.OS);
      try {
        // Use a unique app name to avoid "already exists" errors 
        // while also checking if it helps the apps array.
        const appName = `fastapi-app-${Date.now()}`;
        console.log(`Initializing with app name: ${appName}`);
        const app = firebase.initializeApp(firebaseConfig, appName);
        console.log('firebase.initializeApp result: SUCCESS');
        console.log('Apps count after initializeApp (named):', firebase.apps.length);
        
        // If it's still 0, something is fundamentally wrong with the native bridge.
        if (firebase.apps.length === 0) {
          console.error('CRITICAL: firebase.apps is still empty after initializeApp!');
        }
        
        return app;
      } catch (err) {
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

// Execute initialization immediately
const firebaseApp = initializeFirebase();

// Background message handler
if (Platform.OS !== 'web') {
  // Use a small delay or check for apps length to ensure native side is ready
  const registerBackgroundHandler = (attempts = 0) => {
    try {
      if (firebase.apps.length > 0) {
        messaging().setBackgroundMessageHandler(async remoteMessage => {
          console.log('Message handled in the background!', remoteMessage);
        });
        console.log('Background message handler registered successfully');
      } else {
        // If we have no apps yet, try to initialize it once more if we've waited a bit
        if (attempts === 5 || attempts === 15) {
            console.log(`Still no apps at attempt ${attempts}, trying initializeFirebase() one more time...`);
            initializeFirebase();
        }

        // Only warn every 10 attempts to reduce log spam (approx every 10s)
        if (attempts % 10 === 0) {
          console.warn(`Waiting for Firebase initialization to register background handler... (Attempt ${attempts + 1})`);
          console.log('Current firebase.apps state:', JSON.stringify(firebase.apps));
        }
        
        // Also try to re-run initialization if it failed or hasn't started
        if (attempts > 0 && attempts % 30 === 0) {
          console.log('Attempting to re-initialize Firebase (Force restart)...');
          initializeFirebase();
        }

        setTimeout(() => registerBackgroundHandler(attempts + 1), 1000);
      }
    } catch (error) {
      console.error('Failed to register background message handler:', error);
    }
  };

  registerBackgroundHandler();
}

export { firebaseApp };
export default initializeFirebase;
