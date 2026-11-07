import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidGroupAlertBehavior, EventType, AndroidStyle } from '@notifee/react-native';
import { storage } from './storage';
import { API_BASE_URL } from '../constants';

// --- Единая маршрутизация push по data.type ---
// Соответствие схеме: chat_message = 'new_message', group_message = 'new_group_message',
// news_post = 'new_post', friend_accepted = 'friend_accept' / 'friend_accepted'.
//   'messages' -> счётчик непрочитанных сообщений чата (dialogs.unread_count)
//   'bell'     -> колокольчик (GET /notifications/unread-count)
//   'ignore'   -> не влияет ни на один счётчик
export const PUSH_TYPE_ROUTES = {
  new_message: 'messages',
  chat_message: 'messages',
  new_group_message: 'messages',
  group_message: 'messages',
  new_post: 'bell',
  news_post: 'bell',
  announcement: 'bell',
  app_update: 'bell',
  app_update_progress: 'ignore',
  friend_request: 'bell',
  friend_accept: 'bell',
  friend_accepted: 'bell',
  friend_post: 'bell',
  post_like: 'bell',
  post_comment: 'bell',
  post_moderated: 'bell',
  news_reaction: 'bell',
  news_comment: 'bell',
  album_reaction: 'bell',
  album_comment: 'bell',
  album_comment_reaction: 'bell',
  photo_reaction: 'bell',
  photo_comment: 'bell',
  photo_comment_reaction: 'bell',
  journal_summary: 'bell',
  system: 'bell',
};

// Возвращает 'messages' | 'bell' | 'ignore'. Неизвестный тип НИКОГДА не считается
// сообщением чата: безопасный fallback - колокольчик (счётчик всё равно берётся с сервера).
export function getPushRoute(data) {
  if (!data) return 'ignore';
  const type = data.type || data.msg_type;
  if (type && PUSH_TYPE_ROUTES[type]) return PUSH_TYPE_ROUTES[type];
  if (data.notif_route === 'messages' || data.notif_route === 'bell') return data.notif_route;
  return type ? 'bell' : 'ignore';
}

// Нормализует URL аватарки без предварительной проверки доступности (HEAD/GET).
const inFlightMessageIds = new Set();
export async function resolveAvatarUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    console.log('[Notifee] Avatar URL is missing:', url);
    return null;
  }
  const candidate = url.trim();
  const baseUrl = API_BASE_URL.replace(/\/+$/, '');
  let normalizedUrl = candidate;
  if (candidate.startsWith('//')) {
    normalizedUrl = `https:${candidate}`;
  } else if (candidate.startsWith('/')) {
    normalizedUrl = `${baseUrl}${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate)) {
    const firstSegment = candidate.split('/', 1)[0];
    normalizedUrl = firstSegment.includes('.') || firstSegment.includes(':')
      ? `https://${candidate}`
      : `${baseUrl}/${candidate}`;
  }
  console.log('[Notifee] Avatar URL used without check:', normalizedUrl);
  return normalizedUrl;
}

// --- Helpers to extract info from various notification data formats ---
export function parseNotificationData(data) {
  if (!data) return {};
  // Без явного типа считаем сообщением чата только push с признаками чата (обратная совместимость)
  const type = data.type || data.msg_type || ((data.chat_id || data.message_id) ? 'new_message' : 'unknown');
  
  // Расширенный поиск ID отправителя (чат, новости, заявки в друзья)
  const senderIdRaw = data.sender_id || data.senderId || 
                      data.author_id || data.authorId || 
                      data.user_id || data.userId || 
                      data.chat_id || data.other_id ||
                      data.from_user_id || data.fromUserId;
                      
  const senderId = senderIdRaw ? parseInt(senderIdRaw, 10) : null;
  
  // Расширенный поиск имени отправителя
  const senderName = data.sender_name || data.senderName || 
                     data.author_name || data.authorName || 
                     data.title || data.display_name || undefined;
                     
  const newsIdRaw = data.news_id || data.newsId;
  const newsId = newsIdRaw ? parseInt(newsIdRaw, 10) : null;

  // Явные поля заголовка и тела (если заданы бэкендом)
  const notifTitle = data.notif_title || data.notifTitle;
  const notifBody = data.notif_body || data.notifBody;
  
  const senderAvatar = data.sender_avatar_url || data.sender_avatar || data.senderAvatar || data.image || data.avatar_url;
  const groupIdRaw = data.group_id || data.groupId;
  const groupId = groupIdRaw ? parseInt(groupIdRaw, 10) : null;
  
  return { type, senderId, senderName, newsId, notifTitle, notifBody, senderAvatar, groupId };
}

