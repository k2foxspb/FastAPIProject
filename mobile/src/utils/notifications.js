import messaging from '@react-native-firebase/messaging';
import { Alert } from 'react-native';

export async function requestUserPermission() {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    console.log('Authorization status:', authStatus);
  }
}

export function setupCloudMessaging() {
  // Обработка уведомлений, когда приложение на переднем плане
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
  });
}

export async function getFcmToken() {
  const token = await messaging().getToken();
  console.log('FCM Token:', token);
  return token;
}
