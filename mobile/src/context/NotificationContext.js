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
  const [notifications, setNotifications] = useState([]);
  const [dialogs, setDialogs] = useState([]);
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

  const notificationPlayer = useAudioPlayer(require('../../assets/sounds/message.mp3'));
  const notificationPlayerRef = useRef(notificationPlayer);

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

    const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
    const wsUrl = `${protocol}${API_BASE_URL.replace('http://', '').replace('https://', '')}/ws/notifications?token=${token}`;
    console.log('[NotificationContext] Connecting to notifications WS:', wsUrl.split('?')[0] + '?token=***');
    
    try {
      ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('[NotificationContext] Notifications WS connected');
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
        console.log('[NotificationContext] Notification received:', payload.type, payload.data?.id || '');
        
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

            // Визуальное оповещение внутри приложения с быстрым переходом в чат
            try {
              const dlg = dialogsRef.current.find(d => Number(d.user_id) === Number(senderId));
              const senderName = payload.data.sender_name || (
                dlg ? (`${dlg.first_name || ''} ${dlg.last_name || ''}`.trim() || dlg.email || 'Новый диалог') : 'Новый диалог'
              );
              const preview = (payload.data.message && payload.data.message.trim())
                ? payload.data.message.trim().slice(0, 80)
                : (payload.data.message_type === 'media_group' ? 'Медиафайлы' : (payload.data.message_type || 'Сообщение'));

              Alert.alert(
                'Новое сообщение',
                `${senderName}: ${preview}`,
                [
                  {
                    text: 'Открыть',
                    onPress: () => {
                      try {
                        if (navigationRef?.isReady?.()) {
                          navigationRef.navigate('Messages', {
                            screen: 'Chat',
                            params: { userId: senderId, userName: senderName }
                          });
                        }
                      } catch (e) {
                        console.log('Navigation to chat failed:', e);
                      }
                    }
                  },
                  { text: 'Закрыть', style: 'cancel' }
                ]
              );
            } catch (e) {
              console.log('Failed to show in-app alert for new message:', e);
            }
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
      console.error('[NotificationContext] Notifications WS error:', e.message || 'Unknown error');
    };
  } catch (err) {
    console.error('[NotificationContext] Error creating WebSocket:', err);
  }
  }, [fetchDialogs, fetchFriendRequestsCount, playNotificationSound]);

  const disconnect = React.useCallback(() => {
    shouldReconnect.current = false;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (ws.current) {
      ws.current.close(1000);
      ws.current = null;
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