// --- Helpers for Notifee ---
export async function ensureNotificationChannel(requestedChannel = 'messages') {
  if (Platform.OS !== 'android') return 'default';
  try {
    if (!notifee || typeof notifee.createChannel !== 'function') {
      console.log('[Notifee] createChannel not available, using default');
      return 'default';
    }
    const isJournal = requestedChannel === 'journal';
    const channelId = await notifee.createChannel({
      id: isJournal ? 'journal' : 'messages',
      name: isJournal ? 'Журнал' : 'Сообщения',
      importance: AndroidImportance.HIGH,
      vibration: true,
      vibrationPattern: [300, 500],
    });
    return channelId;
  } catch (e) {
    console.log('[Notifee] ensureNotificationChannel error:', e?.message || e);
    return 'default';
  }
}

// Канал для "тихих часов" (ночное время в настройках): уведомление по-прежнему
// показывается, но без звука и вибрации. Сервер передаёт data.silent/
// data.android_channel_id = "silent", когда у получателя сейчас действуют тихие часы.
export async function ensureSilentNotificationChannel() {
  if (Platform.OS !== 'android') return 'default';
  try {
    if (!notifee || typeof notifee.createChannel !== 'function') {
      return 'default';
    }
    return await notifee.createChannel({
      id: 'silent',
      name: 'Без звука (тихие часы)',
      importance: AndroidImportance.LOW,
      vibration: false,
      sound: null,
    });
  } catch (e) {
    console.log('[Notifee] ensureSilentNotificationChannel error:', e?.message || e);
    return 'default';
  }
}

