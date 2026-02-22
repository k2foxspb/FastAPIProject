import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Vibration, AppState } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { API_BASE_URL } from '../constants';
import { usersApi, chatApi } from '../api';
import { storage } from '../utils/storage';
import { setNotificationAudioMode } from '../utils/audioSettings';
import { isWithinQuietHours } from '../utils/quietHours';

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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      appState.current = nextAppState;
    });
    return () => {
      subscription.remove();
    };
  }, []);

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
      notificationPlayer.play();
    } catch (error) {
      console.log('Error playing notification sound', error);
    }
  }, [notificationPlayer]);

  const connect = React.useCallback((token) => {
    if (!token || token === 'null' || token === 'undefined') {
      console.log('Skipping WS connect: no token');
      return;
    }

    if (ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
      console.log('Notifications WS already connected or connecting');
      return;
    }

    if (ws.current) {
      ws.current.close();
    }

    const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
    const wsUrl = `${protocol}${API_BASE_URL.replace('http://', '').replace('https://', '')}/ws/notifications?token=${token}`;
    console.log('Connecting to notifications WS:', wsUrl.split('?')[0] + '?token=***');
    
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('Notifications WS connected');
      setIsConnected(true);
    };

    ws.current.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        console.log('[NotificationContext] Notification received:', payload.type, payload.data?.id || '');
        
        if (payload.type === 'new_message' || payload.type === 'messages_read' || payload.type === 'your_messages_read' || payload.type === 'message_deleted') {
          console.log('[NotificationContext] Triggering fetchDialogs due to:', payload.type);
          // Обновляем список диалогов при получении нового сообщения, пометке о прочтении или удалении
          fetchDialogs();
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
          }
        }

        setNotifications((prev) => [payload, ...prev]);
      } catch (err) {
        console.error('Failed to parse notification message:', err);
      }
    };

    ws.current.onclose = (e) => {
      console.log('Notifications WS closed:', e.code, e.reason);
      setIsConnected(false);
      
      // Auto-reconnect on unexpected close (1006 or 4003 which we use for invalid token)
      // But only if we have a token and it was previously connected
      if (e.code !== 1000 && e.code !== 1001) {
         console.log('Notifications WS unexpected close, will try to reconnect in 5s...');
         setTimeout(() => {
           storage.getAccessToken().then(token => {
             if (token) connect(token);
           });
         }, 5000);
      }
    };

    ws.current.onerror = (e) => {
      console.error('Notifications WS error:', e.message);
    };
  }, [fetchDialogs, fetchFriendRequestsCount, playNotificationSound]);

  const disconnect = React.useCallback(() => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
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
