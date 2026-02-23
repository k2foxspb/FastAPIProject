import firebase from '@react-native-firebase/app';
import messaging from '@react-native-firebase/messaging';
import { Alert, Platform, Vibration, Linking } from 'react-native';
import notifee, { AndroidImportance, AndroidStyle, EventType } from '@notifee/react-native';
import { usersApi, chatApi, setAuthToken } from '../api';
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
    } else if (authStatus === messaging.AuthorizationStatus.DENIED) {
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

    // Создаем канал уведомлений для Android
    if (Platform.OS === 'android') {
      try {
        const Notifications = require('expo-notifications');
        // Канал Expo: включаем vibration по умолчанию
        Notifications.setNotificationChannelAsync('messages', {
          name: 'Сообщения',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
          sound: 'default',
        }).catch(err => console.log('Error creating notification channel:', err));
      } catch (e) {
        console.log('expo-notifications not available, skipping channel creation.');
      }
    }

    // Обработка уведомлений, когда приложение на переднем плане
    const unsubscribe = msg.onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message received:', JSON.stringify(remoteMessage, null, 2));

      // При открытом приложении: только короткий звук, без баннера и без вибрации
      if (Platform.OS === 'android') {
        try {
          const Notifications = require('expo-notifications');
          const { navigationRef } = require('../navigation/NavigationService');

          // Проверяем, не открыт ли сейчас чат с отправителем — если открыт, не проигрываем системный звук
          const senderIdRaw = remoteMessage?.data?.sender_id || remoteMessage?.data?.senderId;
          const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
          const currentRoute = navigationRef?.getCurrentRoute?.();
          const isChatScreen = currentRoute?.name === 'Chat';
          const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
          const isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);

          // В фореграунде не создаём локальные уведомления вовсе — логику звука/вибрации обрабатывает WS в NotificationContext
          Notifications.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowBanner: false,
              shouldShowList: false,
              shouldPlaySound: false,
              shouldSetBadge: false,
            }),
          });
          console.log('[FCM] Foreground received, suppressed by handler (WS will handle sound/vibration)');
        } catch (e) {
          console.log('[FCM] Error handling foreground message (sound-only):', e);
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
    const openFromNotification = (remoteMessage) => {
      try {
        console.log('[FCM] Handling notification click with data:', JSON.stringify(remoteMessage?.data, null, 2));
        const data = remoteMessage?.data || {};
        const type = data.type || data.msg_type || 'new_message';
        const senderIdRaw = data.sender_id || data.senderId || data.user_id || data.userId || data.chat_id;
        const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
        const senderName = data.sender_name || data.senderName || undefined;
        const newsIdRaw = data.news_id || data.newsId;
        const newsId = newsIdRaw ? parseInt(newsIdRaw, 10) : null;

        if (!navigationRef?.isReady?.()) {
          console.log('[FCM] Navigation not ready, skipping');
          return;
        }

        if (type === 'new_message' && senderId) {
          console.log('[FCM] Navigating to Chat with userId:', senderId);
          // Сразу очищаем пачку уведомлений при переходе
          try {
            const notifee = require('@notifee/react-native').default;
            notifee.cancelNotification(`sender_${senderId}`).catch(() => {});
          } catch (_) {}

          navigationRef.navigate('Messages', {
            screen: 'Chat',
            params: { userId: senderId, userName: senderName }
          });
          return;
        }

        if ((type === 'friend_request' || type === 'friend_accept')) {
          console.log('[FCM] Navigating to UsersMain (friends tab)');
          // Users screen is registered as UsersMain in TabNavigator
          navigationRef.navigate('UsersMain', { initialTab: 'friends' });
          return;
        }

        if (type === 'new_post') {
          if (newsId) {
            console.log('[FCM] Navigating to NewsDetail with newsId:', newsId);
            navigationRef.navigate('NewsDetail', { newsId });
          } else {
            console.log('[FCM] Navigating to Feed (fallback, no newsId)');
            navigationRef.navigate('Feed');
          }
          return;
        }

        // Fallbacks
        if (senderId) {
          console.log('[FCM] Fallback: navigating to Chat with userId:', senderId);
          navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName } });
        } else {
          console.log('[FCM] No known target in notification data, opening Feed');
          navigationRef.navigate('Feed');
        }
      } catch (e) {
        console.error('[FCM] openFromNotification error:', e);
      }
    };

    // Обработка клика по уведомлению (когда приложение было в фоне)
    msg.onNotificationOpenedApp(remoteMessage => {
      console.log('Notification opened from background:', remoteMessage?.notification);
      openFromNotification(remoteMessage);
    });

    // Обработка уведомления, которое открыло приложение из закрытого состояния
    msg.getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          console.log('Notification opened app from quit state:', remoteMessage?.notification);
          // Небольшая задержка, чтобы навигация успела инициализироваться
          setTimeout(() => openFromNotification(remoteMessage), 500);
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