export async function displayBundledMessage(remoteMessage) {
  try {
    console.log(`[Notifee] displayBundledMessage called for messageId: ${remoteMessage?.messageId}`);
    
    // Проверка на дублирование: если сообщение пришло И как notification, И как data, 
    // Android может показать его дважды. Мы используем messageId для отслеживания.
    if (remoteMessage?.messageId) {
      // Синхронная проверка в памяти: два вызова подряд не должны пройти одновременно
      if (inFlightMessageIds.has(remoteMessage.messageId)) {
        console.log(`[Notifee] Message ${remoteMessage.messageId} already in flight, skipping duplicate`);
        return;
      }
      inFlightMessageIds.add(remoteMessage.messageId);
      setTimeout(() => inFlightMessageIds.delete(remoteMessage.messageId), 60000);
      const alreadyHandled = await storage.getItem(`handled_msg_${remoteMessage.messageId}`);
      if (alreadyHandled) {
        console.log(`[Notifee] Message ${remoteMessage.messageId} already handled, skipping duplicate`);
        return;
      }
      // Помечаем как обработанное на 1 минуту
      await storage.saveItem(`handled_msg_${remoteMessage.messageId}`, 'true');
      setTimeout(async () => {
        try { await storage.removeItem(`handled_msg_${remoteMessage.messageId}`); } catch(e) {}
      }, 60000);
    }

    if (!notifee || typeof notifee.displayNotification !== 'function') {
      console.error('[Notifee] cannot display notification: notifee.displayNotification is missing');
      return;
    }

    const data = remoteMessage?.data || {};
    const { type, senderId, senderName, newsId, notifTitle, notifBody, senderAvatar } = parseNotificationData(data);
    
    // Проверка на "самого себя" (важно для чата, так как бэкенд шлет всем)
    try {
      const myId = await storage.getUserId();
      console.log(`[Notifee] MyId: ${myId}, SenderId: ${senderId}`);
      if (myId && senderId && Number(myId) === Number(senderId)) {
        console.log('[Notifee] Skipping notification for self-sent message (isMe check)');
        return;
      }
    } catch (err) {
      console.log('[Notifee] Error checking isMe:', err);
    }

    // Проверка активного чата (чтобы не показывать баннер, если пользователь уже там)
    let isActiveChatWithSender = false;
    try {
      const { navigationRef } = require('../navigation/NavigationService');
      if (navigationRef && typeof navigationRef.getCurrentRoute === 'function') {
        const currentRoute = navigationRef.getCurrentRoute();
        const isChatScreen = currentRoute?.name === 'Chat';
        const currentChatUserId = currentRoute?.params?.userId ? parseInt(currentRoute.params.userId, 10) : null;
        isActiveChatWithSender = isChatScreen && senderId && currentChatUserId && Number(currentChatUserId) === Number(senderId);
      }
    } catch (e) {
      console.log('[Notifee] Error checking active chat:', e);
    }

    if (isActiveChatWithSender) {
      console.log('[Notifee] In active chat, skipping notification banner');
      return;
    }
    
    const text = notifBody || data.text || data.message || data.body || remoteMessage?.notification?.body || '';
    const nameToDisplay = notifTitle || senderName || data.title || remoteMessage?.notification?.title || 'Сообщение';

    // ВАЖНО: Notifee ожидает ЛИБО валидный URL (http/https), ЛИБО ресурс. 
    // Пустые строки или относительные пути ('/media/...') вызывают ошибку отображения.
    // Аватарка проверяется с таймаутом (Promise.race): при ошибке/таймауте - без картинки.
    const iconUrl = await resolveAvatarUrl(senderAvatar);

    if (!text && !nameToDisplay) {
      console.log('[Notifee] Skipping display: empty content');
      return;
    }

    const isSilent = data.silent === 'true' || data.android_channel_id === 'silent';
    const channelId = isSilent ? await ensureSilentNotificationChannel()
      : await ensureNotificationChannel(data.android_channel_id === 'journal' || type === 'journal_summary' ? 'journal' : 'messages');
    console.log(`[Notifee] Using channel: ${channelId} (silent: ${isSilent})`);
    
    const groupId = senderId ? `group_sender_${senderId}` : (newsId ? `group_news_${newsId}` : 'group_general');

    const actions = [];
    if (type === 'new_message' && senderId) {
      actions.push({
        title: 'Ответить',
        pressAction: { id: 'reply' },
        input: { placeholder: 'Ваш ответ...', buttonTitle: 'Отправить' },
      });
      actions.push({
        title: 'Прочитано',
        pressAction: { id: 'mark-as-read' },
      });
    }

    // На Android для чата используем MessagingStyle - это гарантирует кнопки один раз и список сообщений
    if (Platform.OS === 'android' && type === 'new_message' && senderId) {
      console.log('[Notifee] Using Android MessagingStyle for sender:', senderId);
      const messagesKey = `notif_messages_${senderId}`;
      let storedMsgs = [];
      try {
        const stored = await storage.getItem(messagesKey);
        if (stored) storedMsgs = JSON.parse(stored);
      } catch (e) {}

      const msgId = remoteMessage.messageId || `msg_${Date.now()}`;
      if (!storedMsgs.find(m => m.id === msgId)) {
        storedMsgs.push({ id: msgId, text: text, timestamp: Date.now() });
      }
      if (storedMsgs.length > 10) storedMsgs = storedMsgs.slice(-10);
      await storage.saveItem(messagesKey, JSON.stringify(storedMsgs));

      const personObj = { name: nameToDisplay };
      if (iconUrl) personObj.icon = iconUrl;

      const notificationOptions = {
        id: `sender_${senderId}`,
        title: nameToDisplay,
        body: text,
        data: data,
        android: {
          channelId: channelId,
          actions: actions,
          groupId: groupId,
          smallIcon: 'notification_icon',
          color: '#023c69',
          importance: isSilent ? AndroidImportance.LOW : AndroidImportance.HIGH,
          pressAction: { id: 'default', launchActivity: 'default' },
          style: {
            type: AndroidStyle.MESSAGING,
            person: personObj,
            messages: storedMsgs.map(m => ({
              text: m.text,
              timestamp: m.timestamp,
              person: personObj,
            })),
          },
        },
      };

      if (iconUrl) {
        notificationOptions.android.largeIcon = iconUrl;
        notificationOptions.android.circularLargeIcon = true;
      }

      // На Android мы используем фиксированный ID для диалога (sender_{id}), 
      // чтобы новые сообщения в MessagingStyle заменяли старые (обновляли их).
      await notifee.displayNotification(notificationOptions);
    } else {
      // Стандартная группировка для остальных случаев
      const messageUniqueId = remoteMessage?.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const notificationId = senderId 
        ? `sender_${senderId}_${messageUniqueId}` 
        : (newsId ? `news_${newsId}_${messageUniqueId}` : `gen_${messageUniqueId}`);

      const notificationOptions = {
        id: notificationId,
        title: nameToDisplay,
        body: text,
        data: data,
        android: {
          actions: actions,
          channelId: channelId,
          groupId: groupId,
          groupAlertBehavior: AndroidGroupAlertBehavior.SUMMARY,
          smallIcon: 'notification_icon',
          color: '#023c69',
          pressAction: { id: 'default', launchActivity: 'default' },
          importance: isSilent ? AndroidImportance.LOW : AndroidImportance.HIGH,
        },
        ios: {
          categoryId: type === 'new_message' ? 'message_actions' : undefined,
          threadId: groupId,
          sound: isSilent ? undefined : 'default',
        }
      };

      if (iconUrl) {
        notificationOptions.android.largeIcon = iconUrl;
        notificationOptions.android.circularLargeIcon = true;
        notificationOptions.ios.attachments = [{ url: iconUrl }];
      }

      // При использовании Notification+Data в FCM, Notifee заменяет системное 
      // уведомление, если ID совпадает.
      await notifee.displayNotification(notificationOptions);

      if (Platform.OS === 'android') {
        await notifee.displayNotification({
          id: `${groupId}_summary`,
          title: nameToDisplay,
          body: text || 'Новые сообщения',
          data: data,
          android: {
            actions: actions,
            channelId: channelId,
            groupId: groupId,
            groupSummary: true,
            groupAlertBehavior: AndroidGroupAlertBehavior.SUMMARY,
            smallIcon: 'notification_icon',
            color: '#023c69',
            importance: AndroidImportance.HIGH,
            subText: nameToDisplay,
            pressAction: { id: 'default', launchActivity: 'default' },
            // Сводка видна в шторке, если дочернее уведомление одно - аватарка должна быть и здесь
            ...(iconUrl ? { largeIcon: iconUrl, circularLargeIcon: true } : {}),
          },
        });
      }
    }
  } catch (e) {
    console.log('[Notifee] displayBundledMessage error:', e?.message || e);
  }
}

