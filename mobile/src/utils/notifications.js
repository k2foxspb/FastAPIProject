import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import { Alert, Platform } from 'react-native';
import { usersApi } from '../api';
import { firebaseApp } from './firebaseInit';

// Ensure Firebase is initialized before accessing messaging()
const getMessaging = () => {
  if (Platform.OS === 'web') return null;

  try {
    // Check if we have any initialized apps
    if (firebase.apps.length === 0) {

      if (!firebaseApp) {

        return null;
      }
    }
    return messaging();
  } catch (e) {

    return null;
  }
};

export async function requestUserPermission() {
  if (Platform.OS === 'web') return false;
  try {
    const msg = getMessaging();
    if (!msg) return false;
    const authStatus = await msg.requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log('Authorization status:', authStatus);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Permission request failed:', error);
    return false;
  }
}

export function setupCloudMessaging() {
  if (Platform.OS === 'web') return;
  try {
    const msg = getMessaging();
    if (!msg) {
      console.log('Messaging not available during setupCloudMessaging, will skip for now.');
      return;
    }
    // Обработка уведомлений, когда приложение на переднем плане
    const unsubscribe = msg.onMessage(async remoteMessage => {
      console.log('Foreground message received:', remoteMessage);
      Alert.alert(
        remoteMessage.notification?.title || 'Новое уведомление',
        remoteMessage.notification?.body || ''
      );
    });

    // Обработка обновления токена
    msg.onTokenRefresh(token => {
      console.log('FCM Token refreshed:', token);
      updateServerFcmToken(token);
    });

    // Обработка клика по уведомлению (когда приложение было в фоне)
    msg.onNotificationOpenedApp(remoteMessage => {
      console.log('Notification caused app to open from background state:', remoteMessage.notification);
    });

    // Обработка уведомления, которое открыло приложение из закрытого состояния
    msg.getInitialNotification().then(remoteMessage => {
      if (remoteMessage) {
        console.log('Notification caused app to open from quit state:', remoteMessage.notification);
      }
    }).catch(err => console.error('getInitialNotification failed:', err));

    return unsubscribe;
  } catch (error) {
    console.error('Firebase messaging setup failed:', error);
  }
}

export async function getFcmToken() {
  if (Platform.OS === 'web') return null;
  try {
    const msg = getMessaging();
    if (!msg) return null;
    
    // Register for remote notifications on iOS
    if (Platform.OS === 'ios') {
      await msg.registerDeviceForRemoteMessages();
    }

    const token = await msg.getToken();
    console.log('FCM Token:', token);
    return token;
  } catch (error) {
    console.error('Failed to get FCM token:', error);
    return null;
  }
}

export async function updateServerFcmToken(passedToken = null) {
  try {
    const token = passedToken || await getFcmToken();
    if (!token) {

      return;
    }

    // Проверяем наличие токена авторизации в axios
    const hasAuth = usersApi.updateFcmToken.toString().includes('Authorization') || true; // Просто напоминание
    

    const response = await usersApi.updateFcmToken(token);
    
    if (response.data && response.data.status === 'ok') {
      console.log('FCM Token updated on server SUCCESSFULLY:', token);
    } else {
      console.log('FCM Token update response:', response.data);
    }
  } catch (error) {
    if (error.response) {
      console.error('Failed to update FCM token on server (Response Error):', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('Failed to update FCM token on server (No Response):', error.message);
    } else {
      console.error('Failed to update FCM token on server (Setup Error):', error.message);
    }
  }
}
