import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidStyle, EventType } from '@notifee/react-native';
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

// --- Notifee helpers for Android grouping & actions ---
export async function ensureNotifeeChannel() {
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

export async function displayBundledMessage(remoteMessage) {
  try {
    const data = remoteMessage?.data || {};
    const { senderId, senderName, type } = parseNotificationData(data);
    
    const text = data.text || data.message || data.body || remoteMessage?.notification?.body || '';
    const nameToDisplay = senderName || data.title || remoteMessage?.notification?.title || 'Сообщение';

    await ensureNotifeeChannel();

    // Base notification options
    const notificationOptions = {
      title: nameToDisplay,
      body: text,
      android: {
        channelId: 'messages',
        // ic_launcher is usually available, but we can also use ic_stat_name if configured.
        // If it still fails, Notifee usually logs which resource is missing.
        smallIcon: 'ic_launcher', 
        pressAction: { id: 'default', launchActivity: 'default' },
        importance: AndroidImportance.HIGH,
      },
      data: data,
    };

    // Если нет ID отправителя, показываем как обычное одиночное уведомление
    if (!senderId) {
      await notifee.displayNotification(notificationOptions);
      return;
    }

    const ts = Date.now();

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
      person: { name: m.me ? 'Вы' : nameToDisplay },
    }));

    await notifee.displayNotification({
      id: `sender_${senderId}`,
      title: nameToDisplay,
      body: text,
      android: {
        channelId: 'messages',
        groupId: `sender_${senderId}`,
        groupAlertBehavior: 1, // ALL
        smallIcon: 'ic_launcher',
        showTimestamp: true,
        style: {
          type: AndroidStyle.MESSAGING,
          person: { name: nameToDisplay },
          messages,
        },
        pressAction: { id: 'open-chat', launchActivity: 'default' },
        actions: [
          { title: 'Ответить', pressAction: { id: 'reply' }, input: { allowFreeFormInput: true, placeholder: 'Ваш ответ…' } },
          { title: 'Прочитано', pressAction: { id: 'mark-as-read' } },
        ],
      },
      data: { senderId: String(senderId), senderName: nameToDisplay },
    });
    
    // Display a summary for the group (required for some devices/versions to group correctly)
    await notifee.displayNotification({
      id: `summary_${senderId}`,
      android: {
        channelId: 'messages',
        groupId: `sender_${senderId}`,
        groupSummary: true,
        smallIcon: 'ic_launcher',
        pressAction: { id: 'open-chat', launchActivity: 'default' },
      },
    });
  } catch (e) {
    console.log('[Notifee] displayBundledMessage error:', e?.message || e);
  }
}

export async function handleNotifeeEvent(type, detail) {
  try {
    if (type !== EventType.ACTION_PRESS && type !== EventType.PRESS) return;
    const pressId = detail?.pressAction?.id;
    const notifData = detail?.notification?.data || {};
    const { senderId, senderName } = parseNotificationData(notifData);

    if (pressId === 'reply') {
      const input = detail?.input || '';
      console.log(`[Notifee] Processing reply action for sender ${senderId}. Input length: ${input?.length}`);
      
      if (senderId && input) {
        const token = await storage.getAccessToken();
        if (!token) {
          console.log('[Notifee] Reply error: No access token found in storage.');
          return;
        }
        try {
          // 1) Сначала отправляем ответ
          console.log(`[Notifee] Sending reply to ${senderId}...`);
          const sendRes = await chatApi.sendMessage({ receiver_id: senderId, message: input, message_type: 'text' }, token);
          console.log(`[Notifee] Reply send result status: ${sendRes?.status}`);

          // 2) После успешной отправки — помечаем сообщения как прочитанные (аналогично кнопке «Прочитано»)
          console.log(`[Notifee] Marking messages from ${senderId} as read (after reply)...`);
          const markRes = await chatApi.markAsRead(senderId, token);
          console.log(`[Notifee] Mark as read result status: ${markRes?.status}`);

          // 3) Очищаем локальную историю и скрываем уведомление
          try { await storage.removeItem(`notif_messages_${senderId}`); } catch (_) {}
          try { await notifee.cancelNotification(`sender_${senderId}`); } catch (_) {}

          console.log(`[Notifee] Reply sent and messages marked as read, notification cleared.`);
        } catch (e) {
          console.log('[Notifee] reply handler error:', e?.message || e);
          if (e.response) {
            console.log('[Notifee] Error response data:', JSON.stringify(e.response.data));
            console.log('[Notifee] Error response status:', e.response.status);
          }
        }
      } else {
        console.log(`[Notifee] Reply skipped: senderId=${senderId}, hasInput=${!!input}`);
      }
      return;
    }

    if (pressId === 'mark-as-read') {
      console.log(`[Notifee] Processing mark-as-read action for sender ${senderId}`);
      if (senderId) {
        const token = await storage.getAccessToken();
        if (!token) {
          console.log('[Notifee] Mark-as-read error: No access token found in storage.');
          return;
        }
        try {
          console.log(`[Notifee] Calling markAsRead for ${senderId}...`);
          const res = await chatApi.markAsRead(senderId, token);
          console.log(`[Notifee] Mark-as-read result status: ${res?.status}`);
          
          // Также очищаем локальную историю группировки
          await storage.removeItem(`notif_messages_${senderId}`);
          console.log(`[Notifee] Local history for ${senderId} cleared.`);
        } catch (e) {
          console.log('[Notifee] markAsRead error:', e?.message || e);
          if (e.response) {
            console.log('[Notifee] Mark-as-read error response data:', JSON.stringify(e.response.data));
            console.log('[Notifee] Mark-as-read error response status:', e.response.status);
          }
        }
        try {
          await notifee.cancelNotification(`sender_${senderId}`);
          console.log(`[Notifee] Notification sender_${senderId} canceled.`);
        } catch (e) {
          console.log('[Notifee] Error canceling notification:', e?.message || e);
        }
      } else {
        console.log('[Notifee] Mark-as-read skipped: No senderId found in notification data.');
      }
      return;
    }

    if (pressId === 'open-chat' && navigationRef?.isReady?.() && senderId) {
      navigationRef.navigate('Chat', { userId: senderId, userName: senderName });
      try { 
        await notifee.cancelNotification(`sender_${senderId}`); 
        // Очищаем локальную историю уведомлений при переходе в чат
        await storage.removeItem(`notif_messages_${senderId}`);
      } catch (_) {}
      return;
    }
  } catch (e) {
    console.log('[Notifee] handleNotifeeEvent error:', e?.message || e);
  }
}