// Вспомогательная функция для удаления всей группы уведомлений
async function cancelGroup(groupId, senderId) {
  if (!groupId && !senderId) return;
  try {
    if (!notifee || typeof notifee.getDisplayedNotifications !== 'function') return;
    const displayed = await notifee.getDisplayedNotifications();
    for (const item of displayed) {
      const android = item.notification.android;
      if ((groupId && android?.groupId === groupId) || (senderId && item.notification.id === `sender_${senderId}`)) {
        await notifee.cancelNotification(item.notification.id);
      }
    }
    if (groupId) await notifee.cancelNotification(`${groupId}_summary`);
    if (senderId) await notifee.cancelNotification(`sender_${senderId}`);
  } catch (e) {
    console.log('[Notifee] cancelGroup error:', e);
  }
}

// Вспомогательная функция для ожидания готовности навигации
async function waitForNavigation() {
  try {
    const { navigationRef } = require('../navigation/NavigationService');
    if (!navigationRef) return false;
    for (let i = 0; i < 20; i++) { // ждем до 10 секунд (20 * 500ms)
      if (navigationRef?.isReady?.()) return true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (e) {
    console.log('[Notifee] waitForNavigation error:', e);
  }
  return false;
}

// Единый переход по тапу на push (Notifee и FCM fallbacks):
// чатовые типы -> чат/группа, остальные -> колокольчик (экран уведомлений) или связанный объект.
export function navigateByPushData(navigationRef, data) {
  // Локальные напоминания журнала (например, запуск приложения тапом по напоминанию)
  if (data?.kind === 'journal_reminder') {
    const { openJournalReminder } = require('../journal/notifications/actions');
    openJournalReminder(navigationRef, data);
    return;
  }
  const { type, senderId, senderName, newsId, groupId } = parseNotificationData(data);
  const route = getPushRoute(data);

  // Новая версия приложения: сразу запускаем скачивание и установку обновления
  const rawType = data?.type || data?.msg_type;
  if (rawType === 'app_update') {
    const { startAppUpdate } = require('./appUpdate');
    startAppUpdate(data?.file_path, data?.version);
    if (data?.notification_id) {
      const { notificationsApi } = require('../api');
      notificationsApi.markRead(data.notification_id).catch(() => {});
    }
    return;
  }
  // Нажатие на уведомление с прогрессом загрузки просто открывает приложение
  if (rawType === 'app_update_progress') return;

  if (route === 'messages') {
    if ((type === 'new_group_message' || type === 'group_message') && groupId) {
      navigationRef.navigate('Messages', { screen: 'GroupChat', params: { groupId, groupName: senderName || 'Группа' }, initial: false });
    } else if (senderId) {
      navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName || 'Чат' }, initial: false });
    }
    return;
  }

  if (route === 'bell') {
    if ((type === 'new_post' || type === 'news_post') && newsId) {
      navigationRef.navigate('Feed', { screen: 'NewsDetail', params: { newsId } });
    } else {
      // Колокольчик: экран уведомлений (там же синхронизируется счётчик с сервером)
      navigationRef.navigate('Feed', { screen: 'Notifications' });
    }
    return;
  }

  navigationRef.navigate('Feed');
}

