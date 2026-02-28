import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidGroupAlertBehavior, EventType, AndroidStyle } from '@notifee/react-native';
import { chatApi } from '../api';
import { storage } from './storage';
import { navigationRef } from '../navigation/NavigationService';

// --- Helpers to extract info from various notification data formats ---
export function parseNotificationData(data) {
  if (!data) return {};
  const type = data.type || data.msg_type || 'new_message';
  
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
  
  return { type, senderId, senderName, newsId, notifTitle, notifBody };
}

// --- Helpers for Notifee ---
export async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return 'default';
  try {
    const channelId = await notifee.createChannel({
      id: 'messages',
      name: 'Сообщения',
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

export async function displayBundledMessage(remoteMessage) {
  try {
    console.log(`[Notifee] displayBundledMessage called for messageId: ${remoteMessage?.messageId}`);
    const data = remoteMessage?.data || {};
    const { type, senderId, senderName, newsId, notifTitle, notifBody } = parseNotificationData(data);
    
    // Проверка на "самого себя" (важно для чата, так как бэкенд шлет всем)
    try {
      const myId = await storage.getUserId();
      if (myId && senderId && Number(myId) === Number(senderId)) {
        console.log('[Notifee] Skipping notification for self-sent message');
        return;
      }
    } catch (err) {
      console.log('[Notifee] Error checking isMe:', err);
    }
    
    const text = notifBody || data.text || data.message || data.body || remoteMessage?.notification?.body || '';
    const nameToDisplay = notifTitle || senderName || data.title || remoteMessage?.notification?.title || 'Сообщение';

    if (!text && !nameToDisplay) {
      console.log('[Notifee] Skipping display: empty content');
      return;
    }

    const channelId = await ensureNotificationChannel();
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

      await notifee.displayNotification({
        id: `sender_${senderId}`,
        title: nameToDisplay,
        body: text,
        data: data,
        android: {
          channelId: channelId,
          actions: actions,
          groupId: groupId,
          smallIcon: 'ic_launcher',
          color: '#023c69',
          importance: AndroidImportance.HIGH,
          pressAction: { id: 'default', launchActivity: 'default' },
          style: {
            type: AndroidStyle.MESSAGING,
            person: { name: nameToDisplay },
            messages: storedMsgs.map(m => ({
              text: m.text,
              timestamp: m.timestamp,
              person: { name: nameToDisplay },
            })),
          },
        },
      });
    } else {
      // Стандартная группировка для остальных случаев
      const messageUniqueId = remoteMessage?.messageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const notificationId = senderId 
        ? `sender_${senderId}_${messageUniqueId}` 
        : (newsId ? `news_${newsId}_${messageUniqueId}` : `gen_${messageUniqueId}`);

      await notifee.displayNotification({
        id: notificationId,
        title: nameToDisplay,
        body: text,
        data: data,
        android: {
          actions: actions,
          channelId: channelId,
          groupId: groupId,
          groupAlertBehavior: AndroidGroupAlertBehavior.SUMMARY,
          smallIcon: 'ic_launcher',
          color: '#023c69',
          pressAction: { id: 'default', launchActivity: 'default' },
          importance: AndroidImportance.HIGH,
        },
        ios: {
          categoryId: type === 'new_message' ? 'message_actions' : undefined,
          threadId: groupId,
        }
      });

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
            smallIcon: 'ic_launcher',
            color: '#023c69',
            importance: AndroidImportance.HIGH,
            subText: nameToDisplay,
            pressAction: { id: 'default', launchActivity: 'default' },
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
  for (let i = 0; i < 20; i++) { // ждем до 10 секунд (20 * 500ms)
    if (navigationRef?.isReady?.()) return true;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

export async function handleNotificationResponse(event) {
  try {
    const { type, detail } = event;
    const notification = detail.notification;
    const actionId = detail.pressAction?.id;
    const notifData = notification?.data || {};
    const { senderId, senderName, newsId } = parseNotificationData(notifData);
    const input = detail.input || '';
    const groupId = senderId ? `group_sender_${senderId}` : (newsId ? `group_news_${newsId}` : 'group_general');

    // Игнорируем события доставки, чтобы не спамить в логах
    if (type === EventType.DELIVERED) {
      return;
    }

    console.log(`[Notifee] handleNotificationResponse: type=${type}, actionId=${actionId}`);

    // Если это нажатие на кнопку "Ответить"
    if (actionId === 'reply') {
      console.log(`[Notifee] Processing reply action for sender ${senderId}. Input length: ${input?.length}`);
      
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
        
        if (msgType === 'new_message' && senderId) {
          navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName || 'Чат' } });
          try { await storage.removeItem(`notif_messages_${senderId}`); } catch (_) {}
        } else if (msgType === 'friend_request' || msgType === 'friend_accept') {
          navigationRef.navigate('Users', { screen: 'UsersMain', params: { initialTab: 'friends' } });
        } else if (msgType === 'new_post' && newsId) {
          navigationRef.navigate('Feed', { screen: 'NewsDetail', params: { newsId } });
        } else if (senderId) {
          navigationRef.navigate('Messages', { screen: 'Chat', params: { userId: senderId, userName: senderName || 'Чат' } });
        } else {
          navigationRef.navigate('Feed');
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
