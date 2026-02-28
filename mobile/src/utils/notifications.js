import messaging from '@react-native-firebase/messaging';
import { Alert, Platform, Vibration, Linking } from 'react-native';
import notifee, { AuthorizationStatus, EventType } from '@notifee/react-native';
import { usersApi, chatApi, setAuthToken } from '../api';
import { storage } from './storage';
import { initializeFirebase } from './firebaseInit';
import { navigationRef } from '../navigation/NavigationService';

import { displayBundledMessage, handleNotificationResponse, parseNotificationData } from './notificationUtils';

// Ensure Firebase is initialized before accessing messaging()
const getMessaging = async () => {
  if (Platform.OS === 'web') return null;

  try {
    // Check if we have any initialized apps
    const firebase = require('@react-native-firebase/app').default;
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

    // IOS/FCM permission
    const authStatus = await msg.requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    // Notifee permission (especially for Android 13+ and iOS)
    const settings = await notifee.requestPermission();
    const notifeeEnabled = settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;

    if (enabled && notifeeEnabled) {
      console.log('Authorization status (FCM):', authStatus);
      console.log('Authorization status (Notifee):', settings.authorizationStatus);
      return true;
    } else if (authStatus === messaging.AuthorizationStatus.DENIED || settings.authorizationStatus === AuthorizationStatus.DENIED) {
      Alert.alert(
        'Уведомления отключены',
        'Чтобы не пропускать сообщения, разрешите приложению отправлять уведомления в настройках телефона.',
        [
          { text: 'Позже', style: 'cancel' },
          { text: 'В настройки', onPress: () => Platform.OS === 'ios' ? Linking.openURL('app-settings:') : Linking.openSettings() }
        ]
      );
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

    // Слушатель событий Notifee (передний план)
    const unsubscribeForeground = notifee.onForegroundEvent((event) => {
      handleNotificationResponse(event);
    });

    // Регистрация категорий для iOS (нужно для кнопок Ответить/Прочитано)
    if (Platform.OS === 'ios') {
      try {
        await notifee.setNotificationCategories([
          {
            id: 'message_actions',
            actions: [
              {
                id: 'reply',
                title: 'Ответить',
                input: {
                  placeholderText: 'Ваш ответ...',
                  buttonTitle: 'Отправить',
                },
              },
              {
                id: 'mark-as-read',
                title: 'Прочитано',
              },
            ],
          },
        ]);
        console.log('[Notifee] iOS Categories registered');
      } catch (e) {
        console.log('[Notifee] iOS Categories registration failed:', e);
      }
    }

    // Обработка уведомлений, когда приложение на переднем плане (onMessage)
    const unsubscribeMessaging = msg.onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message received:', JSON.stringify(remoteMessage, null, 2));
      
      // Добавляем алерт для отладки в режиме разработки
      if (__DEV__) {
        Alert.alert(
          'FCM Message (Foreground)',
          `Title: ${remoteMessage?.notification?.title || 'No Title'}\nBody: ${remoteMessage?.notification?.body || 'No Body'}\nType: ${remoteMessage?.data?.type || 'No Type'}`
        );
      }

      // Проверяем, не открыт ли сейчас чат с отправителем
      const senderIdRaw = remoteMessage?.data?.sender_id || remoteMessage?.data?.senderId;
      const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
      const currentRoute = navigationRef?.getCurrentRoute?.();
      const isChatScreen = currentRoute?.name === 'Chat';
      const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
      const isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);

      if (!isActiveChatWithSender) {
        console.log('[FCM] Showing foreground notification via Notifee');
        await displayBundledMessage(remoteMessage);
      } else {
        console.log('[FCM] In active chat, skipping foreground notification banner');
      }
    });

    // Обработка обновления токена
    msg.onTokenRefresh(token => {
      console.log('FCM Token refreshed:', token);
      storage.saveItem('fcm_token', token);
      updateServerFcmToken(token);
    });

    // Унифицированная функция перехода (используется для FCM fallbacks)
    const openFromNotification = (remoteMessage) => {
      try {
        const data = remoteMessage?.data || {};
        const { type, senderId, senderName, newsId } = parseNotificationData(data);

        if (!navigationRef?.isReady?.()) return;

        if (type === 'new_message' && senderId) {
          navigationRef.navigate('Chat', { userId: senderId, userName: senderName });
          return;
        }

        if ((type === 'friend_request' || type === 'friend_accept')) {
          navigationRef.navigate('UsersMain', { initialTab: 'friends' });
          return;
        }

        if (type === 'new_post') {
          if (newsId) {
            navigationRef.navigate('NewsDetail', { newsId });
          } else {
            navigationRef.navigate('Feed');
          }
          return;
        }

        if (senderId) {
          navigationRef.navigate('Chat', { userId: senderId, userName: senderName });
        } else {
          navigationRef.navigate('Feed');
        }
      } catch (e) {
        console.error('[FCM] openFromNotification error:', e);
      }
    };

    // FCM fallbacks (на случай если Notifee не перехватил)
    msg.onNotificationOpenedApp(remoteMessage => {
      console.log('Notification opened from background (FCM):', remoteMessage?.notification);
      openFromNotification(remoteMessage);
    });

    msg.getInitialNotification().then(remoteMessage => {
      if (remoteMessage) {
        console.log('Initial notification (FCM):', remoteMessage?.notification);
        setTimeout(() => openFromNotification(remoteMessage), 500);
      }
    });

    // Обработка начального уведомления Notifee (если приложение было закрыто)
    notifee.getInitialNotification().then(initialNotification => {
      if (initialNotification) {
        console.log('Initial notification (Notifee):', initialNotification.notification.id);
        handleNotificationResponse(initialNotification);
      }
    });

    return () => {
      unsubscribeForeground();
      unsubscribeMessaging();
    };
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
      
      // Дополнительная проверка APNs токена (согласно гайду)
      const apnsToken = await msg.getAPNSToken();
      if (!apnsToken) {
        console.warn('[FCM] APNs token is null. Push notifications might not work on iOS simulator or if not configured.');
        // На симуляторах iOS APNs токена обычно нет, и getToken() может зависнуть или вернуть ошибку.
      } else {
        console.log('[FCM] APNs Token obtained:', apnsToken.substring(0, 10) + '...');
      }
    }

    const token = await msg.getToken();
    console.log('[FCM] Full Token obtained:', token);
    
    // В режиме разработки выводим токен в алерте, чтобы его можно было скопировать для теста
    if (__DEV__ && token) {
      console.log('--- COPY THIS TOKEN TO test_fcm.py ---');
      console.log(token);
      console.log('---------------------------------------');
      // Alert.alert('FCM Token (Dev Only)', token);
    }

    if (token) {
      const saved = await storage.getItem('fcm_token');
      if (saved !== token) {
        console.log('[FCM] Saving NEW token to storage');
        await storage.saveItem('fcm_token', token);
      }
    } else {
      console.warn('[FCM] No token returned from getToken() - check google-services.json and network');
    }
    return token;
  } catch (error) {
    console.error('[FCM] CRITICAL: Failed to get FCM token:', error);
    // Дополнительные детали ошибки
    if (error.code) console.log('[FCM] Error code:', error.code);
    if (error.message) console.log('[FCM] Error message:', error.message);
    if (error.nativeStackAndroid) console.log('[FCM] Native Android Stack present');
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




// --- Soft reminder to enable notifications (non-intrusive) ---
export async function checkAndRemindPermissions(options = {}) {
  if (Platform.OS === 'web') return;
  try {
    const { cooldownHours = 24 } = options;

    // Respect user opt-out
    try {
      const optOut = await storage.getItem('notif_reminder_opt_out');
      if (optOut === '1' || optOut === true) return;
    } catch (_) {}

    // Cross-platform permission check via Notifee
    const settings = await notifee.getSettings();
    const enabled = settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;

    if (enabled) return;

    // Cooldown to avoid being annoying
    try {
      const lastAt = await storage.getItem('notif_reminder_last_at');
      if (lastAt) {
        const lastMs = Date.parse(lastAt);
        if (!Number.isNaN(lastMs)) {
          const diffH = (Date.now() - lastMs) / 36e5;
          if (diffH < cooldownHours) {
            return;
          }
        }
      }
    } catch (_) {}

    Alert.alert(
      'Включите уведомления',
      'Чтобы не пропускать новые сообщения, включите уведомления для приложения в настройках телефона.',
      [
        { text: 'Не напоминать', style: 'destructive', onPress: async () => { try { await storage.saveItem('notif_reminder_opt_out', '1'); } catch (_) {} } },
        { text: 'Позже', style: 'cancel' },
        { text: 'В настройки', onPress: () => Platform.OS === 'ios' ? Linking.openURL('app-settings:') : Linking.openSettings() },
      ]
    );

    try {
      await storage.saveItem('notif_reminder_last_at', new Date().toISOString());
      const cntRaw = await storage.getItem('notif_reminder_count');
      const cnt = cntRaw ? parseInt(cntRaw, 10) || 0 : 0;
      await storage.saveItem('notif_reminder_count', String(cnt + 1));
    } catch (_) {}
  } catch (e) {
    console.log('[Notifications] checkAndRemindPermissions error:', e?.message || e);
  }
}