// Ответ из шторки может прийти сразу в несколько обработчиков (фон, передний план,
// getInitialNotification при холодном старте) с одним и тем же notification.id: отправляем один раз
const handledReplyNotificationIds = new Set();

export async function handleNotificationResponse(event) {
  try {
    const { navigationRef } = require('../navigation/NavigationService');
    const { chatApi } = require('../api');
    
    const { type, detail } = event;
    const notification = detail.notification;
    const actionId = detail.pressAction?.id;
    const notifData = notification?.data || {};
    const { senderId, senderName, newsId } = parseNotificationData(notifData);
    const input = detail.input || '';
    const groupId = senderId ? `group_sender_${senderId}` : (newsId ? `group_news_${newsId}` : 'group_general');

    // Игнорируем события доставки и смахивания (dismissed), чтобы не спамить в логах
    if (type === EventType.DELIVERED || type === EventType.DISMISSED) {
      return;
    }
    // Напоминания журнала обрабатываются journal/notifications/actions.js
    if (notifData.kind === 'journal_reminder') {
      return;
    }

    console.log(`[Notifee] handleNotificationResponse: type=${type}, actionId=${actionId}`);

    // Если это нажатие на кнопку "Ответить"
    if (actionId === 'reply') {
      console.log(`[Notifee] Processing reply action for sender ${senderId}. Input length: ${input?.length}`);

      if (notification?.id) {
        // В памяти - для одного JS-контекста; в storage - для фонового (headless) и холодного запуска
        if (handledReplyNotificationIds.has(notification.id)) {
          console.log(`[Notifee] Reply for notification ${notification.id} already handled, skipping duplicate`);
          return;
        }
        const replyKey = `handled_reply_${notification.id}`;
        if (await storage.getItem(replyKey)) {
          console.log(`[Notifee] Reply for notification ${notification.id} already handled (storage), skipping duplicate`);
          return;
        }
        handledReplyNotificationIds.add(notification.id);
        await storage.saveItem(replyKey, 'true');
        setTimeout(async () => {
          handledReplyNotificationIds.delete(notification.id);
          try { await storage.removeItem(replyKey); } catch (_) {}
        }, 60000);
      }

      if (senderId && input) {
        const token = await storage.getAccessToken();
        if (!token) {
          console.log('[Notifee] Reply error: No access token found in storage.');
          await notifee.cancelNotification(notification.id);
          return;
        }
        try {
          console.log(`[Notifee] Sending reply to ${senderId}...`);
          await chatApi.sendMessage({ receiver_id: senderId, message: input, message_type: 'text' }, token);
          console.log(`[Notifee] Calling markAsRead for ${senderId} (after reply)...`);
          await chatApi.markAsRead(senderId, token);
          console.log(`[Notifee] Reply sent and messages marked as read.`);
        } catch (e) {
          console.log('[Notifee] reply handler error:', e?.message || e);
        } finally {
          try { 
            await storage.removeItem(`notif_messages_${senderId}`); 
          } catch (_) {}
          
          await cancelGroup(groupId, senderId);
        }
      } else {
        if (notification?.id) {
          await notifee.cancelNotification(notification.id);
        }
      }
      return;
    }

    // Если это нажатие на кнопку "Прочитано"
    if (actionId === 'mark-as-read') {
      console.log(`[Notifee] Processing mark-as-read action for sender ${senderId}`);
      if (senderId) {
        const token = await storage.getAccessToken();
        if (token) {
          try {
            await chatApi.markAsRead(senderId, token);
          } catch (e) {
            console.log('[Notifee] markAsRead error:', e?.message || e);
          }
        }
        await storage.removeItem(`notif_messages_${senderId}`);
        await cancelGroup(groupId, senderId);
      }
      return;
    }

    // Если это нажатие на само уведомление (или на кнопку без специальной логики выше)
    if (type === EventType.PRESS || actionId === 'default') {
      const { type: msgType, senderId, senderName, newsId } = parseNotificationData(notifData);
      
      const isNavReady = await waitForNavigation();
      if (isNavReady) {
        console.log(`[Notifee] Handling default click for type: ${msgType}`);
        
        navigateByPushData(navigationRef, notifData);
        if (msgType === 'new_message' && senderId) {
          try { await storage.removeItem(`notif_messages_${senderId}`); } catch (_) {}
        }
        
        await cancelGroup(groupId, senderId);
      } else {
        console.log('[Notifee] Navigation not ready after timeout');
      }
    }
  } catch (e) {
    console.log('[Notifee] handleNotificationResponse error:', e?.message || e);
  }
}