// --- Notifee helpers for Android grouping & actions ---
async function ensureNotifeeChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.createChannel({
      id: 'messages',
      name: 'Сообщения',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
    });
  } catch (e) {
    console.log('[Notifee] createChannel error:', e?.message || e);
  }
}

async function displayBundledMessage(remoteMessage) {
  try {
    const data = remoteMessage?.data || {};
    const senderIdRaw = data.sender_id || data.senderId || data.user_id || data.userId || data.chat_id;
    const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
    if (!senderId) return;

    const senderName = data.sender_name || data.senderName || 'Сообщение';
    const text = data.text || data.body || remoteMessage?.notification?.body || '';
    const ts = Date.now();

    await ensureNotifeeChannel();

    // Храним последние N сообщений по отправителю, чтобы формировать MessagingStyle
    const key = `notif_messages_${senderId}`;
    let list = [];
    try {
      const saved = await storage.getItem(key);
      list = saved ? JSON.parse(saved) : [];
    } catch (_) {}
    list.push({ text, ts, me: false });
    if (list.length > 7) list = list.slice(-7);
    try { await storage.saveItem(key, JSON.stringify(list)); } catch (_) {}

    const messages = list.map(m => ({
      text: m.text,
      timestamp: m.ts || ts,
      person: { name: m.me ? 'Вы' : senderName },
    }));

    await notifee.displayNotification({
      id: `sender_${senderId}`,
      title: senderName,
      body: text,
      android: {
        channelId: 'messages',
        groupId: `sender_${senderId}`,
        smallIcon: 'ic_launcher',
        showTimestamp: true,
        style: {
          type: AndroidStyle.MESSAGING,
          person: { name: senderName },
          messages,
        },
        pressAction: { id: 'open-chat', launchActivity: 'default' },
        actions: [
          { title: 'Ответить', pressAction: { id: 'reply' }, input: { allowFreeFormInput: true, placeholder: 'Ваш ответ…' } },
          { title: 'Прочитано', pressAction: { id: 'mark-as-read' } },
        ],
      },
      data: { senderId: String(senderId), senderName },
    });
  } catch (e) {
    console.log('[Notifee] displayBundledMessage error:', e?.message || e);
  }
}

async function handleNotifeeEvent(type, detail) {
  try {
    if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;
    const pressId = detail?.pressAction?.id;
    const notifData = detail?.notification?.data || {};
    const senderId = notifData?.senderId ? parseInt(notifData.senderId, 10) : null;
    const senderName = notifData?.senderName;

    if (pressId === 'reply') {
      const input = detail?.input || '';
      if (senderId && input) {
        const token = await storage.getAccessToken();
        try {
          await chatApi.sendMessage({ receiver_id: senderId, message: input, message_type: 'text' }, token);
        } catch (e) {
          console.log('[Notifee] reply sendMessage error:', e?.message || e);
        }
      }
      return;
    }

    if (pressId === 'mark-as-read') {
      if (senderId) {
        const token = await storage.getAccessToken();
        try {
          await chatApi.markAsRead(senderId, token);
        } catch (e) {
          console.log('[Notifee] markAsRead error:', e?.message || e);
        }
        try {
          await notifee.cancelNotification(`sender_${senderId}`);
        } catch (_) {}
      }
      return;
    }

    if (pressId === 'open-chat' && navigationRef?.isReady?.() && senderId) {
      navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName } });
      try { await notifee.cancelNotification(`sender_${senderId}`); } catch (_) {}
      return;
    }
  } catch (e) {
    console.log('[Notifee] handleNotifeeEvent error:', e?.message || e);
  }
}

if (Platform.OS !== 'web') {
  try {
    // Фоновая обработка FCM: собираем локальные уведомления через Notifee (Android)
    messaging().setBackgroundMessageHandler(async remoteMessage => {
      if (Platform.OS === 'android') {
        // Если сервер прислал системный блок notification, ОС сама покажет уведомление — избегаем дубликатов
        const hasSystemNotification = !!(remoteMessage?.notification && (remoteMessage.notification.title || remoteMessage.notification.body));
        if (!hasSystemNotification) {
          await displayBundledMessage(remoteMessage);
        }
      }
    });
  } catch (e) {
    console.log('[FCM] setBackgroundMessageHandler error:', e?.message || e);
  }

  try {
    notifee.onBackgroundEvent(async ({ type, detail }) => {
      await handleNotifeeEvent(type, detail);
    });
  } catch (e) {
    console.log('[Notifee] onBackgroundEvent setup error:', e?.message || e);
  }

  try {
    notifee.onForegroundEvent(async ({ type, detail }) => {
      await handleNotifeeEvent(type, detail);
    });
  } catch (e) {
    console.log('[Notifee] onForegroundEvent setup error:', e?.message || e);
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
    let settings;
    try {
      settings = await notifee.getNotificationSettings();
    } catch (e) {
      console.log('[Notifications] getNotificationSettings failed:', e?.message || e);
      return;
    }
    const status = settings?.authorizationStatus;
    const enabled = status === notifee.AuthorizationStatus.AUTHORIZED || status === notifee.AuthorizationStatus.PROVISIONAL;
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
