import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { chatApi, usersApi } from '../../../api';
import { storage } from '../../../utils/storage';
import { HISTORY_LIMIT as LIMIT } from '../utils';

// История сообщений: начальная загрузка, подгрузка, обработка WS-уведомлений,
// синхронизация при возврате приложения в активное состояние и переподключении сокета
export default function useChatHistory({
  userId,
  currentUserId,
  currentUser,
  dialogs,
  notifications,
  setMessages,
  fetchDialogs,
  clearUnread,
  markAsReadWs,
  getHistoryWs,
  onHistoryReceived,
  getCachedHistory,
  isChatConnected,
  restoreActiveUploads,
}) {
  const [token, setToken] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const [interlocutor, setInterlocutor] = useState(null);

  // Основной механизм: слушаем уведомления из контекста
  const lastProcessedNotificationRef = useRef(null);
  const currentUserIdRef = useRef(currentUserId);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    // При смене пользователя сбрасываем указатель обработанных уведомлений,
    // чтобы новые уведомления для этого пользователя были обработаны.
    lastProcessedNotificationRef.current = null;
  }, [userId]);

  useEffect(() => {
    if (!notifications || notifications.length === 0) return;

    // Находим индекс последнего обработанного уведомления
    const lastIdx = lastProcessedNotificationRef.current 
      ? notifications.findIndex(n => n === lastProcessedNotificationRef.current)
      : -1;
    
    // Выделяем новые уведомления (те, что до последнего обработанного)
    const newNotifications = lastIdx === -1 ? notifications : notifications.slice(0, lastIdx);
    
    // Обрабатываем уведомления в хронологическом порядке (от старых к новым)
    [...newNotifications].reverse().forEach(lastNotify => {
      const data = lastNotify.data;
      if (!data) return;
      
      const notifyType = lastNotify.type || lastNotify.msg_type;
      const myIdNum = Number(currentUserIdRef.current || currentUserId);
      const currentChatId = Number(userId);

      // 1. Новые сообщения
      if (notifyType === 'new_message' || notifyType === 'message') {
        const msgSenderId = Number(data.sender_id);
        const msgReceiverId = Number(data.receiver_id);

        const isRelated = (msgSenderId === currentChatId && msgReceiverId === myIdNum) || 
                          (msgSenderId === myIdNum && msgReceiverId === currentChatId);
        
        if (isRelated) {
          setMessages(prev => {
            // Пытаемся заменить оптимистичное (pending) сообщение
            if (data.client_id && msgSenderId === myIdNum) {
               const existingIdx = prev.findIndex(m => (m.client_id && m.client_id === data.client_id) || (m.id && String(m.id) === String(data.client_id)));
               if (existingIdx !== -1) {
                 const updated = [...prev];
                 updated[existingIdx] = { 
                   ...data, 
                   client_id: data.client_id || prev[existingIdx].client_id,
                   status: 'sent' 
                 };
                 return updated;
               }
            }

            // Проверка на дубликаты по ID
            if (data.id) {
              const existingIdx = prev.findIndex(m => m.id && String(m.id) === String(data.id));
              if (existingIdx !== -1) {
                const existing = prev[existingIdx];
                // Если новое сообщение более "полное" (например, не uploading, а старое было uploading), обновляем
                const isNewBetter = (existing.is_uploading && !data.is_uploading) || (!existing.file_path && data.file_path);
                if (isNewBetter) {
                  const next = [...prev];
                  next[existingIdx] = { ...existing, ...data, status: 'sent' };
                  return next;
                }
                return prev;
              }
            }

            // Дедупликация по client_id
            if (data.client_id) {
              const existingIndex = prev.findIndex(m => m.client_id === data.client_id);
              if (existingIndex !== -1) {
                const existing = prev[existingIndex];
                // Если новое сообщение более полное (есть id или не uploading), заменяем
                const isNewBetter = (!existing.id && data.id) || (existing.is_uploading && !data.is_uploading);
                if (isNewBetter) {
                  const next = [...prev];
                  next[existingIndex] = { ...existing, ...data, status: 'sent' };
                  return next;
                }
                return prev;
              }
            }

            return [{ ...data, status: 'sent' }, ...prev];
          });
          setSkip(prev => prev + 1);
          
          if (msgSenderId === currentChatId) {
            clearUnread(userId);
            if (AppState.currentState === 'active') {
              markAsReadWs(userId);
            }
          }
        }
      } 
      // 2. Прогресс загрузки
      else if (notifyType === 'upload_progress') {
        const { message_id, progress, offset, total } = data;
        setMessages(prev => prev.map(m => (
          String(m.id) === String(message_id) && m.is_uploading && !m.file_path
          ? { ...m, upload_progress: progress, upload_offset: offset, upload_total: total } 
          : m
        )));
      } 
      // 3. Завершение загрузки (message_updated)
      else if (notifyType === 'message_updated') {
        setMessages(prev => {
          const idx = prev.findIndex(m => String(m.id) === String(data.id));
          if (idx !== -1) {
            // Если нашли по ID, обновляем статус загрузки и добавляем данные (file_path и т.д.)
            return prev.map(m => (String(m.id) === String(data.id) ? { ...m, ...data, is_uploading: false, upload_progress: undefined } : m));
          } else {
            // Если по ID не нашли, возможно сообщение в стейте еще под client_id
            const cidIdx = data.client_id ? prev.findIndex(m => m.client_id === data.client_id) : -1;
            if (cidIdx !== -1) {
              const newMsgs = [...prev];
              newMsgs[cidIdx] = { ...data, is_uploading: false };
              return newMsgs;
            }
            // Если сообщения вообще нет в текущем стейте, добавляем его, если оно относится к этому чату
            const isFromMe = Number(data.sender_id) === myIdNum;
            const otherId = isFromMe ? Number(data.receiver_id) : Number(data.sender_id);
            if (otherId === currentChatId) {
                return [{ ...data, is_uploading: false, status: 'sent' }, ...prev];
            }
            return prev;
          }
        });
      }
      // 4. Удаление сообщения
      else if (notifyType === 'message_deleted') {
        const msgId = data.message_id || data.id || lastNotify.message_id;
        const uploadId = data.upload_id || lastNotify.upload_id;
        if (msgId || uploadId) {
          setMessages(prev => prev.filter(m => {
            if (msgId && String(m.id) === String(msgId)) return false;
            if (uploadId && m.upload_id === uploadId) return false;
            return true;
          }));
          fetchDialogs();
        }
      } 
      // 5. Прочтение сообщений
      else if (notifyType === 'messages_read' || notifyType === 'your_messages_read' || notifyType === 'mark_read') {
          const readerId = data.reader_id || lastNotify.reader_id;
          if (notifyType === 'your_messages_read' || notifyType === 'mark_read' || (notifyType === 'messages_read' && readerId && Number(readerId) === Number(userId))) {
            setMessages(prev => prev.map(m => 
              (m.sender_id && Number(m.sender_id) === myIdNum) ? { ...m, is_read: true } : m
            ));
          }
      }
      // 6. Статус пользователя
      else if (notifyType === 'user_status') {
          const { user_id, status, last_seen } = data;
          if (Number(user_id) === Number(userId)) {
            setInterlocutor(prev => prev ? { ...prev, status, last_seen } : null);
          }
      }
    });

    lastProcessedNotificationRef.current = notifications[0];
  }, [notifications, userId, currentUserId]);

  // Добавляем слушатель состояния приложения, чтобы помечать прочитанным при возврате в активный чат
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && userId) {
        console.log('[ChatScreen] App became active while in chat, refreshing history');
        // Помечаем как прочитанные
        markAsReadWs(userId);
        clearUnread(userId);
        // Запрашиваем историю, чтобы гарантированно получить сообщения, пришедшие пока приложение было в фоне
        getHistoryWs(userId, LIMIT, 0);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [markAsReadWs, clearUnread, userId, getHistoryWs]);

  // Перезагружаем историю при восстановлении соединения сокета
  useEffect(() => {
    if (isChatConnected && userId) {
      console.log('[ChatScreen] Chat socket connected, requesting fresh history');
      getHistoryWs(userId, LIMIT, 0);
      markAsReadWs(userId);
      clearUnread(userId);
    }
  }, [isChatConnected, userId, getHistoryWs, markAsReadWs, clearUnread]);

  useEffect(() => {
    setMessages([]); // Reset messages on mount
    setHasMore(true);
    setSkip(0);
  }, [userId]);

  useEffect(() => {
    const unsubscribe = onHistoryReceived((payload) => {
      if (Number(payload.other_user_id) === Number(userId)) {
        setMessages(prev => {
          if (payload.skip === 0) {
            // При получении свежей истории (skip=0) сохраняем отправляемые в данный момент сообщения
            const pending = prev.filter(m => m.status === 'pending');
            // Сохраняем также сообщения, которые пришли через уведомления, пока мы ждали историю
            // Если в полученной истории НЕТ сообщения, которое уже есть в стейте (добавлено через уведомление), 
            // то мы должны его оставить. Но обычно история содержит всё.
            // Проблема в том, что payload.data может быть чуть старее, чем уведомления, которые уже прилетели.
            
            const fromNotifications = prev.filter(m => m.status === 'sent' && !payload.data.find(im => im.id === m.id));
            if (fromNotifications.length > 0) {
              console.log('[ChatScreen] Preserving messages from notifications during history refresh:', fromNotifications.map(m => m.id));
            }

            // Исключаем из pending те, которые уже вернулись от сервера в составе истории
            const actualPending = pending.filter(pm => !payload.data.find(m => (
              m.sender_id && Number(m.sender_id) === Number(currentUserId) && 
              m.client_id && m.client_id === pm.client_id
            )));
            
            // Финальная дедупликация (на случай гонок или дубликатов от сервера)
            // Приоритет отдаем сообщениям из БД (payload.data), при этом среди них
            // предпочитаем завершенные сообщения плейсхолдерам с тем же client_id
            const uniqueMessages = [];
            const seenIds = new Set();
            const seenClientIds = new Map(); // cid -> { index in filteredServerData, is_uploading }

            // 1. Сначала фильтруем саму историю от сервера на случай дублей в базе
            // (особенно плейсхолдеров, которые могли остаться при пакетной загрузке)
            const filteredServerData = [];
            
            payload.data.forEach(m => {
              const mid = (m.id && !String(m.id).startsWith('c_')) ? String(m.id) : null;
              const cid = m.client_id ? String(m.client_id) : null;
              
              if (mid && seenIds.has(mid)) return;
              
              if (cid && seenClientIds.has(cid)) {
                const seen = seenClientIds.get(cid);
                // Если мы уже видели этот client_id, и текущее сообщение (m) более "полноценное"
                // (не в процессе загрузки), а предыдущее было плейсхолдером — заменяем его.
                // История идет от новых к старым, поэтому обычно первое встреченное — актуальнее.
                // Но в случае плейсхолдеров нам важнее статус завершенности.
                if (seen.is_uploading && !m.is_uploading) {
                   filteredServerData[seen.index] = m;
                   seenClientIds.set(cid, { index: seen.index, is_uploading: false });
                   if (mid) seenIds.add(mid);
                }
                return;
              }

              if (mid) seenIds.add(mid);
              if (cid) seenClientIds.set(cid, { index: filteredServerData.length, is_uploading: !!m.is_uploading });
              filteredServerData.push(m);
            });
            
            // Сбрасываем сеты для фильтрации пендингов и нотификаций
            const finalSeenIds = new Set();
            const finalSeenClientIds = new Set();
            filteredServerData.forEach(m => {
              if (m.id && !String(m.id).startsWith('c_')) finalSeenIds.add(String(m.id));
              if (m.client_id) finalSeenClientIds.add(String(m.client_id));
            });
            
            // 3. Добавляем в результат в правильном порядке: сначала пендинги, потом нотификации, потом историю
            // При этом фильтруем пендинги и нотификации, если они уже есть в истории (по id или client_id)
            const filterUnseen = (m) => {
              const cid = m.client_id ? String(m.client_id) : null;
              const mid = (m.id && !String(m.id).startsWith('c_')) ? String(m.id) : null;
              if (mid && finalSeenIds.has(mid)) return false;
              if (cid && finalSeenClientIds.has(cid)) return false;
              if (mid) finalSeenIds.add(mid);
              if (cid) finalSeenClientIds.add(cid);
              return true;
            };

            const filteredPending = actualPending.filter(filterUnseen);
            const filteredNotifications = fromNotifications.filter(filterUnseen);

            uniqueMessages.push(...filteredPending);
            uniqueMessages.push(...filteredNotifications);
            uniqueMessages.push(...filteredServerData);
            
            return uniqueMessages;
          } else {
            // При подгрузке старой истории фильтруем только те, которых еще нет в стейте
            const newMsgs = payload.data.filter((m, idx) => 
              !prev.find(pm => String(pm.id) === String(m.id)) &&
              payload.data.findIndex(im => String(im.id) === String(m.id)) === idx
            );
            return [...prev, ...newMsgs];
          }
        });
        
        if (payload.skip === 0) {
           setSkip(payload.data.length);
        } else {
           setSkip(prev => prev + payload.data.length);
        }

        if (payload.data.length < LIMIT) {
          setHasMore(false);
        }
        setLoadingMore(false);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [userId, onHistoryReceived]);

  useEffect(() => {
    let ignore = false;

    const initChat = async () => {
      const accessToken = await storage.getAccessToken();
      setToken(accessToken);

      // 1. Мгновенная загрузка из кэша для "непрерывного" UI
      const cachedHistory = await getCachedHistory(userId);
      if (cachedHistory && cachedHistory.length > 0) {
        console.log(`[ChatScreen] Loaded ${cachedHistory.length} messages from cache`);
        setMessages(cachedHistory);
        setSkip(cachedHistory.length);
      }

      let myId = currentUser?.id;
      if (!myId) {
        // Загрузка данных текущего пользователя если их нет в контексте
        try {
          const userRes = await usersApi.getMe();
          myId = userRes.data.id;
        } catch (err) {
          console.log('Failed to load current user', err);
        }
      }

      // Загрузка начальной истории через WebSocket
      console.log(`[ChatScreen] Requesting initial history via WS for user: ${userId}`);
      setLoadingMore(true);
      const requested = getHistoryWs(userId, LIMIT, 0);
      if (!requested) {
        // Fallback to API if WS not ready
        try {
          const res = await chatApi.getHistory(userId, accessToken, LIMIT, 0);
          if (!ignore) {
            console.log(`[ChatScreen] Loaded initial history via API fallback: ${res.data.length} messages`);
            setMessages(res.data);
            setSkip(res.data.length);
            if (res.data.length < LIMIT) {
              setHasMore(false);
            }
          }
        } catch (error) {
          console.error('Failed to load history via API', error);
        } finally {
          setLoadingMore(false);
        }
      }

      // Помечаем как прочитанные через WebSocket только если приложение активно и экран в фокусе
      const isAppActive = AppState.currentState === 'active';
      console.log('[ChatScreen] initChat, app state:', AppState.currentState);
      
      if (isAppActive) {
        console.log('[ChatScreen] Initializing chat, app is active, marking as read');
        markAsReadWs(userId);
        clearUnread(userId);
      } else {
        console.log('[ChatScreen] Initializing chat, app is in background, NOT marking as read');
      }

      // Загрузка данных собеседника - сначала из диалогов
      const existingDlg = dialogs.find(d => Number(d.user_id) === Number(userId));
      if (existingDlg) {
        setInterlocutor(existingDlg);
      } else {
        usersApi.getUser(userId).then(res => {
          if (!ignore) setInterlocutor(res.data);
        }).catch(err => console.log(err));
      }

      if (!myId) {
        console.error('[ChatScreen] Cannot initialize chat: myId is null');
        return;
      }

      if (ignore) return;

      // Проверка активных загрузок
      restoreActiveUploads(userId);
    };

    initChat();

    return () => {
      ignore = true;
    };
  }, [userId]);

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore || !token) return;

    setLoadingMore(true);
    console.log(`[ChatScreen] Requesting more history via WS. Skip: ${skip}`);
    const requested = getHistoryWs(userId, LIMIT, skip);
    if (!requested) {
      // Fallback to API
      try {
        const res = await chatApi.getHistory(userId, token, LIMIT, skip);
        console.log(`[ChatScreen] Loaded ${res.data.length} more messages via API. Skip was ${skip}`);
        if (res.data.length > 0) {
          setMessages(prev => {
             const newMsgs = res.data.filter(m => !prev.find(pm => String(pm.id) === String(m.id)));
             return [...prev, ...newMsgs];
          });
          setSkip(prev => prev + res.data.length);
        }
        if (res.data.length < LIMIT) {
          setHasMore(false);
        }
      } catch (error) {
        console.error('Failed to load more messages via API', error);
      } finally {
        setLoadingMore(false);
      }
    }
  };

  return {
    token,
    loadingMore,
    hasMore,
    skip,
    setSkip,
    interlocutor,
    loadMoreMessages,
  };
}
