import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import { Alert, Platform } from 'react-native';
import { usersApi } from '../api';
import { storage } from './storage';
import { initializeFirebase } from './firebaseInit';
import { navigationRef } from '../navigation/NavigationService';

// Ensure Firebase is initialized before accessing messaging()
const getMessaging = async () => {
  if (Platform.OS === 'web') return null;

  try {
    // Check if we have any initialized apps
    if (firebase.apps.length === 0) {
      await initializeFirebase();
    }
    
    if (firebase.apps.length === 0) {
      console.log('[FCM] Still no apps after initializeFirebase()');
      return null;
    }
    
    return messaging();
  } catch (e) {
    console.error('[FCM] Error in getMessaging:', e);
    return null;
  }
};

export async function requestUserPermission() {
  if (Platform.OS === 'web') return false;
  try {
    const msg = await getMessaging();
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

export async function setupCloudMessaging() {
  if (Platform.OS === 'web') return;
  try {
    const msg = await getMessaging();
    if (!msg) {
      console.log('Messaging not available during setupCloudMessaging, will skip for now.');
      return;
    }

    // Создаем канал уведомлений для Android
    if (Platform.OS === 'android') {
      try {
        const { Notifications } = require('expo-notifications');
        Notifications.setNotificationChannelAsync('messages', {
          name: 'Сообщения',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        }).catch(err => console.log('Error creating notification channel:', err));
      } catch (e) {
        console.log('expo-notifications not available, skipping channel creation.');
      }
    }

    // Обработка уведомлений, когда приложение на переднем плане
    const unsubscribe = msg.onMessage(async remoteMessage => {
      console.log('Foreground message received:', remoteMessage);
      
      // На переднем плане Firebase не показывает уведомление сам.
      // Обычно мы полагаемся на WebSocket, но если пользователь хочет видеть системный пуш даже в приложении:
      if (Platform.OS === 'android') {
        try {
          const { Notifications } = require('expo-notifications');
          await Notifications.scheduleNotificationAsync({
            content: {
              title: remoteMessage.notification?.title || 'Новое сообщение',
              body: remoteMessage.notification?.body || '',
              data: remoteMessage.data,
            },
            trigger: null, // немедленно
          });
        } catch (e) {
          console.log('Error showing foreground notification via expo:', e);
        }
      }
    });

    // Обработка обновления токена
    msg.onTokenRefresh(token => {
      console.log('FCM Token refreshed:', token);
      storage.saveItem('fcm_token', token); // Save locally as well
      updateServerFcmToken(token);
    });

    // Унифицированная функция перехода в нужный чат по уведомлению
    const openChatFromNotification = (remoteMessage) => {
      try {
        const data = remoteMessage?.data || {};
        const senderIdRaw = data.sender_id || data.senderId || data.user_id || data.userId;
        const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
        const senderName = data.sender_name || data.senderName || undefined;
        if (senderId && navigationRef?.isReady?.()) {
          navigationRef.navigate('Messages', {
            screen: 'Chat',
            params: { userId: senderId, userName: senderName }
          });
        }
      } catch (e) {
        console.log('openChatFromNotification error:', e);
      }
    };

    // Обработка клика по уведомлению (когда приложение было в фоне)
    msg.onNotificationOpenedApp(remoteMessage => {
      console.log('Notification opened from background:', remoteMessage?.notification);
      openChatFromNotification(remoteMessage);
    });

    // Обработка уведомления, которое открыло приложение из закрытого состояния
    msg.getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('Notification opened app from quit state:', remoteMessage?.notification);
          // Небольшая задержка, чтобы навигация успела инициализироваться
          setTimeout(() => openChatFromNotification(remoteMessage), 500);
        }
      })
      .catch(err => console.error('getInitialNotification failed:', err));

    return unsubscribe;
  } catch (error) {
    console.error('Firebase messaging setup failed:', error);
  }
}

export async function getFcmToken() {
  if (Platform.OS === 'web') return null;
  try {
    const msg = await getMessaging();
    if (!msg) {
      console.log('[FCM] Messaging not available');
      return null;
    }
    
    // Register for remote notifications on iOS
    if (Platform.OS === 'ios') {
      await msg.registerDeviceForRemoteMessages();
    }

    const token = await msg.getToken();
    console.log('[FCM] Token obtained:', token ? (token.substring(0, 15) + '...') : 'NULL');
    if (token) {
      await storage.saveItem('fcm_token', token);
    } else {
      console.warn('[FCM] No token returned from getToken()');
    }
    return token;
  } catch (error) {
    console.error('[FCM] Failed to get FCM token:', error);
    // Дополнительные детали ошибки
    if (error.code) console.log('[FCM] Error code:', error.code);
    if (error.message) console.log('[FCM] Error message:', error.message);
    return null;
  }
}

export async function updateServerFcmToken(passedToken = null) {
  try {
    let token = passedToken;
    
    if (!token) {
      // Try to get from local storage first (faster)
      token = await storage.getItem('fcm_token');
    }
    
    if (!token) {
      // If still no token, try to fetch it from Firebase
      token = await getFcmToken();
    }

    if (!token) {
      console.log('FCM Token not available yet, will retry later.');
      return;
    }

    // Проверяем наличие токена авторизации
    const accessToken = await storage.getAccessToken();
    if (!accessToken) {
      console.log('User not authenticated, skipping FCM token update on server.');
      return;
    }

    const response = await usersApi.updateFcmToken(token);
    
    if (response.data && response.data.status === 'ok') {
      console.log('[FCM] Token updated on server SUCCESSFULLY:', token.substring(0, 15) + '...');
      // Store the last synced token and timestamp to avoid redundant updates
      await storage.saveItem('last_synced_fcm_token', token);
      await storage.saveItem('last_fcm_sync_time', new Date().toISOString());
      return { success: true, token };
    } else {
      console.log('[FCM] Token update response:', response.data);
      return { success: false, error: 'Unexpected server response' };
    }
  } catch (error) {
    if (error.response) {
      console.error('[FCM] Failed to update FCM token on server (Response Error):', error.response.status, error.response.data);
      return { success: false, error: `Server error: ${error.response.status}` };
    } else {
      console.error('[FCM] Failed to update FCM token on server:', error.message);
      return { success: false, error: error.message };
    }
  }
}
