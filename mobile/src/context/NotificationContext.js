import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Vibration, AppState, Alert } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { API_BASE_URL } from '../constants';
import { usersApi, chatApi } from '../api';
import { storage } from '../utils/storage';
import { setNotificationAudioMode } from '../utils/audioSettings';
import { isWithinQuietHours } from '../utils/quietHours';
import { navigationRef } from '../navigation/NavigationService';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [historyListeners] = useState(new Set());

  const getHistoryWs = React.useCallback((otherUserId, limit = 15, skip = 0) => {
    console.log('[NotificationContext] getHistoryWs called for:', otherUserId, 'chatWs status:', chatWs.current?.readyState);
    if (chatWs.current && chatWs.current.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'get_history',
        other_user_id: otherUserId,
        limit,
        skip
      };
      console.log('[NotificationContext] Sending get_history via Chat WS:', JSON.stringify(payload));
      chatWs.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const onHistoryReceived = React.useCallback((callback) => {
    historyListeners.add(callback);
    return () => historyListeners.delete(callback);
  }, [historyListeners]);
  const [dialogs, setDialogs] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [friendRequestsCount, setFriendRequestsCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const activeChatIdRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const dialogsRef = useRef([]);
  const appState = useRef(AppState.currentState);
  const ws = useRef(null);
  const lastToken = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttempt = useRef(0);
  const shouldReconnect = useRef(true);
  const heartbeatInterval = useRef(null);

  const notificationPlayer = useAudioPlayer(require('../../assets/sounds/message.mp3'));
  const notificationPlayerRef = useRef(notificationPlayer);

  const chatWs = useRef(null);
  const chatWsReconnectTimer = useRef(null);
  const chatWsReconnectAttempt = useRef(0);
  const chatWsShouldReconnect = useRef(true);
  const chatWsLastToken = useRef(null);
  const chatWsHeartbeatInterval = useRef(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    dialogsRef.current = dialogs;
    const total = dialogs.reduce((acc, d) => acc + (d.unread_count || 0), 0);
    setUnreadTotal(total);
  }, [dialogs]);

  useEffect(() => {
    notificationPlayerRef.current = notificationPlayer;
  }, [notificationPlayer]);

  const connectChatWs = React.useCallback((token) => {
    if (!token || token === 'null' || token === 'undefined') {
      console.log('[NotificationContext] Skipping Chat WS connect: no token');
      return;
    }

    if (chatWs.current && (chatWs.current.readyState === WebSocket.OPEN || chatWs.current.readyState === WebSocket.CONNECTING)) {
      if (chatWsLastToken.current === token) {
        console.log('[NotificationContext] Chat WS already connected or connecting');
        return;
      }
      chatWs.current.close();
    }

    chatWsLastToken.current = token;
    chatWsShouldReconnect.current = true;

    const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
    const baseUrlClean = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = `${protocol}${baseUrlClean}/chat/ws/${encodeURIComponent(token)}`;
    
    console.log('[NotificationContext] Connecting to Chat WS...');
    try {
      chatWs.current = new WebSocket(wsUrl);

      chatWs.current.onopen = () => {
        console.log('[NotificationContext] Chat WS connected');
        chatWsReconnectAttempt.current = 0;
        if (chatWsReconnectTimer.current) {
          clearTimeout(chatWsReconnectTimer.current);
          chatWsReconnectTimer.current = null;
        }
        if (chatWsHeartbeatInterval.current) clearInterval(chatWsHeartbeatInterval.current);
        chatWsHeartbeatInterval.current = setInterval(() => {
          if (chatWs.current && chatWs.current.readyState === WebSocket.OPEN) {
            chatWs.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);

        // Request initial dialogs list through WS
        chatWs.current.send(JSON.stringify({ type: 'get_dialogs' }));
      };

      chatWs.current.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          const msgType = payload.type || payload.msg_type;
          console.log('[NotificationContext] Chat WS message received:', msgType || 'UNKNOWN_TYPE', 'Full payload:', JSON.stringify(payload));
          if (msgType === 'dialogs_list') {
            console.log('[NotificationContext] Dialogs list received via WS, count:', payload.data?.length);
            setDialogs(payload.data || []);
          } else if (msgType === 'chat_history') {
            console.log('[NotificationContext] Chat history received via WS, count:', payload.data?.length, 'otherUserId:', payload.other_user_id);
            historyListeners.forEach(cb => cb(payload));
          } else if (msgType === 'pong') {
            // Keep-alive response
          }
        } catch (err) {
          console.error('[NotificationContext] Chat WS parse error:', err, 'Raw data:', e.data);
        }
      };

      chatWs.current.onclose = (e) => {
        console.log('[NotificationContext] Chat WS closed:', e.code);
        if (chatWsHeartbeatInterval.current) {
          clearInterval(chatWsHeartbeatInterval.current);
          chatWsHeartbeatInterval.current = null;
        }
        if (chatWsShouldReconnect.current) {
          const delay = Math.min(30000, Math.pow(2, chatWsReconnectAttempt.current) * 2000);
          chatWsReconnectTimer.current = setTimeout(() => {
            chatWsReconnectAttempt.current += 1;
            storage.getAccessToken().then(tok => { if (tok) connectChatWs(tok); });
          }, delay);
        }
      };

      chatWs.current.onerror = (e) => {
        console.error('[NotificationContext] Chat WS error');
      };
    } catch (err) {
      console.error('[NotificationContext] Error creating Chat WebSocket:', err);
    }
  }, []);

  const sendMessage = React.useCallback((msgData) => {
    if (chatWs.current && chatWs.current.readyState === WebSocket.OPEN) {
      chatWs.current.send(JSON.stringify({
        type: 'message',
        ...msgData
      }));
      return true;
    } else {
      console.error('[NotificationContext] Chat WS not connected, cannot send message');
      // If Chat WS is down, try to reconnect
      storage.getAccessToken().then(tok => { if (tok) connectChatWs(tok); });
      return false;
    }
  }, [connectChatWs]);

  const markAsReadWs = React.useCallback((otherId) => {
    if (chatWs.current && chatWs.current.readyState === WebSocket.OPEN) {
      chatWs.current.send(JSON.stringify({
        type: 'mark_read',
        other_id: otherId
      }));
      return true;
    }
    return false;
  }, []);

  const deleteMessageWs = React.useCallback((messageId) => {
    if (chatWs.current && chatWs.current.readyState === WebSocket.OPEN) {
      chatWs.current.send(JSON.stringify({
        type: 'delete_message',
        message_id: messageId
      }));
      return true;
    }
    return false;
  }, []);

  const bulkDeleteMessagesWs = React.useCallback((messageIds) => {
    if (chatWs.current && chatWs.current.readyState === WebSocket.OPEN) {
      chatWs.current.send(JSON.stringify({
        type: 'bulk_delete',
        message_ids: message_ids
      }));
      return true;
    }
    return false;
  }, []);

  const fetchDialogs = React.useCallback(async () => {
    try {
      const token = await storage.getAccessToken();
      if (!token) return;
      const res = await chatApi.getDialogs(token);
      setDialogs(res.data);
    } catch (err) {
      console.error('Failed to fetch dialogs:', err);
    }
  }, []);

  const fetchFriendRequestsCount = React.useCallback(async () => {
    try {
      const token = await storage.getAccessToken();
      if (!token) return;
      const res = await usersApi.getFriendRequests();
      // Предполагаем, что API возвращает массив заявок
      if (Array.isArray(res.data)) {
        setFriendRequestsCount(res.data.length);
      }
    } catch (err) {
      console.error('Failed to fetch friend requests count:', err);
    }
  }, []);

  const playNotificationSound = React.useCallback(async () => {
    try {
      if (await isWithinQuietHours()) {
        console.log('[NotificationContext] Quiet hours active, skipping sound');
        return;
      }
      await setNotificationAudioMode();
      if (notificationPlayerRef.current) {
        await notificationPlayerRef.current.play();
      }
    } catch (error) {
      console.log('Error playing notification sound', error);
    }
  }, []);

  const clearUnread = React.useCallback((userId) => {
    setDialogs(prev => prev.map(d => 
      Number(d.user_id) === Number(userId) ? { ...d, unread_count: 0 } : d
    ));
  }, []);

  const connect = React.useCallback((token) => {
    if (!token || token === 'null' || token === 'undefined') {
      console.log('Skipping WS connect: no token');
      return;
    }

    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      if (lastToken.current === token) {
        console.log('Notifications WS already connected or connecting with same token');
        return;
      }
      console.log('Notifications WS connected with different token, closing old one');
      ws.current.close();
    }

    lastToken.current = token;
    shouldReconnect.current = true;
    
    // Also connect to Chat WS
    connectChatWs(token);

    const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
    const baseUrlClean = API_BASE_URL.replace('http://', '').replace('https://', '');
    const wsUrl = `${protocol}${baseUrlClean}/ws/notifications?token=${encodeURIComponent(token)}`;
    console.log('[NotificationContext] Connecting to notifications WS:', wsUrl.split('?')[0] + '?token=***');
    
    try {
      console.log('[NotificationContext] Creating new WebSocket instance...');
      ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('[NotificationContext] Notifications WS connected. readyState:', ws.current.readyState);
      setIsConnected(true);
      reconnectAttempt.current = 0; // Reset attempts on successful connection
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
      heartbeatInterval.current = setInterval(() => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.current.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        console.log('[NotificationContext] Notification received:', payload.type, payload.data?.id || payload.message_id || '');
        
        if (payload.type === 'friend_requests_count') {
          setFriendRequestsCount(payload.count);
        }

        if (payload.type === 'new_message') {
          const message = payload.data;
          setDialogs(prev => {
            const index = prev.findIndex(d => 
              Number(d.user_id) === Number(message.sender_id) || 
              Number(d.user_id) === Number(message.receiver_id)
            );

            if (index !== -1) {
              const newDialogs = [...prev];
              const d = newDialogs[index];
              const isFromMe = Number(message.sender_id) === Number(currentUserIdRef.current);
              const otherUserId = isFromMe ? Number(message.receiver_id) : Number(message.sender_id);
              const isActiveChat = Number(activeChatIdRef.current) === otherUserId;

              newDialogs[index] = {
                ...d,
                last_message: message.message || (message.message_type === 'media_group' ? 'Медиафайлы' : (message.message_type || 'Сообщение')),
                last_message_time: message.created_at,
                unread_count: (isFromMe || isActiveChat) ? d.unread_count : ((d.unread_count || 0) + 1)
              };

              // Перемещаем диалог в начало списка
              const [updated] = newDialogs.splice(index, 1);
              newDialogs.unshift(updated);
              return newDialogs;
            } else {
              // Новый диалог, загружаем весь список, чтобы получить данные пользователя
              fetchDialogs();
              return prev;
            }
          });
        }

        if (payload.type === 'message_deleted') {
          const msgId = payload.message_id || payload.data?.id;
          if (msgId) {
             // Мы не знаем, было ли это последнее сообщение, 
             // поэтому для надежности обновляем список диалогов через API
             fetchDialogs();
          }
        }

        if (payload.type === 'messages_read' || payload.type === 'your_messages_read') {
          const readerId = payload.reader_id || payload.data?.reader_id || payload.data?.from_user_id;
          const isMe = Number(readerId) === Number(currentUserIdRef.current);
          const otherId = isMe ? (payload.data?.from_user_id || payload.data?.user_id) : readerId;
          
          if (isMe && otherId) {
            setDialogs(prev => prev.map(d => 
              Number(d.user_id) === Number(otherId) ? { ...d, unread_count: 0 } : d
            ));
          }
        }

        if (payload.type === 'user_status') {
          const { user_id, status, last_seen } = payload.data;
          console.log(`[NotificationContext] User ${user_id} status changed to ${status}`);
          setDialogs(prev => prev.map(d => 
            Number(d.user_id) === Number(user_id) ? { ...d, status, last_seen } : d
          ));
        }

        if (payload.type === 'friend_request' || payload.type === 'friend_accept') {
          fetchFriendRequestsCount();
        }

        if (payload.type === 'new_message') {
          const senderId = payload.data.sender_id;
          const isActiveChat = Number(activeChatIdRef.current) === Number(senderId);
          const isMe = Number(senderId) === Number(currentUserIdRef.current);
          
          if (appState.current === 'active' && !isActiveChat && !isMe) {
            playNotificationSound();
            Vibration.vibrate([0, 200, 100, 200]);

            // Визуальное оповещение внутри приложения удалено по просьбе пользователя
          }
        }

        setNotifications((prev) => [payload, ...prev]);
      } catch (err) {
        console.error('Failed to parse notification message:', err);
      }
    };

    ws.current.onclose = (e) => {
      console.log('[NotificationContext] Notifications WS closed:', e.code, e.reason);
      setIsConnected(false);
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
      
      // Clear any existing reconnect timer
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      // Всегда пробуем восстановиться, если это не был явный disconnect()
      if (shouldReconnect.current) {
        // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
        const delay = Math.min(30000, Math.pow(2, reconnectAttempt.current) * 2000);
        console.log(`[NotificationContext] Will try to reconnect notifications WS in ${delay/1000}s... (Attempt ${reconnectAttempt.current + 1})`);
        
        reconnectTimer.current = setTimeout(() => {
          reconnectAttempt.current += 1;
          storage.getAccessToken()
            .then(token => {
              if (token) connect(token);
            })
            .catch(err => console.log('Failed to get token for reconnect', err));
        }, delay);
      }
    };

    ws.current.onerror = (e) => {
      console.error('[NotificationContext] Notifications WS error event details:', {
        type: e.type,
        readyState: ws.current?.readyState,
        url: wsUrl.split('?')[0]
      });
      // Log more details if available
      if (e.message) console.error('[NotificationContext] Error message:', e.message);
    };
  } catch (err) {
    console.error('[NotificationContext] Error creating WebSocket:', err);
  }
  }, [fetchDialogs, fetchFriendRequestsCount, playNotificationSound]);

  useEffect(() => {
    storage.getAccessToken().then(token => {
      if (token) connect(token);
    });
  }, [connect]);

  const disconnect = React.useCallback(() => {
    shouldReconnect.current = false;
    chatWsShouldReconnect.current = false;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (chatWsReconnectTimer.current) {
      clearTimeout(chatWsReconnectTimer.current);
      chatWsReconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.close(1000);
      ws.current = null;
    }
    if (chatWs.current) {
      chatWs.current.close(1000);
      chatWs.current = null;
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      appState.current = nextAppState;
      // При возврате в активное состояние пытаемся восстановить соединение нотификаций
      if (nextAppState === 'active') {
        if (!ws.current || (ws.current.readyState !== WebSocket.OPEN && ws.current.readyState !== WebSocket.CONNECTING)) {
          storage.getAccessToken()
            .then((tok) => {
              if (tok) connect(tok);
            })
            .catch(err => console.log('Failed to get token on AppState change', err));
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [connect]);

  useEffect(() => {
    const loadUser = async () => {
      setLoadingUser(true);
      try {
        const token = await storage.getAccessToken();
        if (token) {
          const userRes = await usersApi.getMe();
          setCurrentUser(userRes.data);
          setCurrentUserId(userRes.data.id);
        }
      } catch (err) {
        console.log('Failed to load current user in NotificationContext', err);
      } finally {
        setLoadingUser(false);
      }
    };
    loadUser();
  }, []);

  useEffect(() => {
    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
      if (chatWsHeartbeatInterval.current) {
        clearInterval(chatWsHeartbeatInterval.current);
      }
      disconnect();
    };
  }, [disconnect]);

  useEffect(() => {
    if (isConnected) {
      console.log('[NotificationContext] WS connected, fetching initial state...');
      fetchDialogs();
      fetchFriendRequestsCount();
    }
  }, [isConnected, fetchDialogs, fetchFriendRequestsCount]);

  return (
    <NotificationContext.Provider value={{ 
      notifications, 
      dialogs, 
      unreadTotal, 
      friendRequestsCount,
      fetchDialogs, 
      fetchFriendRequestsCount,
      isConnected, 
      connect, 
      disconnect,
      sendMessage,
      getHistoryWs,
      onHistoryReceived,
      markAsReadWs,
      deleteMessageWs,
      bulkDeleteMessagesWs,
      currentUser,
      loadingUser,
      currentUserId,
      activeChatId,
      setActiveChatId,
      clearUnread
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
