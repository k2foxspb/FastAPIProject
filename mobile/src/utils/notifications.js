import messaging from '@react-native-firebase/messaging';
import { Alert, Platform, Vibration, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
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

    // Android POST_NOTIFICATIONS permission (for Android 13+)
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      const { PermissionsAndroid } = require('react-native');
      const hasPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      
      if (!hasPermission) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        console.log('[FCM] Android POST_NOTIFICATIONS permission request result:', granted);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.warn('[FCM] Android POST_NOTIFICATIONS permission denied');
          // Мы не выходим сразу, так как FCM permission может быть уже AUTHORIZED, 
          // но на Android 13+ системные уведомления всё равно не покажутся без этого.
        }
      } else {
        console.log('[FCM] Android POST_NOTIFICATIONS permission already granted');
      }
    }

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

    // Настраиваем глобальный хендлер уведомлений
    if (Platform.OS === 'android') {
      try {
        // Подавляем стандартные баннеры Expo-notifications на Android в Foreground по умолчанию,
        // но разрешаем, если мы сами их запланировали через scheduleNotificationAsync.
        Notifications.setNotificationHandler({
          handleNotification: async (notification) => {
            // Проверяем, в чате ли мы с отправителем (чтобы не показывать баннер, если чат открыт)
            const currentRoute = navigationRef?.getCurrentRoute?.();
            const isChatScreen = currentRoute?.name === 'Chat';
            const data = notification.request.content.data || {};
            const senderIdRaw = data.sender_id || data.senderId;
            const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
            const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
            const isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);

            if (isActiveChatWithSender) {
              return {
                shouldShowBanner: false,
                shouldShowList: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
              };
            }

            return {
              shouldShowBanner: true,
              shouldShowList: true,
              shouldPlaySound: true,
              shouldSetBadge: true,
              priority: Notifications.AndroidNotificationPriority.MAX,
            };
          },
        });

        // Создаем канал уведомлений
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

    // Обработка уведомлений, когда приложение на переднем плани (onMessage)
    const unsubscribe = msg.onMessage(async remoteMessage => {
      console.log('[FCM] Foreground message received:', JSON.stringify(remoteMessage, null, 2));

      if (Platform.OS === 'android') {
        try {
          // Проверяем, не открыт ли сейчас чат с отправителем
          const senderIdRaw = remoteMessage?.data?.sender_id || remoteMessage?.data?.senderId;
          const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
          const currentRoute = navigationRef?.getCurrentRoute?.();
          const isChatScreen = currentRoute?.name === 'Chat';
          const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
          const isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);

          if (!isActiveChatWithSender) {
            console.log('[FCM] Showing foreground notification via Expo-Notifications');
            // ВАЖНО: Мы вызываем displayBundledMessage, который использует тот же identifier, что и tag в FCM.
            // Это обновит/заменит системное уведомление на кастомное с кнопками.
            await displayBundledMessage(remoteMessage);
          } else {
            console.log('[FCM] In active chat, skipping foreground notification banner (WS will handle sound)');
            // Если мы в чате, нам нужно убрать системное уведомление, которое Android показал автоматически
            const tag = remoteMessage?.data?.notif_tag || remoteMessage?.notification?.android?.tag;
            if (tag) {
              Notifications.dismissNotificationAsync(tag).catch(() => {});
            }
          }
        } catch (e) {
          console.log('[FCM] Error handling foreground message:', e);
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
        const { type, senderId, senderName, newsId } = parseNotificationData(data);

        if (!navigationRef?.isReady?.()) {
          console.log('[FCM] Navigation not ready, skipping');
          return;
        }

        if (type === 'new_message' && senderId) {
          console.log('[FCM] Navigating to Chat with userId:', senderId);
          // Сразу очищаем пачку уведомлений при переходе
          try {
            storage.removeItem(`notif_messages_${senderId}`).catch(() => {});
          } catch (_) {}

          navigationRef.navigate('Chat', { userId: senderId, userName: senderName });
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
          navigationRef.navigate('Chat', { userId: senderId, userName: senderName });
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

    // --- EXPO NOTIFICATIONS HANDLERS ---
    // Слушатель входящих уведомлений на переднем плане (для логики внутри приложения)
    const notificationReceivedSubscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('[Notifications] Foreground notification received by Expo:', notification.request.identifier);
      Vibration.vibrate(100); // Тактильная отдача как в руководстве
    });

    // Обработка клика по уведомлению (передний план / фон)
    const notificationSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('[Notifications] Response received');
      Vibration.vibrate(70); // Небольшая вибрация при клике
      handleNotificationResponse(response);
    });

    // Обработка уведомления, которое открыло приложение из закрытого состояния (Expo)
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        console.log('[Notifications] Initial response found');
        handleNotificationResponse(response);
      }
    });

    return () => {
      unsubscribe();
      notificationReceivedSubscription.remove();
      notificationSubscription.remove();
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

    // Cross-platform permission check via Expo-Notifications
    const settings = await Notifications.getPermissionsAsync();
    const enabled = settings.status === 'granted' || settings.canAskAgain;

    if (enabled && settings.status === 'granted') return;

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
