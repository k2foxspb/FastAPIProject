import messaging from '@react-native-firebase/messaging';
import { Alert } from 'react-native';

export async function requestUserPermission() {
  try {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log('Authorization status:', authStatus);
    }
  } catch (error) {
    console.error('Permission request failed:', error);
  }
}

export function setupCloudMessaging() {
  try {
    // Обработка уведомлений, когда приложение на переднем переднем плане
    messaging().onMessage(async remoteMessage => {
      Alert.alert('Новое уведомление', remoteMessage.notification.body);
    });

    // Обработка клика по уведомлению (когда приложение было в фоне)
    messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('Notification caused app to open from background state:', remoteMessage.notification);
    });

    // Обработка уведомления, которое открыло приложение из закрытого состояния
    messaging().getInitialNotification().then(remoteMessage => {
      if (remoteMessage) {
        console.log('Notification caused app to open from quit state:', remoteMessage.notification);
      }
    }).catch(err => console.error('getInitialNotification failed:', err));
  } catch (error) {
    console.error('Firebase messaging setup failed:', error);
  }
}

export async function getFcmToken() {
  try {
    const token = await messaging().getToken();
    console.log('FCM Token:', token);
    return token;
  } catch (error) {
    console.error('Failed to get FCM token:', error);
    return null;
  }
}
