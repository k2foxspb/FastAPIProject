import firebase from '@react-native-firebase/app';

if (!firebase.apps.length) {
  try {
    firebase.initializeApp();
    console.log('Firebase initialized in separate module');
  } catch (err) {
    console.error('Firebase initialization error in module:', err);
  }
}

export default {};
