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
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeChatId, setActiveChatId] = useState(null);
  const activeChatIdRef = useRef(null);
  const currentUserIdRef = useRef(null);
  const appState = useRef(AppState.currentState);
  const ws = useRef(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);
  const notificationPlayer = useAudioPlayer(require('../../assets/sounds/message.mp3'));
  const notificationPlayerRef = useRef(notificationPlayer);

  useEffect(() => {
    notificationPlayerRef.current = notificationPlayer;
  }, [notificationPlayer]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      appState.current = nextAppState;
      // При возврате в активное состояние пытаемся восстановить соединение нотификаций
      if (nextAppState === 'active') {
        if (!ws.current || (ws.current.readyState !== WebSocket.OPEN && ws.current.readyState !== WebSocket.CONNECTING)) {
          storage.getAccessToken().then((tok) => {
            if (tok) connect(tok);
          });
        }
      }
    });
    return () => {
      subscription.remove();
    };
  }, [connect]);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const userRes = await usersApi.getMe();
        setCurrentUserId(userRes.data.id);
      } catch (err) {
        console.log('Failed to load current user in NotificationContext', err);
      }
    };
    loadUser();
  }, []);

  const fetchDialogs = React.useCallback(async () => {
    try {
      const token = await storage.getAccessToken();
      if (!token) return;
      const res = await chatApi.getDialogs(token);
      setDialogs(res.data);
      const total = res.data.reduce((acc, d) => acc + d.unread_count, 0);
      setUnreadTotal(total);
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
        notificationPlayerRef.current.play();
      }
    } catch (error) {
      console.log('Error playing notification sound', error);
    }
  }, []);

  const lastToken = useRef(null);
  const heartbeatInterval = useRef(null);
  const shouldReconnect = useRef(true);

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
        
        if (payload.type === 'new_message' || payload.type === 'messages_read' || payload.type === 'your_messages_read' || payload.type === 'message_deleted') {
          // Если это новое сообщение, проверяем, не в этом ли мы чате сейчас
          if (payload.type === 'new_message') {
            const senderId = payload.data.sender_id;
            const isActiveChat = Number(activeChatIdRef.current) === Number(senderId);
            if (isActiveChat) {
              console.log('[NotificationContext] Skipping fetchDialogs for active chat message');
              // Не прерываем совсем, так как уведомление может содержать важные метаданные, 
              // но fetchDialogs() сделает сам ChatScreen
            } else {
              console.log('[NotificationContext] Triggering fetchDialogs due to:', payload.type);
              fetchDialogs();
            }
          } else {
            console.log('[NotificationContext] Triggering fetchDialogs due to:', payload.type);
            fetchDialogs();
          }
        }

        if (payload.type === 'user_status') {
          const { user_id, status, last_seen } = payload.data;
          console.log(`[NotificationContext] User ${user_id} status changed to ${status}`);
          setDialogs(prev => prev.map(d => 
            Number(d.user_id) === Number(user_id) ? { ...d, status, last_seen } : d
          ));
        }

        if (payload.type === 'messages_read' || payload.type === 'your_messages_read') {
           // Если мы в чате, то WebSocket чата сам обновит сообщения,
           // но если мы в списке диалогов, нам нужно обновить состояние диалогов, что делает fetchDialogs() выше.
        }

        if (payload.type === 'friend_request' || payload.type === 'friend_accept') {
          // Обновляем счетчик заявок в друзья
          fetchFriendRequestsCount();
        }

        if (payload.type === 'new_message') {
          const senderId = payload.data.sender_id;
          // Если приложение открыто, но мы НЕ в чате с этим пользователем и это не наше сообщение
          const isActiveChat = Number(activeChatIdRef.current) === Number(senderId);
          const isMe = Number(senderId) === Number(currentUserIdRef.current);
          
          if (appState.current === 'active' && !isActiveChat && !isMe) {
            console.log('[NotificationContext] Playing sound for new message from:', senderId);
            playNotificationSound();
            Vibration.vibrate([0, 200, 100, 200]);

            // Визуальное оповещение внутри приложения с быстрым переходом в чат
            try {
              const dlg = dialogs.find(d => Number(d.user_id) === Number(senderId));
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
      // Всегда пробуем восстановиться, если это не был явный disconnect()
      if (shouldReconnect.current) {
        console.log('[NotificationContext] Will try to reconnect notifications WS in 3s...');
        setTimeout(() => {
          storage.getAccessToken().then(token => {
            if (token) connect(token);
          });
        }, 3000);
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
    if (ws.current) {
      ws.current.close(1000);
      ws.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
      disconnect();
    };
  }, []);

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
      currentUserId,
      activeChatId,
      setActiveChatId
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => useContext(NotificationContext);
