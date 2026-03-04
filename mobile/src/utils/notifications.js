import { Alert, Platform, Vibration, Linking, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import messaging from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import firebase from '@react-native-firebase/app';

import { usersApi, chatApi, setAuthToken } from '../api';
import { storage } from './storage';
import { navigationRef } from '../navigation/NavigationService';
import { displayBundledMessage, handleNotificationResponse, parseNotificationData } from './notificationUtils';

// Global state to track if native module is broken during session
let nativeMessagingBroken = false;
let lastMessagingUnavailableReason = null;
// Expo Go doesn't support @react-native-firebase/messaging.
// IMPORTANT: `appOwnership === 'expo'` can also be true for Dev Client / development builds,
// so we primarily rely on `executionEnvironment === 'storeClient'` (Expo Go).
const isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  (Constants.executionEnvironment == null && Constants.appOwnership === 'expo');

// Helper to get messaging instance safely
export const getMessaging = async () => {
  if (Platform.OS === 'web') return null;
  if (isExpoGo) {
    lastMessagingUnavailableReason = 'expo_go';
    return null;
  }
  if (nativeMessagingBroken) {
    lastMessagingUnavailableReason = 'native_module_broken';
    return null;
  }

  try {
    // 1. Попытка получить инстанс через стандартный импорт
    let msgInstance = null;
    try {
      msgInstance = messaging();
    } catch (e) {
      console.log('[FCM] messaging() call failed, trying fallback...');
    }

    // 2. Если не вышло, пробуем через firebase.messaging()
    if (!msgInstance) {
      try {
        msgInstance = firebase.messaging();
      } catch (e) {
        console.log('[FCM] firebase.messaging() call failed');
      }
    }

    if (!msgInstance) {
      nativeMessagingBroken = true;
      lastMessagingUnavailableReason = 'no_messaging_instance';
      return null;
    }

    // 3. Проверка наличия методов (защита от "пустого" нативного модуля)
    if (typeof msgInstance.getToken !== 'function') {
      console.error('[FCM] getToken is not a function on messaging instance');
      nativeMessagingBroken = true;
      lastMessagingUnavailableReason = 'missing_methods';
      return null;
    }

    return msgInstance;
  } catch (e) {
    console.error('[FCM] Error in getMessaging:', e);
    lastMessagingUnavailableReason = `exception:${e.message}`;
    return null;
  }
};

export function getLastMessagingUnavailableReason() {
  return lastMessagingUnavailableReason;
}

// --- Delete and Reset FCM Token ---
export async function resetFcmToken() {
  if (Platform.OS === 'web') return false;
  try {
    const msg = await getMessaging();
    if (!msg) return false;

    console.log('[FCM] Force resetting FCM token...');
    
    // 0. Unregister from remote messages first
    try {
      if (Platform.OS === 'android') {
        await msg.unregisterDeviceForRemoteMessages();
        console.log('[FCM] Device unregistered from remote messages');
      }
    } catch (e) {
      console.log('[FCM] Unregister failed (non-critical):', e.message);
    }

    // 1. Delete the current token from Firebase
    if (typeof msg.deleteToken === 'function') {
      await msg.deleteToken();
      console.log('[FCM] Token deleted from Firebase');
    } else {
      console.warn('[FCM] deleteToken not available, skipping');
    }

    // 2. Clear from local storage
    await storage.saveItem('fcm_token', null);
    await storage.saveItem('last_synced_fcm_token', null);
    
    // 3. Wait a bit for Firebase to process deletion
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Get a new one
    const newToken = await msg.getToken();
    if (newToken) {
      console.log('[FCM] New token generated after reset:', newToken.substring(0, 15) + '...');
      await storage.saveItem('fcm_token', newToken);
      // 4. Update on server
      await updateServerFcmToken(newToken);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[FCM] Failed to reset FCM token:', e);
    return false;
  }
}

export async function requestUserPermission() {
  if (Platform.OS === 'web') return false;
  try {
    const msg = await getMessaging();
    if (!msg) return false;

    // IOS/FCM permission
    const authStatus = await msg.requestPermission();
    // 1 = AUTHORIZED, 2 = PROVISIONAL
    const enabled = authStatus === 1 || authStatus === 2;

    // Notifee permission (especially for Android 13+ and iOS)
    const settings = await notifee.requestPermission();
    // 1 = AUTHORIZED
    const notifeeEnabled = settings.authorizationStatus >= 1; 

    if (enabled && notifeeEnabled) {
      console.log('Authorization status (FCM):', authStatus);
      console.log('Authorization status (Notifee):', settings.authorizationStatus);
      return true;
    } else if (authStatus === 0 || settings.authorizationStatus === 0) {
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

export async function setupCloudMessaging(onNotificationReceived = null) {
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

    // Обработка уведомлений, когда приложение на переднем переднем плане (onMessage)
    const unsubscribeMessaging = msg.onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message (onMessage) received!');
      console.log('[FCM] MessageId:', remoteMessage?.messageId);
      console.log('[FCM] Data keys:', Object.keys(remoteMessage?.data || {}));
      
      // Добавляем алерт для отладки в режиме разработки
      if (__DEV__) {
        console.log('[FCM] Showing Debug Alert (Foreground)...');
        Alert.alert(
          'FCM Foreground (DEBUG)',
          `Title: ${remoteMessage?.data?.notif_title || remoteMessage?.notification?.title || 'No Title'}\nBody: ${remoteMessage?.data?.notif_body || remoteMessage?.notification?.body || 'No Body'}\nMsgId: ${remoteMessage?.messageId}`
        );
      }

      // Проверяем, не открыт ли сейчас чат с отправителем
      const senderIdRaw = remoteMessage?.data?.sender_id || remoteMessage?.data?.senderId;
      const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
      const currentRoute = navigationRef?.getCurrentRoute?.();
      const isChatScreen = currentRoute?.name === 'Chat';
      const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
      const isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);

      // ВСЕГДА передаем сообщение в контекст, если есть коллбэк, 
      // чтобы гарантировать отображение в чате даже если WebSocket подвел
      if (onNotificationReceived) {
        console.log('[FCM] Passing foreground message to context callback');
        onNotificationReceived(remoteMessage);
      }

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
          navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName || 'Чат' } });
          return;
        }

        if ((type === 'friend_request' || type === 'friend_accept')) {
          navigationRef.navigate('Users', { screen: 'UsersMain', params: { initialTab: 'friends' } });
          return;
        }

        if (type === 'new_post') {
          if (newsId) {
            navigationRef.navigate('Feed', { screen: 'NewsDetail', params: { newsId } });
          } else {
            navigationRef.navigate('Feed');
          }
          return;
        }

        if (senderId) {
          navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName || 'Чат' } });
        } else {
          navigationRef.navigate('Feed');
        }
      } catch (e) {
        console.error('[FCM] openFromNotification error:', e);
      }
    };

    // FCM fallbacks (на случай если Notifee не перехватил)
    if (msg && typeof msg.onNotificationOpenedApp === 'function') {
      msg.onNotificationOpenedApp(remoteMessage => {
        console.log('Notification opened from background (FCM):', remoteMessage?.notification);
        openFromNotification(remoteMessage);
      });
    }

    if (msg && typeof msg.getInitialNotification === 'function') {
      try {
        msg.getInitialNotification().then(remoteMessage => {
          if (remoteMessage) {
            console.log('Initial notification (FCM):', remoteMessage?.notification);
            setTimeout(() => openFromNotification(remoteMessage), 500);
          }
        }).catch(e => {
          console.warn('[FCM] getInitialNotification async error:', e.message);
        });
      } catch (e) {
        console.warn('[FCM] getInitialNotification sync error:', e.message);
      }
    }

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
      const reason = lastMessagingUnavailableReason || 'unknown';
      console.log(`[FCM] Messaging not available (reason=${reason})`);
      return null;
    }
    
    // Register for remote notifications on both platforms
    try {
      if ((Platform.OS === 'ios' || Platform.OS === 'android') && typeof msg.registerDeviceForRemoteMessages === 'function') {
        console.log(`[FCM] Registering device for remote messages (${Platform.OS})...`);
        await msg.registerDeviceForRemoteMessages();
        console.log(`[FCM] Device registered successfully (${Platform.OS})`);
      }
    } catch (e) {
      console.log(`[FCM] Registration warning (non-critical): ${e.message}`);
    }

    // iOS-specific: Additional APNs token check
    if (Platform.OS === 'ios' && typeof msg.getAPNSToken === 'function') {
      const apnsToken = await msg.getAPNSToken();
      if (!apnsToken) {
        console.warn('[FCM] APNs token is null. Push notifications might not work on iOS simulator or if not configured.');
      } else {
        console.log('[FCM] APNs Token obtained:', apnsToken.substring(0, 10) + '...');
      }
    }

    console.log('[FCM] Calling msg.getToken()...');
    let token = null;
    try {
      // Use a timeout for getToken to prevent hanging
      let tokenPromise = null;
      if (typeof msg.getToken === 'function') {
        tokenPromise = msg.getToken();
      } else {
        throw new Error('getToken method missing');
      }

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getToken timeout (15s)')), 15000)
      );
      
      token = await Promise.race([tokenPromise, timeoutPromise]);
    } catch (e) {
      console.error(`[FCM] getToken failed: ${e.message}`);
      const isNativeError = e.message?.includes('native') || e.message?.includes('not a function') || e.message?.includes('undefined') || e.message?.includes('RNFBMessagingModule');
      if (isNativeError) {
        console.error('[FCM] CRITICAL NATIVE ERROR: Native module is incomplete. REBUILD REQUIRED (npx expo run:android).');
        nativeMessagingBroken = true;
      }
      // If regular getToken fails, try with senderId as fallback
      try {
        const senderId = "176773891332"; 
        
        if (typeof msg.getToken === 'function') {
          console.log(`[FCM] Attempting getToken with explicit senderId: ${senderId}`);
          token = await msg.getToken(senderId);
        }
      } catch (e2) {
        console.error(`[FCM] getToken with senderId also failed: ${e2.message}`);
      }
      
      if (!token) throw e;
    }
    console.log('[FCM] Full Token obtained:', token ? (token.substring(0, 20) + '...') : 'NULL');
    
    // В режиме разработки выводим токен в алерте, чтобы его можно было скопировать для теста
    if (__DEV__ && token) {
      console.log('--- COPY THIS TOKEN TO test_fcm.py ---');
      console.log(token);
      console.log('---------------------------------------');
      Alert.alert('FCM Token (Dev Only)', token);
    }

    if (token) {
      console.log('[FCM] Token obtained successfully');
      
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

export async function updateServerFcmToken(passedToken = null, forceSync = false) {
  try {
    let token = passedToken;
    
    // If forceSync is true, we perform a complete reset (deleteToken + getToken)
    // to avoid using cached but invalid tokens from previous sessions/installs.
    if (!token && forceSync) {
      console.log('[FCM] forceSync is TRUE, performing full resetFcmToken...');
      // Note: resetFcmToken will internally call updateServerFcmToken(newToken)
      const success = await resetFcmToken();
      if (success) {
        console.log('[FCM] forceSync successful via resetFcmToken');
        return { success: true, resetPerformed: true };
      } else {
        console.warn('[FCM] forceSync FAILED during resetFcmToken, falling back to getFcmToken');
        token = await getFcmToken();
      }
    }
    
    if (!token) {
      // Try to get from local storage first (faster)
      token = await storage.getItem('fcm_token');
    }
    
    if (!token) {
      // If still no token, try to fetch it from Firebase
      token = await getFcmToken();
    }

    if (!token) {
      const reason = getLastMessagingUnavailableReason();
      const reasonSuffix = reason ? ` (reason=${reason})` : '';
      console.log(`FCM Token not available yet, will retry later.${reasonSuffix}`);
      return { success: false, error: `FCM token not available yet${reasonSuffix}` };
    }

    // Проверяем наличие токена авторизации
    const accessToken = await storage.getAccessToken();
    if (!accessToken) {
      console.log('User not authenticated, skipping FCM token update on server.');
      return;
    }

    // Если токен не изменился, не шлем (кроме случая принудительной синхронизации)
    if (!forceSync) {
      const lastSynced = await storage.getItem('last_synced_fcm_token');
      if (lastSynced === token) {
        console.log('[FCM] Token already synced with server, skipping.');
        return { success: true, token, alreadySynced: true };
      }
    }

    const response = await usersApi.updateFcmToken(token);
    
    if (response.data && response.data.status === 'ok') {
      console.log('[FCM] Token updated on server SUCCESSFULLY:', token.substring(0, 15) + '...');
      
      // If server reported that token was empty/cleared, it might have been invalidated due to UnregisteredError.
      // If we are not already in a forceSync/reset flow, let's trigger a full reset to ensure we have a fresh token.
      if (response.data.was_cleared && !forceSync && !passedToken) {
        console.log('[FCM] Server reported token was cleared. Triggering full reset to ensure fresh token...');
        // We don't await to avoid recursion/blocking, it will sync itself after reset
        resetFcmToken().catch(err => console.error('[FCM] Background reset failed:', err));
      }

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
    if (!notifee || typeof notifee.getSettings !== 'function') {
      console.log('[Notifications] Notifee or getSettings not available, skipping permission reminder');
      return;
    }
    
    const settings = await notifee.getSettings();
    const enabled = settings.authorizationStatus >= 1; // 1 = AUTHORIZED

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
