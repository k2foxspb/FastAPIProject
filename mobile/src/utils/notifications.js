import { Alert, Platform, Vibration, Linking, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import {
  getMessaging,
  requestPermission,
  onMessage,
  onTokenRefresh,
  onNotificationOpenedApp,
  getInitialNotification,
  unregisterDeviceForRemoteMessages,
  deleteToken,
  getToken,
  registerDeviceForRemoteMessages,
  getAPNSToken,
  isDeviceRegisteredForRemoteMessages
} from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';

import { usersApi, chatApi, setAuthToken } from '../api';
import { storage } from './storage';
import { navigationRef } from '../navigation/NavigationService';
import { displayBundledMessage, handleNotificationResponse, parseNotificationData } from './notificationUtils';

// Global state to track if native module is broken during session
let nativeMessagingBroken = false;
let lastMessagingUnavailableReason = null;
const activeSyncs = new Set();
// Expo Go doesn't support @react-native-firebase/messaging.
// IMPORTANT: `appOwnership === 'expo'` can also be true for Dev Client / development builds,
// where FCM DOES work. So we ONLY block if explicitly in 'storeClient' (Expo Go).
const isExpoGo = Constants.executionEnvironment === 'storeClient';

/**
 * Helper to safely get the messaging instance.
 * Using getMessaging() is the modern modular way (v22+).
 */
const getMessagingSafe = () => {
  if (isExpoGo) return null;
  try {
    const messaging = getMessaging();
    if (!messaging) return null;
    return messaging;
  } catch (e) {
    if (__DEV__ && !nativeMessagingBroken) {
      console.log('[FCM] getMessagingSafe error:', e.message);
    }
    return null;
  }
};

// Helper to check if messaging is available safely
export const isMessagingAvailable = async () => {
  if (Platform.OS === 'web') return false;
  
  if (isExpoGo) {
    lastMessagingUnavailableReason = 'expo_go';
    return false;
  }

  const messaging = getMessagingSafe();

  // Debug logging for developers to understand what's available
  if (__DEV__) {
    console.log('[FCM] Checking availability:', {
      nativeMessagingBroken,
      hasMessaging: !!messaging,
      typeofOnMessage: typeof onMessage,
      typeofGetToken: typeof getToken,
      typeofRequestPermission: typeof requestPermission
    });
  }

  if (nativeMessagingBroken) {
    lastMessagingUnavailableReason = 'native_module_broken';
    // We don't return false immediately anymore, we try to re-verify 
    // to avoid permanent lockout if it was a transient error
    if (!__DEV__) return false;
  }

  try {
    // We are available if messaging instance exists and modular functions are present
    const hasMessaging = !!messaging;
    const hasModularAPI = typeof onMessage === 'function' && typeof getToken === 'function';

    if (!hasMessaging || !hasModularAPI) {
      if (__DEV__) {
        console.error('[FCM] Native messaging module not found (Messaging instance or Modular APIs missing)', {
          hasMessaging,
          hasModularAPI
        });
      }
      nativeMessagingBroken = true;
      lastMessagingUnavailableReason = 'missing_methods';
      return false;
    }

    // If we reached here, something is working
    if (nativeMessagingBroken) {
      console.log('[FCM] Native module seems to have recovered');
      nativeMessagingBroken = false;
    }
    
    return true;
  } catch (e) {
    console.error('[FCM] Error in isMessagingAvailable:', e);
    lastMessagingUnavailableReason = `exception:${e.message}`;
    return false;
  }
};

export function getLastMessagingUnavailableReason() {
  return lastMessagingUnavailableReason;
}

// --- Delete and Reset FCM Token ---
export async function resetFcmToken() {
  if (Platform.OS === 'web') return false;
  try {
    const available = await isMessagingAvailable();
    if (!available) return false;

    const messaging = getMessagingSafe();
    if (!messaging) return false;

    console.log('[FCM] Force resetting FCM token...');
    
    // 0. Unregister from remote messages first
    try {
      if (Platform.OS === 'android') {
        const isRegistered = typeof isDeviceRegisteredForRemoteMessages === 'function' 
          ? await isDeviceRegisteredForRemoteMessages(messaging)
          : true;

        if (isRegistered) {
          if (typeof unregisterDeviceForRemoteMessages === 'function') {
            await unregisterDeviceForRemoteMessages(messaging);
          }
          console.log('[FCM] Device unregistered from remote messages');
        }
      }
    } catch (e) {
      console.log('[FCM] Unregister failed (non-critical):', e.message);
    }

    // 1. Delete the current token from Firebase
    try {
      if (typeof deleteToken === 'function') {
        await deleteToken(messaging);
        console.log('[FCM] Token deleted from Firebase');
      }
    } catch (e) {
      console.log('[FCM] Token deletion failed:', e.message);
    }

    // 2. Clear from local storage
    await storage.saveItem('fcm_token', null);
    await storage.saveItem('last_synced_fcm_token', null);
    
    // 3. Wait a bit for Firebase to process deletion
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Get a new one
    let newToken = null;
    try {
      if (typeof getToken === 'function') {
        console.log('[FCM] resetFcmToken: Calling modular getToken()...');
        newToken = await getToken(messaging);
      }
    } catch (e) {
      console.log('[FCM] Token generation after reset failed:', e.message);
      // Mark native module as broken if it's a TypeError or native error
      if (e.message.includes('undefined') || e.message.includes('not a function') || e.message.includes('native')) {
        nativeMessagingBroken = true;
      }
    }
    
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
    const available = await isMessagingAvailable();
    if (!available) return false;

    const messaging = getMessagingSafe();
    if (!messaging) return false;

    // IOS/FCM permission
    let authStatus = 0;
    try {
      // Modern modular requestPermission() (RN Firebase v22+)
      if (typeof requestPermission === 'function') {
        console.log('[FCM] Calling modular requestPermission()...');
        authStatus = await requestPermission(messaging);
      } else {
        throw new Error('Firebase Messaging requestPermission method not found');
      }
    } catch (e) {
      console.log('[FCM] requestPermission primary attempt failed:', e.message);
      
      if (e.message.includes('undefined') || e.message.includes('not a function')) {
        lastMessagingUnavailableReason = 'native_module_missing';
      }
      
      // If we still don't have authStatus, it might be a real failure
      if (authStatus === undefined || authStatus === null) {
        authStatus = 0; // Treat as denied if we can't even get a status
      }
    }
    
    // 1 = AUTHORIZED, 2 = PROVISIONAL
    const enabled = authStatus === 1 || authStatus === 2;

    // Notifee permission (especially for Android 13+ and iOS)
    let notifeeEnabled = false;
    try {
      if (notifee && typeof notifee.requestPermission === 'function') {
        const settings = await notifee.requestPermission();
        // 1 = AUTHORIZED, 2 = PROVISIONAL (for iOS)
        notifeeEnabled = settings.authorizationStatus >= 1; 
        console.log('[Notifications] Notifee authorizationStatus:', settings.authorizationStatus);
      } else {
        console.log('[Notifications] Notifee or requestPermission not available, using fallback');
        // On Android < 13 or if notifee is partially loaded
        notifeeEnabled = true;
      }
    } catch (e) {
      console.log('[Notifications] Notifee requestPermission failed:', e.message);
      notifeeEnabled = true; // Fallback to allow FCM to continue
    }

    if (enabled && notifeeEnabled) {
      console.log('Authorization status (FCM):', authStatus);
      return true;
    } else {
      // If we failed but it's not strictly 0 (denied), we might still be okay on some systems
      if (enabled) {
        console.log('[FCM] FCM enabled, but Notifee failed. Continuing anyway.');
        return true;
      }

      if (authStatus === 0) {
        Alert.alert(
          'Уведомления отключены',
          'Чтобы не пропускать сообщения, разрешите приложению отправлять уведомления в настройках телефона.',
          [
            { text: 'Позже', style: 'cancel' },
            { text: 'В настройки', onPress: () => Platform.OS === 'ios' ? Linking.openURL('app-settings:') : Linking.openSettings() }
          ]
        );
      }
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
    const available = await isMessagingAvailable();
    if (!available) {
      console.log('Messaging not available during setupCloudMessaging, will skip for now.');
      return;
    }

    const messaging = getMessagingSafe();
    if (!messaging) return;

    // Слушатель событий Notifee (передний план)
    let unsubscribeForeground = () => {};
    try {
      if (notifee && typeof notifee.onForegroundEvent === 'function') {
        unsubscribeForeground = notifee.onForegroundEvent((event) => {
          handleNotificationResponse(event);
        });
      }
    } catch (e) {
      console.warn('[Notifee] Failed to subscribe to foreground events:', e.message);
    }

    // Регистрация категорий для iOS (нужно для кнопок Ответить/Прочитано)
    if (Platform.OS === 'ios') {
      try {
        if (notifee && typeof notifee.setNotificationCategories === 'function') {
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
        }
      } catch (e) {
        console.log('[Notifee] iOS Categories registration failed:', e);
      }
    }

    // Обработка уведомлений, когда приложение на переднем переднем плане (onMessage)
    let unsubscribeMessaging = () => {};
    try {
      const handler = async remoteMessage => {
        console.log('[FCM] Foreground message received!');
        console.log('[FCM] MessageId:', remoteMessage?.messageId);
        
        // Добавляем алерт для отладки в режиме разработки
        if (__DEV__) {
          Alert.alert(
            'FCM Foreground (DEBUG)',
            `Title: ${remoteMessage?.data?.notif_title || remoteMessage?.notification?.title || 'No Title'}\nBody: ${remoteMessage?.data?.notif_body || remoteMessage?.notification?.body || 'No Body'}`
          );
        }

        // Передаем в коллбек (обычно это NotificationContext)
        if (onNotificationReceived) {
          onNotificationReceived(remoteMessage);
        }

        // Логика отображения Notifee (если чат не открыт)
        // ВАЖНО: Мы вызываем displayBundledMessage ПОСЛЕ onNotificationReceived,
        // но displayBundledMessage само проверит активный чат через navigationRef.
        const currentRoute = navigationRef?.getCurrentRoute?.();
        const data = remoteMessage?.data || {};
        const { senderId } = parseNotificationData(data);
        
        const isChatScreen = currentRoute?.name === 'Chat';
        const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
        const isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);

        if (!isActiveChatWithSender) {
          console.log('[FCM] Showing foreground notification via Notifee');
          await displayBundledMessage(remoteMessage);
        } else {
          console.log('[FCM] In active chat, skipping foreground notification banner');
        }
      };

      if (typeof onMessage === 'function') {
        unsubscribeMessaging = onMessage(messaging, handler);
      }
    } catch (e) {
      console.error('[FCM] Failed to subscribe to foreground messages:', e);
    }

    // Обработка обновления токена
    if (typeof onTokenRefresh === 'function') {
      onTokenRefresh(messaging, token => {
        console.log('FCM Token refreshed:', token);
        storage.saveItem('fcm_token', token);
        updateServerFcmToken(token);
      });
    }

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
    let unsubscribeNotificationOpened = () => {};
    try {
      if (typeof onNotificationOpenedApp === 'function') {
        unsubscribeNotificationOpened = onNotificationOpenedApp(messaging, remoteMessage => {
          console.log('Notification opened from background (FCM):', remoteMessage?.notification);
          openFromNotification(remoteMessage);
        });
      }
    } catch (e) {
      console.warn('[FCM] onNotificationOpenedApp registration failed:', e.message);
    }

    try {
      if (typeof getInitialNotification === 'function') {
        getInitialNotification(messaging).then(remoteMessage => {
          if (remoteMessage) {
            console.log('Initial notification (FCM):', remoteMessage?.notification);
            setTimeout(() => openFromNotification(remoteMessage), 500);
          }
        }).catch(e => {
          console.warn('[FCM] getInitialNotification async error:', e.message);
        });
      }
    } catch (e) {
      console.warn('[FCM] getInitialNotification sync error:', e.message);
    }

    // Обработка начального уведомления Notifee (если приложение было закрыто)
    try {
      if (notifee && typeof notifee.getInitialNotification === 'function') {
        notifee.getInitialNotification().then(initialNotification => {
          if (initialNotification) {
            console.log('Initial notification (Notifee):', initialNotification.notification.id);
            handleNotificationResponse(initialNotification);
          }
        }).catch(e => console.warn('[Notifee] getInitialNotification error:', e));
      }
    } catch (e) {
      console.warn('[Notifee] getInitialNotification sync error:', e);
    }

    return () => {
      unsubscribeForeground();
      unsubscribeMessaging();
      unsubscribeNotificationOpened();
    };
  } catch (error) {
    console.error('Firebase messaging setup failed:', error);
  }
}

export async function getFcmToken() {
  if (Platform.OS === 'web') return null;
  try {
    const available = await isMessagingAvailable();
    if (!available) {
      const reason = lastMessagingUnavailableReason || 'unknown';
      console.log(`[FCM] Messaging not available (reason=${reason})`);
      return null;
    }

    const messaging = getMessagingSafe();
    if (!messaging) return null;
    
    // Check and request permission first
    try {
      const granted = await requestUserPermission();
      if (!granted) {
        console.log('[FCM] Permission not granted, skipping token fetch');
        lastMessagingUnavailableReason = 'permission_denied';
        return null;
      }
    } catch (e) {
      console.log('[FCM] Permission check failed:', e.message);
    }

    // Register for remote notifications on both platforms
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        console.log(`[FCM] Registering device for remote messages (${Platform.OS})...`);
        if (typeof registerDeviceForRemoteMessages === 'function') {
          await registerDeviceForRemoteMessages(messaging);
          console.log(`[FCM] Device registered successfully (${Platform.OS})`);
        }
      }
    } catch (e) {
      console.log(`[FCM] Registration warning (non-critical): ${e.message}`);
    }

    // iOS-specific: Additional APNs token check
    if (Platform.OS === 'ios') {
      let apnsToken = null;
      try {
        if (typeof getAPNSToken === 'function') {
          apnsToken = await getAPNSToken(messaging);
        }
      } catch (e) {
        console.log('[FCM] getAPNSToken error:', e.message);
      }
      
      if (!apnsToken) {
        console.warn('[FCM] APNs token is null. Push notifications might not work on iOS simulator or if not configured.');
      } else {
        console.log('[FCM] APNs Token obtained:', apnsToken.substring(0, 10) + '...');
      }
    }

    console.log('[FCM] Calling getToken()...');
    let token = null;
    try {
      // Use a timeout for getToken to prevent hanging
      let tokenPromise;
      if (typeof getToken === 'function') {
        tokenPromise = getToken(messaging);
      } else {
        throw new Error('Firebase Messaging getToken method not found');
      }

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('getToken timeout (15s)')), 15000)
      );
      
      token = await Promise.race([tokenPromise, timeoutPromise]);
    } catch (e) {
      console.error(`[FCM] getToken primary attempt failed: ${e.message}`);
      const isNativeError = e.message?.includes('native') || e.message?.includes('not a function') || e.message?.includes('undefined') || e.message?.includes('RNFBMessagingModule');
      if (isNativeError) {
        console.error('[FCM] CRITICAL NATIVE ERROR: Native module is incomplete. REBUILD REQUIRED (npx expo run:android).');
        nativeMessagingBroken = true;
      }
      // If regular getToken() fails, try one more time if not confirmed broken
      if (!nativeMessagingBroken || __DEV__) {
        try {
          console.log('[FCM] Attempting getToken() second attempt...');
          if (typeof getToken === 'function') {
            token = await getToken(messaging);
          }
        } catch (e2) {
          console.error(`[FCM] getToken() second attempt failed: ${e2.message}`);
        }
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
      
      let finalError = `FCM token not available yet${reasonSuffix}`;
      if (reason === 'expo_go') {
        finalError = 'FCM not supported in Expo Go. Please use a native build.';
      } else if (reason === 'permission_denied') {
        finalError = 'Notification permissions are required for push notifications.';
      } else if (reason === 'native_module_broken') {
        finalError = 'Native Firebase Messaging module is not working correctly.';
      }
      
      return { success: false, error: finalError };
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

    // Avoid concurrent identical updates
    if (activeSyncs.has(token)) {
      console.log('[FCM] Token update already in progress for this token, skipping redundant call.');
      return { success: true, token, alreadyInProgress: true };
    }
    activeSyncs.add(token);

    try {
      const response = await usersApi.updateFcmToken(token);
      
      if (response.data && response.data.status === 'ok') {
        console.log('[FCM] Token updated on server SUCCESSFULLY:', token.substring(0, 15) + '...');
        
        // If server reported that token was empty/cleared, it might have been invalidated due to UnregisteredError.
        // If we are not already in a forceSync/reset flow, let's trigger a full reset to ensure we have a fresh token.
        if (response.data.was_cleared && !forceSync && !passedToken) {
          console.log('[FCM] Server reported token was cleared. Triggering full reset with delay to avoid cycles...');
          // We don't await to avoid recursion/blocking, it will sync itself after reset.
          // Add a delay to avoid potential rapid cycles.
          setTimeout(() => {
            resetFcmToken().catch(err => console.error('[FCM] Background reset failed:', err));
          }, 10000);
        }

        // Store the last synced token and timestamp to avoid redundant updates
        await storage.saveItem('last_synced_fcm_token', token);
        await storage.saveItem('last_fcm_sync_time', new Date().toISOString());
        return { success: true, token };
      } else {
        console.log('[FCM] Token update response:', response.data);
        return { success: false, error: 'Unexpected server response' };
      }
    } finally {
      activeSyncs.delete(token);
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
