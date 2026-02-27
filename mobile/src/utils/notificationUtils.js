import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
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
  
  return { type, senderId, senderName, newsId };
}

// --- Notifee-like helpers for Expo-Notifications ---
export async function ensureNotifeeChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('messages', {
      name: 'Сообщения',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
      showBadge: true,
    });
    
    // Определяем категории для быстрых действий
    await Notifications.setNotificationCategoryAsync('message_actions', [
      {
        identifier: 'reply',
        buttonTitle: 'Ответить',
        textInput: {
          submitButtonTitle: 'Отправить',
          placeholder: 'Ваш ответ…',
        },
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: 'mark-as-read',
        buttonTitle: 'Прочитано',
        options: {
          opensAppToForeground: true,
        },
      },
    ]);
  } catch (e) {
    console.log('[Notifications] ensureNotifeeChannel error:', e?.message || e);
  }
}

export async function displayBundledMessage(remoteMessage) {
  try {
    const data = remoteMessage?.data || {};
    const { senderId, senderName } = parseNotificationData(data);
    
    // Проверка на "самого себя"
    try {
      const myId = await storage.getUserId();
      if (myId && senderId && Number(myId) === Number(senderId)) {
        console.log('[Notifications] Skipping notification for self-sent message');
        return;
      }
    } catch (err) {
      console.log('[Notifications] Error checking isMe:', err);
    }
    
    const text = data.text || data.message || data.body || remoteMessage?.notification?.body || '';
    const nameToDisplay = senderName || data.title || remoteMessage?.notification?.title || 'Сообщение';

    await ensureNotifeeChannel();

    // Храним последние N сообщений по отправителю для формирования цепочки в теле уведомления
    // В expo-notifications нет прямого аналога MessagingStyle, поэтому формируем текст вручную
    const key = `notif_messages_${senderId || 'generic'}`;
    let list = [];
    try {
      const saved = await storage.getItem(key);
      list = saved ? JSON.parse(saved) : [];
    } catch (_) {}
    list.push({ text, ts: Date.now() });
    if (list.length > 5) list = list.slice(-5);
    try { await storage.saveItem(key, JSON.stringify(list)); } catch (_) {}

    const combinedBody = list.length > 1 
      ? list.map(m => m.text).join('\n')
      : text;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: nameToDisplay,
        body: combinedBody,
        data: data,
        categoryIdentifier: senderId ? 'message_actions' : undefined,
        android: {
          channelId: 'messages',
        },
      },
      trigger: null, // немедленно
    });
    
  } catch (e) {
    console.log('[Notifications] displayBundledMessage error:', e?.message || e);
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

export async function handleNotifeeEvent(event) {
  try {
    const actionId = event.actionIdentifier;
    const notifData = event.notification.request.content.data || {};
    const { senderId, senderName } = parseNotificationData(notifData);
    const input = event.userText || '';

    // Если это просто нажатие на уведомление или кнопки действия при закрытом приложении
    // Сначала убедимся, что навигация готова
    const isNavReady = await waitForNavigation();

    if (actionId === 'reply') {
      console.log(`[Notifications] Processing reply action for sender ${senderId}. Input length: ${input?.length}`);
      
      if (senderId && input) {
        const token = await storage.getAccessToken();
        if (!token) {
          console.log('[Notifications] Reply error: No access token found in storage.');
          await Notifications.dismissNotificationAsync(event.notification.request.identifier);
          return;
        }
        try {
          console.log(`[Notifications] Sending reply to ${senderId}...`);
          await chatApi.sendMessage({ receiver_id: senderId, message: input, message_type: 'text' }, token);
          console.log(`[Notifications] Calling markAsRead for ${senderId} (after reply)...`);
          await chatApi.markAsRead(senderId, token);
          console.log(`[Notifications] Reply sent and messages marked as read.`);
        } catch (e) {
          console.log('[Notifications] reply handler error:', e?.message || e);
        } finally {
          try { await storage.removeItem(`notif_messages_${senderId}`); } catch (_) {}
          await Notifications.dismissNotificationAsync(event.notification.request.identifier);
        }
      } else {
        if (senderId) {
          await Notifications.dismissNotificationAsync(event.notification.request.identifier);
        }
      }
      return;
    }

    if (actionId === 'mark-as-read') {
      console.log(`[Notifications] Processing mark-as-read action for sender ${senderId}`);
      if (senderId) {
        const token = await storage.getAccessToken();
        if (token) {
          try {
            await chatApi.markAsRead(senderId, token);
          } catch (e) {
            console.log('[Notifications] markAsRead error:', e?.message || e);
          }
        }
        await storage.removeItem(`notif_messages_${senderId}`);
        await Notifications.dismissNotificationAsync(event.notification.request.identifier);
      }
      return;
    }

    // Если это просто нажатие на уведомление (не на кнопку действия)
    if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) {
      if (senderId) {
        if (isNavReady) {
          navigationRef.navigate('Chat', { userId: senderId, userName: senderName });
          await storage.removeItem(`notif_messages_${senderId}`);
          await Notifications.dismissNotificationAsync(event.notification.request.identifier);
        } else {
          console.log('[Notifications] Navigation not ready after timeout');
        }
      }
    }
  } catch (e) {
    console.log('[Notifications] handleNotifeeEvent error:', e?.message || e);
  }
}
