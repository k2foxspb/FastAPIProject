import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, Modal, Pressable, Alert, StatusBar, Dimensions, Share, Animated, Vibration } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { documentDirectory, getInfoAsync, downloadAsync, deleteAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { chatApi, usersApi } from '../api';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';
import { useNotifications } from '../context/NotificationContext';
import { uploadManager } from '../utils/uploadManager';
import CachedMedia from '../components/CachedMedia';
import VoiceMessage from '../components/VoiceMessage';
import FileMessage from '../components/FileMessage';
import { Audio, useAudioRecorder, useAudioRecorderState, useAudioPlayer, RecordingPresets, AudioModule, requestRecordingPermissionsAsync, createAudioPlayer } from 'expo-audio';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatStatus, formatName, formatFileSize } from '../utils/formatters';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setPlaybackAudioMode, setRecordingAudioMode, setNotificationAudioMode } from '../utils/audioSettings';
import { isWithinQuietHours } from '../utils/quietHours';

export default function ChatScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { setActiveChatId, fetchDialogs, currentUserId, notifications } = useNotifications();
  const { userId, userName } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [token, setToken] = useState(null);
  const [uploadingProgress, setUploadingProgress] = useState(null);
  const [uploadingData, setUploadingData] = useState({ loaded: 0, total: 0, uri: null, mimeType: null });
  const [activeUploadId, setActiveUploadId] = useState(null);
  const [fullScreenMedia, setFullScreenMedia] = useState(null); // { index, list }
  const [allMedia, setAllMedia] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Групповая отправка медиа
  const [batchMode, setBatchMode] = useState(false);
  const [batchAttachments, setBatchAttachments] = useState([]); // [{file_path, type}]
  const [batchTotal, setBatchTotal] = useState(0);
  const [autoSendOnUpload, setAutoSendOnUpload] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const [interlocutor, setInterlocutor] = useState(null);
  const [attachmentsLocalCount, setAttachmentsLocalCount] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingInterval = useRef(null);
  const isStartingRecording = useRef(false);
  const stopRequested = useRef(false);
  const isMounted = useRef(true);
  const LIMIT = 15;
  const ws = useRef(null);
  const lastProcessedNotificationId = useRef(null);
  const videoPlayerRef = useRef(null);
  const chatFlatListRef = useRef(null);
  const recordingOptions = useMemo(() => RecordingPresets.HIGH_QUALITY, []);
  const recorder = useAudioRecorder(recordingOptions);
  const recorderStatus = useAudioRecorderState(recorder);
  const notificationPlayer = useAudioPlayer(require('../../assets/sounds/message.mp3'));
  const screenWidth = Dimensions.get('window').width;
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const recordingDotOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingDotOpacity, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(recordingDotOpacity, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      recordingDotOpacity.setValue(1);
    }
  }, [isRecording]);

  useEffect(() => {
    if (recorderStatus.isRecording) {
      setRecordingDuration(recorderStatus.durationMillis);
    }
  }, [recorderStatus.durationMillis, recorderStatus.isRecording]);

  // Звук для нового сообщения в чате
  const playMessageSound = async () => {
    try {
      if (await isWithinQuietHours()) {
        console.log('[ChatScreen] Quiet hours active, skipping sound');
        return;
      }
      await setNotificationAudioMode();
      notificationPlayer.play();
      Vibration.vibrate([0, 200, 100, 200]);
    } catch (error) {
      console.log('Error playing message sound', error);
    }
  };

  // Резервный механизм: слушаем глобальные уведомления, если Chat WS подводит
  useEffect(() => {
    if (notifications.length > 0) {
      const lastNotify = notifications[0];
      const notifyType = lastNotify.type;
      
      // Чтобы не обрабатывать одно и то же уведомление многократно при перерисовках
      const notifyKey = `${notifyType}_${lastNotify.data?.id || lastNotify.message_id || lastNotify.data?.from_user_id || Math.random()}`;
      if (notifyKey === lastProcessedNotificationId.current) return;
      lastProcessedNotificationId.current = notifyKey;

      if (notifyType === 'new_message' && lastNotify.data) {
        const message = lastNotify.data;
        const msgSenderId = Number(message.sender_id);
        const msgReceiverId = Number(message.receiver_id);
        const currentChatId = Number(userId);
        const myIdNum = Number(currentUserId);

        const isRelated = (msgSenderId === currentChatId && msgReceiverId === myIdNum) || 
                          (msgSenderId === myIdNum && msgReceiverId === currentChatId);
        
        if (isRelated) {
          setMessages(prev => {
            if (prev.find(m => Number(m.id) === Number(message.id))) return prev;
            console.log('[ChatScreen Backup] New message added:', message.id);
            return [message, ...prev];
          });
          setSkip(prev => prev + 1);
          if (Number(message.sender_id) === Number(userId)) {
             playMessageSound();
          }
        }
      } else if (notifyType === 'message_deleted') {
        const msgId = lastNotify.message_id;
        if (msgId) {
          setMessages(prev => {
            if (prev.find(m => m.id === msgId)) {
              console.log('[ChatScreen Backup] Message deleted:', msgId);
              return prev.filter(m => m.id !== msgId);
            }
            return prev;
          });
        }
      } else if (notifyType === 'messages_read' || notifyType === 'your_messages_read') {
        const readerId = lastNotify.reader_id || lastNotify.data?.reader_id || lastNotify.data?.from_user_id;
        if (Number(readerId) === Number(userId) || Number(readerId) === Number(currentUserId)) {
          console.log('[ChatScreen Backup] Messages marked as read by:', readerId);
          setMessages(prev => prev.map(m => 
            (m.sender_id && Number(m.sender_id) === Number(currentUserId)) ? { ...m, is_read: true } : m
          ));
        }
      } else if (notifyType === 'user_status' && lastNotify.data) {
        const { user_id, status, last_seen } = lastNotify.data;
        if (Number(user_id) === Number(userId)) {
          console.log('[ChatScreen Backup] Interlocutor status changed:', status);
          setInterlocutor(prev => prev ? { ...prev, status, last_seen } : null);
        }
      }
    }
  }, [notifications, userId, currentUserId]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    setActiveChatId(userId);
    return () => {
      setActiveChatId(null);
      // We don't call recorder.stop() here because useAudioRecorder manages its own lifecycle.
      // Calling it manually during unmount can race with the hook's internal cleanup.
      if (recordingInterval.current) {
        clearInterval(recordingInterval.current);
        recordingInterval.current = null;
      }
    };
  }, [userId]);

  const lastParams = useRef({ userId: null, token: null });
  const heartbeatInterval = useRef(null);

  const startHeartbeat = (wsInstance) => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
    heartbeatInterval.current = setInterval(() => {
      if (wsInstance.readyState === WebSocket.OPEN) {
        wsInstance.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30 seconds
  };

  useEffect(() => {
    let ignore = false;
    const connectWs = (accessToken, myId) => {
      if (lastParams.current.userId === userId && lastParams.current.token === accessToken && ws.current && (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING)) {
        console.log('[ChatScreen] Already connected or connecting to this chat, skipping.');
        return;
      }
      
      const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
      const wsUrl = `${protocol}${API_BASE_URL.replace('http://', '').replace('https://', '')}/chat/ws/${accessToken}`;
      console.log('[ChatScreen] Connecting to WS:', wsUrl.split('/ws/')[0] + '/ws/***');
      
      if (ignore) return;
      
      if (ws.current) {
        ws.current.close(1000);
      }

      lastParams.current = { userId, token: accessToken };
      
      const newWs = new WebSocket(wsUrl);
      ws.current = newWs;

      newWs.onopen = () => {
        console.log('[Chat WS] Connected');
        startHeartbeat(newWs);
      };

      newWs.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          if (!message || typeof message !== 'object') return;
          
          console.log('[Chat WS] Received message:', message.id, message.type || message.message_type);
          
          if (message.type === 'message_deleted') {
            if (message.message_id) {
              setMessages(prev => prev.filter(m => m.id !== message.message_id));
            }
            // Также обновляем список диалогов, так как последнее сообщение могло измениться
            fetchDialogs();
            return;
          }

          if (message.type === 'messages_read' || message.type === 'your_messages_read') {
            // Обновляем статус прочтения у наших сообщений
            setMessages(prev => prev.map(m => 
              (m.sender_id && Number(m.sender_id) === Number(myId)) ? { ...m, is_read: true } : m
            ));
            return;
          }
          
          // Проверяем, относится ли сообщение к текущему чату
          const msgSenderId = Number(message.sender_id);
          const msgReceiverId = Number(message.receiver_id);
          const currentChatId = Number(userId);
          const myIdNum = Number(myId);

          const isRelated = (msgSenderId === currentChatId && msgReceiverId === myIdNum) || 
                            (msgSenderId === myIdNum && msgReceiverId === currentChatId);

          if (isRelated) {
            console.log(`[Chat WS] isRelated true. msgId=${message.id}, sender=${msgSenderId}, chat=${currentChatId}`);
            setMessages(prev => {
              if (prev.find(m => Number(m.id) === Number(message.id))) {
                console.log('[Chat WS] Message already in state:', message.id);
                return prev;
              }
              const newMessages = [message, ...prev];
              console.log('[Chat WS] Added message via Chat WS. New count:', newMessages.length);
              return newMessages;
            });
            setSkip(prev => prev + 1);
            
            const isIncoming = Number(message.sender_id) === Number(userId);
            console.log(`[Chat WS] isIncoming: ${isIncoming}, id: ${message.id}`);

            if (isIncoming) {
              playMessageSound();
              if (newWs.readyState === WebSocket.OPEN) {
                newWs.send(JSON.stringify({
                  type: 'mark_read',
                  other_id: userId
                }));
              }
              // markAsRead API call is redundant if we use WS, 
              // but we'll keep it as a backup for reliability 
              // but remove fetchDialogs from here to avoid request spam.
              chatApi.markAsRead(userId, accessToken);
            }
          }
        } catch (err) {
          console.error('[Chat WS] Error processing message:', err);
        }
      };

      newWs.onclose = (e) => {
        console.log('[Chat WS] Closed:', e.code, e.reason);
        if (heartbeatInterval.current) {
          clearInterval(heartbeatInterval.current);
          heartbeatInterval.current = null;
        }
        // Реконнект при неожиданном закрытии
        if (e.code !== 1000 && isMounted.current) {
          console.log('[Chat WS] Reconnecting in 3s...');
          setTimeout(async () => {
            if (isMounted.current && !ignore) {
              const freshToken = await storage.getAccessToken();
              setToken(freshToken); // Обновляем токен в стейте для других запросов
              connectWs(freshToken, myId);
            }
          }, 3000);
        }
      };

      newWs.onerror = (e) => {
        console.error('[Chat WS] Error:', e.message);
      };
    };

    const initChat = async () => {
      const accessToken = await storage.getAccessToken();
      setToken(accessToken);

      let myId = null;
      // Загрузка данных текущего пользователя для корректной фильтрации WS
      try {
        const userRes = await usersApi.getMe();
        myId = userRes.data.id;
      } catch (err) {
        console.log('Failed to load current user', err);
      }

      // Загрузка начальной истории
      try {
        const res = await chatApi.getHistory(userId, accessToken, LIMIT, 0);
        console.log(`[ChatScreen] Loaded initial history: ${res.data.length} messages`);
        setMessages(res.data);
        setSkip(res.data.length);
        if (res.data.length < LIMIT) {
          setHasMore(false);
        }
      } catch (error) {
        console.error('Failed to load history', error);
      }

      // Помечаем как прочитанные
      chatApi.markAsRead(userId, accessToken).then(() => fetchDialogs());

      // Загрузка данных собеседника
      usersApi.getUser(userId).then(res => setInterlocutor(res.data)).catch(err => console.log(err));

      if (!myId) {
        console.error('[ChatScreen] Cannot initialize chat: myId is null');
        return;
      }

      if (ignore) return;
      // WebSocket соединение
      connectWs(accessToken, myId);

      // Проверка активных загрузок
      uploadManager.getActiveUploadsForReceiver(userId).then(activeUploads => {
        if (activeUploads.length > 0) {
          const mainUpload = activeUploads[0];
          setActiveUploadId(mainUpload.upload_id);
          setUploadingProgress(mainUpload.currentOffset / mainUpload.fileSize);
          setUploadingData({ 
            loaded: mainUpload.currentOffset, 
            total: mainUpload.fileSize,
            uri: mainUpload.fileUri,
            mimeType: mainUpload.mimeType
          });
        }
      });
    };

    initChat();

    return () => {
      ignore = true;
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [userId]);

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore || !token) return;

    setLoadingMore(true);
    try {
      const res = await chatApi.getHistory(userId, token, LIMIT, skip);
      console.log(`[ChatScreen] Loaded ${res.data.length} more messages. Skip was ${skip}`);
      if (res.data.length > 0) {
        setMessages(prev => {
           const newMsgs = res.data.filter(m => !prev.find(pm => pm.id === m.id));
           return [...prev, ...newMsgs];
        });
        setSkip(prev => prev + res.data.length);
      }
      if (res.data.length < LIMIT) {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to load more messages', error);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // Собираем все медиафайлы из сообщений для полноэкранного просмотра
    const media = [];
    // Сообщения в messages идут от новых к старым (inverted FlatList).
    // Пользователь хочет, чтобы скролл вправо (увеличение индекса в allMedia)
    // вел к БОЛЕЕ ПОЗДНИМ (новым) видео.
    // Значит allMedia должен быть от СТАРЫХ к НОВЫМ.
    // Для этого итерируем messages с конца.
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.message_type === 'media_group' && msg.attachments) {
        msg.attachments.forEach(att => {
          if (att.file_path) {
            media.push({
              uri: att.file_path.startsWith('http') ? att.file_path : `${API_BASE_URL}${att.file_path}`,
              file_path: att.file_path,
              type: att.type,
              messageId: msg.id
            });
          }
        });
      } else if ((msg.message_type === 'image' || msg.message_type === 'video') && msg.file_path) {
        media.push({
          uri: msg.file_path.startsWith('http') ? msg.file_path : `${API_BASE_URL}${msg.file_path}`,
          file_path: msg.file_path,
          type: msg.message_type,
          messageId: msg.id
        });
      }
    }
    setAllMedia(media);
  }, [messages]);

  const openFullScreen = (uri, type) => {
    // Для видео/фото из кэша uri может быть локальным путем (file://...)
    // Нам нужно сопоставить его с элементом в allMedia
    const index = allMedia.findIndex(m => {
      if (m.uri === uri) return true;
      // Проверяем по имени файла, если uri локальный
      const fileName = uri.split('/').pop();
      const mFileName = m.uri.split('/').pop();
      return fileName && mFileName && fileName === mFileName;
    });
    
    if (index !== -1) {
      setCurrentMediaIndex(index);
      setFullScreenMedia({ index, list: allMedia });
      
      // Синхронизируем чат при открытии
      const mediaItem = allMedia[index];
      if (mediaItem && mediaItem.messageId) {
        const msgIndex = messages.findIndex(m => m.id === mediaItem.messageId);
        if (msgIndex !== -1) {
          setTimeout(() => {
            chatFlatListRef.current?.scrollToIndex({ index: msgIndex, animated: true, viewPosition: 0.5 });
          }, 100);
        }
      }
    } else {
      // Fallback если вдруг не нашли в общем списке
      setCurrentMediaIndex(0);
      setFullScreenMedia({ index: 0, list: [{ uri, type: type || 'image', file_path: uri }] });
    }
  };

  const handleDownloadMedia = async () => {
    const currentMedia = fullScreenMedia?.list[currentMediaIndex];
    if (!currentMedia) return;

    if (Platform.OS === 'web') {
      try {
        const uri = currentMedia.uri;
        const fileName = uri.split('/').pop();
        const link = document.createElement('a');
        link.href = uri;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        window.open(currentMedia.uri, '_blank');
      }
      return;
    }

    try {
      const uri = currentMedia.uri;
      const fileName = uri.split('/').pop();
      const localFileUri = `${documentDirectory}${fileName}`;

      const fileInfo = await getInfoAsync(localFileUri);
      let finalUri = localFileUri;

      if (!fileInfo.exists) {
        Alert.alert('Загрузка', 'Файл скачивается...');
        const downloadRes = await downloadAsync(uri, localFileUri);
        finalUri = downloadRes.uri;
      }

      if (Platform.OS === 'android') {
        const permissions = await StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const base64 = await readAsStringAsync(finalUri, { encoding: EncodingType.Base64 });
          const mimeType = currentMedia.type === 'video' ? 'video/mp4' : 'image/jpeg';
          const newFileUri = await StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            mimeType
          );
          await writeAsStringAsync(newFileUri, base64, { encoding: EncodingType.Base64 });
          Alert.alert('Успех', 'Медиа-файл сохранен');
        }
      } else {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(finalUri);
        } else {
          Alert.alert('Ошибка', 'Функция "Поделиться" недоступна на этом устройстве');
        }
      }
    } catch (error) {
      console.error('Error downloading media:', error);
      Alert.alert('Ошибка', 'Не удалось скачать файл');
    }
  };

  const sendMessage = async () => {
    if (selectionMode) return;
    if (inputText.trim()) {
      const msgData = {
        receiver_id: userId,
        message: inputText.trim(),
        message_type: 'text'
      };
      
      try {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify(msgData));
          console.log('[Chat WS] Message sent:', inputText.trim());
          setInputText('');
        } else {
          console.log('[ChatScreen] WS not open, sending via API fallback');
          const res = await chatApi.sendMessage(msgData, token);
          if (res.data) {
            setMessages(prev => {
              if (prev.find(m => m.id === res.data.id)) return prev;
              return [res.data, ...prev];
            });
            setInputText('');
          }
        }
      } catch (err) {
        console.error('[Chat WS] Send error:', err);
        Alert.alert('Ошибка', 'Не удалось отправить сообщение');
      }
    }
  };

  useEffect(() => {
    if (activeUploadId) {
      const unsubscribe = uploadManager.subscribe(activeUploadId, ({ progress, status, result, loaded, total }) => {
        setUploadingProgress(progress);
        if (loaded !== undefined) setUploadingData(prev => ({ ...prev, loaded, total }));
        
        if (status === 'completed') {
          // Для одиночных голосовых сообщений отправляем здесь
          // Для медиа и документов теперь отправляем вручную в функциях загрузки
          if (autoSendOnUpload && !batchMode) { 
            const msgData = {
              receiver_id: userId,
              file_path: result.file_path,
              message_type: result.message_type
            };
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              ws.current.send(JSON.stringify(msgData));
            } else {
              chatApi.sendMessage(msgData, token).then(res => {
                if (res.data) {
                  setMessages(prev => {
                    if (prev.find(m => m.id === res.data.id)) return prev;
                    return [res.data, ...prev];
                  });
                }
              });
            }
          } 
          setUploadingProgress(null);
          setActiveUploadId(null);
          setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
        } else if (status === 'error') {
          setUploadingProgress(null);
          setActiveUploadId(null);
          setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
          Alert.alert('Ошибка', 'Не удалось завершить загрузку файла');
        } else if (status === 'cancelled') {
          setUploadingProgress(null);
          setActiveUploadId(null);
          setUploadingData({ loaded: 0, total: 0, uri: null, mimeType: null });
        }
      });
      return () => unsubscribe();
    }
  }, [activeUploadId, userId, autoSendOnUpload]);

  const pickAndUploadDocument = async () => {
    if (selectionMode) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true
      });

      if (!result.canceled) {
        const assets = result.assets || [];
        setBatchMode(true);
        setAutoSendOnUpload(false);
        setBatchTotal(assets.length);
        setAttachmentsLocalCount(0);
        const attachmentsLocal = [];
        
        for (const asset of assets) {
          setUploadingData({ 
            loaded: 0, 
            total: asset.size || 0, 
            uri: asset.uri, 
            mimeType: asset.mimeType 
          });
          setUploadingProgress(0);
          
          try {
            const res = await uploadManager.uploadFileResumable(
              asset.uri,
              asset.name,
              asset.mimeType,
              userId,
              (uid) => setActiveUploadId(uid)
            );

            if (res && res.status === 'completed') {
               setAttachmentsLocalCount(prev => prev + 1);
               attachmentsLocal.push({ file_path: res.file_path, type: res.message_type });
            }
          } catch (err) {
            console.error('Failed to upload asset in batch', asset.name, err);
          }
        }

        if (attachmentsLocal.length > 0) {
          const msgData = attachmentsLocal.length === 1 
            ? {
                receiver_id: userId,
                file_path: attachmentsLocal[0].file_path,
                message_type: attachmentsLocal[0].type
              }
            : {
                receiver_id: userId,
                attachments: attachmentsLocal,
                message_type: 'media_group'
              };

          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify(msgData));
          } else {
            chatApi.sendMessage(msgData, token).then(res => {
              if (res.data) {
                setMessages(prev => {
                  if (prev.find(m => m.id === res.data.id)) return prev;
                  return [res.data, ...prev];
                });
              }
            });
          }
        }
      }
    } catch (error) {
      console.error('Document picking failed', error);
      Alert.alert('Ошибка', 'Произошла ошибка при выборе или загрузке документа');
    } finally {
      setBatchMode(false);
      setAutoSendOnUpload(true);
      setUploadingProgress(null);
      setActiveUploadId(null);
      setBatchTotal(0);
      setAttachmentsLocalCount(0);
    }
  };

  const pickAndUploadFile = async () => {
    if (selectionMode) return;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Доступ запрещен', 'Нам нужно разрешение на доступ к галерее, чтобы это работало');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 1,
        allowsMultipleSelection: true,
      });

      if (!result.canceled) {
        let assets = result.assets || [];
        if (assets.length > 10) {
          Alert.alert('Ограничение', 'Можно отправить не более 10 файлов за раз. Лишние будут проигнорированы.');
          assets = assets.slice(0, 10);
        }

        setBatchMode(true);
        setAutoSendOnUpload(false);
        setBatchTotal(assets.length);
        setAttachmentsLocalCount(0);
        const attachmentsLocal = [];

        for (const asset of assets) {
          const fileName = asset.uri.split('/').pop();
          setUploadingData({ 
            loaded: 0, 
            total: asset.fileSize || asset.size || 0, 
            uri: asset.uri, 
            mimeType: asset.mimeType 
          });
          setUploadingProgress(0);
          
          try {
            const res = await uploadManager.uploadFileResumable(
              asset.uri, 
              fileName, 
              asset.mimeType,
              userId,
              (upload_id) => setActiveUploadId(upload_id)
            );
            
            if (res && res.status === 'completed') {
              setAttachmentsLocalCount(prev => prev + 1);
              attachmentsLocal.push({ file_path: res.file_path, type: res.message_type });
            }
          } catch (err) {
            console.error('Failed to upload image/video in batch', fileName, err);
          }
        }

        if (attachmentsLocal.length > 0) {
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            if (attachmentsLocal.length === 1) {
                const msgData = {
                  receiver_id: userId,
                  file_path: attachmentsLocal[0].file_path,
                  message_type: attachmentsLocal[0].type
                };
                ws.current.send(JSON.stringify(msgData));
            } else {
                ws.current.send(JSON.stringify({
                  receiver_id: userId,
                  attachments: attachmentsLocal,
                  message_type: 'media_group'
                }));
            }
          }
        }
      }
    } catch (error) {
      console.error('Upload or picking failed', error);
      Alert.alert('Ошибка', 'Произошла ошибка при выборе или загрузке файла');
    } finally {
      setBatchMode(false);
      setAutoSendOnUpload(true);
      setBatchAttachments([]);
      setBatchTotal(0);
      setAttachmentsLocalCount(0);
      setUploadingProgress(null);
      setActiveUploadId(null);
    }
  };

  const getAvatarUrl = (url) => {
    if (!url) return 'https://via.placeholder.com/150';
    if (url.startsWith('http') || url.startsWith('file://') || url.startsWith('content://')) return url;
    return `${API_BASE_URL}${url}`;
  };

  const startRecording = async () => {
    if (isStartingRecording.current) return;
    
    try {
      isStartingRecording.current = true;
      stopRequested.current = false;
      
      // Визуально меняем состояние сразу, чтобы кнопка реагировала мгновенно
      setIsRecording(true);
      setRecordingDuration(0);

      const permission = await requestRecordingPermissionsAsync();
      if (!isMounted.current) return;

      if (permission.status === "granted") {
        // Проверяем, не отпустил ли пользователь кнопку пока мы ждали пермишенов
        if (stopRequested.current || (recorder && recorder.isReleased)) {
          setIsRecording(false);
          isStartingRecording.current = false;
          return;
        }

        await setRecordingAudioMode();
        if (!isMounted.current) return;
        
        // Снова проверяем, не отпустил ли пользователь кнопку
        if (stopRequested.current || (recorder && recorder.isReleased)) {
          setIsRecording(false);
          isStartingRecording.current = false;
          return;
        }

        // В expo-audio не нужно вызывать prepareToRecordAsync, вызываем сразу record()
        // и проверяем isReleased перед каждым вызовом
        if (recorder && !recorder.isReleased) {
          await recorder.record();
        }
        
        if (!isMounted.current) return;
      } else {
        setIsRecording(false);
        Alert.alert('Доступ запрещен', 'Нам нужно разрешение на микрофон для записи голосовых сообщений');
      }
    } catch (err) {
      console.error('Failed to start recording', err);
      setIsRecording(false);
    } finally {
      isStartingRecording.current = false;
    }
  };

  const stopRecording = async () => {
    // Помечаем, что запись должна быть остановлена
    stopRequested.current = true;
    
    // Сразу сбрасываем визуальное состояние, чтобы кнопка «отжалась»
    setIsRecording(false);

    if (recorder && !recorder.isReleased && recorder.isRecording) {
      try {
        await recorder.stop();
        if (!isMounted.current || (recorder && recorder.isReleased)) return;
        
        const uri = recorder.uri;
        if (uri) {
          setRecordedUri(uri);
        }
      } catch (err) {
        console.error('Failed to stop recording', err);
      }
    }
  };

  const deleteRecording = async () => {
    if (recordedUri) {
      try {
        await deleteAsync(recordedUri, { idempotent: true });
      } catch (e) {
        console.error('Failed to delete recording file', e);
      }
    }
    setRecordedUri(null);
    setRecordingDuration(0);
  };

  const formatRecordingTime = (millis) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const uploadVoiceMessage = async (uri) => {
    if (!uri) return;
    try {
      const fileName = `voice_${Date.now()}.m4a`;
      const mimeType = 'audio/m4a';
      setUploadingData({ loaded: 0, total: 0, uri: uri, mimeType: mimeType });
      
      await uploadManager.uploadFileResumable(
        uri, 
        fileName, 
        mimeType,
        userId,
        (upload_id) => setActiveUploadId(upload_id)
      );
      setRecordedUri(null);
      setRecordingDuration(0);
    } catch (error) {
      console.error('Voice upload failed', error);
      Alert.alert('Ошибка', 'Не удалось загрузить голосовое сообщение');
    } finally {
      setUploadingProgress(null);
    }
  };

  const renderUploadPlaceholder = () => {
    if (uploadingProgress === null || !uploadingData.uri) return null;

    return (
      <View style={[
        styles.messageWrapper, 
        styles.sentWrapper,
        { opacity: 0.7, marginBottom: 10 }
      ]}>
        <View style={[styles.messageBubble, styles.sent, { backgroundColor: colors.primary }]}>
          {uploadingData.mimeType?.startsWith('image/') ? (
            <Image 
              source={{ uri: uploadingData.uri }} 
              style={{ width: 200, height: 150, borderRadius: 10 }} 
              resizeMode="cover" 
            />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
              <MaterialIcons name="insert-drive-file" size={24} color="#fff" />
              <Text style={{ color: '#fff', marginLeft: 10 }}>Загрузка файла...</Text>
            </View>
          )}
          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, { color: 'rgba(255,255,255,0.7)' }]}>Отправка...</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderMessageItem = ({ item, index }) => {
    const isImage = item.message_type === 'image';
    const isVideo = item.message_type === 'video';
    const isVoice = item.message_type === 'voice';
    const isFile = item.message_type === 'file';
    const isReceived = Number(item.sender_id) === Number(userId);
    const isOwner = Number(item.sender_id) === Number(currentUserId);
    const isSelected = selectedIds.includes(item.id);

    // Группировка: если предыдущее сообщение от того же отправителя и разница во времени менее 2 минут
    const prevMsg = messages[index + 1]; // Помним, что FlatList inverted
    const isGrouped = prevMsg && Number(prevMsg.sender_id) === Number(item.sender_id) && 
                      (new Date(item.timestamp) - new Date(prevMsg.timestamp)) < 120000;

    const handleFullScreen = (uri, type) => {
      if (selectionMode) {
        toggleSelection(item.id);
        return;
      }
      openFullScreen(uri, type);
    };

    const toggleSelection = (id) => {
      setSelectedIds(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
      );
    };

    const handleLongPress = () => {
      if (!selectionMode) {
        setSelectionMode(true);
        setSelectedIds([item.id]);
      }
    };

    const handlePress = () => {
      if (selectionMode) {
        toggleSelection(item.id);
      }
    };

    return (
      <Pressable 
        onPress={handlePress}
        onLongPress={handleLongPress}
        style={[
          styles.messageWrapper,
          isReceived ? styles.receivedWrapper : styles.sentWrapper,
          isSelected && { backgroundColor: colors.primary + '20' },
          isGrouped && { marginTop: -2 }
        ]}
      >
        {isReceived && (
          <View style={styles.avatarContainer}>
            {!isGrouped ? (
              <TouchableOpacity 
                disabled={selectionMode}
                onPress={() => navigation.navigate('UserProfile', { userId: userId })}
              >
                <Image 
                  source={{ uri: getAvatarUrl(interlocutor?.avatar_preview_url || interlocutor?.avatar_url) }} 
                  style={styles.messageAvatar} 
                />
              </TouchableOpacity>
            ) : (
              <View style={styles.messageAvatarPlaceholder} />
            )}
          </View>
        )}
        <View 
          style={[
            styles.messageBubble, 
            isReceived 
              ? [styles.received, { backgroundColor: colors.surface }] 
              : [styles.sent, { backgroundColor: colors.primary }],
            (isImage || isVideo) && !item.message && { padding: 4 },
            isSelected && !isReceived && { opacity: 0.8 },
            isGrouped && (isReceived ? { borderTopLeftRadius: 18 } : { borderTopRightRadius: 18 })
          ]}
        >
          {selectionMode && (
            <View style={styles.selectionIndicator}>
              <MaterialIcons 
                name={isSelected ? "check-circle" : "radio-button-unchecked"} 
                size={16} 
                color={isReceived ? (isSelected ? colors.primary : colors.textSecondary) : "#fff"} 
              />
            </View>
          )}
          {/* Медиа-группа */}
          {item.attachments && item.attachments.length > 0 ? (
            <View style={styles.mediaGridContainer}>
              <View style={styles.mediaGrid}>
                {item.attachments.map((att, idx) => {
                  if (!att.file_path) return null;
                  const attUri = att.file_path.startsWith('http') ? att.file_path : `${API_BASE_URL}${att.file_path}`;
                  
                  // Расчет размеров для сетки
                  const count = item.attachments.length;
                  let itemWidth = '100%';
                  let itemHeight = 200;
                  
                  if (count === 2) {
                    itemWidth = '49%';
                    itemHeight = 150;
                  } else if (count === 3) {
                    if (idx === 0) {
                      itemWidth = '100%';
                      itemHeight = 150;
                    } else {
                      itemWidth = '49%';
                      itemHeight = 100;
                    }
                  } else if (count >= 4) {
                    itemWidth = '49%';
                    itemHeight = 100;
                  }

                  return (
                    <Pressable 
                      key={`${item.id}_att_${idx}`}
                      onPress={() => handleFullScreen(attUri, att.type)}
                      style={{ 
                        width: itemWidth, 
                        height: itemHeight, 
                        borderRadius: 8, 
                        marginBottom: 4,
                        overflow: 'hidden'
                      }}
                    >
                      <CachedMedia 
                        item={{ ...att, message_type: att.type }} 
                        style={{ width: '100%', height: '100%' }}
                        onFullScreen={() => handleFullScreen(attUri, att.type)}
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : (
            (isImage || isVideo) && (
              <CachedMedia item={item} onFullScreen={handleFullScreen} />
            )
          )}
          {isVoice && (
            <VoiceMessage item={item} currentUserId={currentUserId} />
          )}
          {isFile && (
            <FileMessage item={item} currentUserId={currentUserId} />
          )}
          {item.message && (
            <Text style={[
              styles.messageText, 
              (isImage || isVideo) && {marginTop: 5, marginHorizontal: 8, marginBottom: 4}, 
              isReceived ? {color: colors.text} : {color: '#fff'}
            ]}>
              {item.message}
            </Text>
          )}
          <View style={styles.messageFooter}>
            <Text style={[
              styles.messageTime, 
              isReceived ? {color: colors.textSecondary} : {color: 'rgba(255,255,255,0.7)'}
            ]}>
              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {!isReceived && (
              <MaterialIcons 
                name={item.is_read ? "done-all" : "done"} 
                size={14} 
                color={item.is_read ? "#4CAF50" : "rgba(255,255,255,0.7)"} 
                style={styles.statusIcon}
              />
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;

    const ownCount = messages.filter(m => selectedIds.includes(m.id) && m.sender_id !== userId).length;
    const othersCount = selectedIds.length - ownCount;
    
    let message = `Удалить выбранные сообщения (${selectedIds.length})?`;
    if (ownCount > 0 && othersCount > 0) {
      message = `Удалить ${selectedIds.length} сообщений? Ваши сообщения (${ownCount}) удалятся у всех, а чужие (${othersCount}) — только у вас.`;
    } else if (ownCount > 0) {
      message = `Удалить ваши сообщения (${ownCount}) для всех участников?`;
    } else {
      message = `Удалить чужие сообщения (${othersCount}) для себя? У собеседника они останутся.`;
    }

    Alert.alert(
      'Удалить сообщения?',
      message,
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const accessToken = await storage.getAccessToken();
              await chatApi.bulkDeleteMessages(selectedIds, accessToken);

              // Локально обновляем список сообщений, чтобы чат сразу отразил удаление
              const removedCount = selectedIds.length;
              setMessages(prev => prev.filter(m => !selectedIds.includes(m.id)));
              setSkip(prev => Math.max(0, prev - removedCount));

              setSelectionMode(false);
              setSelectedIds([]);
            } catch (error) {
              console.error('Failed to bulk delete messages', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщения');
            }
          }
        }
      ]
    );
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : (Platform.OS === 'android' ? 'height' : undefined)} 
      style={[styles.container, { backgroundColor: colors.background }]}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      enabled={Platform.OS !== 'web'}
    >
      <View style={[styles.header, { 
        borderBottomColor: colors.border, 
        backgroundColor: colors.background, 
        paddingTop: insets.top || (Platform.OS === 'ios' ? 40 : 10) 
      }]}>
        {selectionMode ? (
          <View style={styles.selectionHeader}>
            <TouchableOpacity onPress={() => { setSelectionMode(false); setSelectedIds([]); }}>
              <MaterialIcons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.selectionTitle, { color: colors.text }]}>Выбрано: {selectedIds.length}</Text>
            <TouchableOpacity onPress={handleBulkDelete} disabled={selectedIds.length === 0}>
              <MaterialIcons name="delete" size={24} color={selectedIds.length > 0 ? colors.error : colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.headerInfoContainer}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.headerInfo} 
              onPress={() => navigation.navigate('UserProfile', { userId: userId })}
            >
              <View style={styles.headerAvatarContainer}>
                <Image 
                  source={{ uri: getAvatarUrl(interlocutor?.avatar_preview_url || interlocutor?.avatar_url) }} 
                  style={styles.headerAvatar} 
                />
                {interlocutor?.status === 'online' && (
                  <View style={[styles.headerOnlineBadge, { backgroundColor: '#4CAF50', borderColor: colors.background }]} />
                )}
              </View>
              <View>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{formatName(interlocutor) || userName}</Text>
                {interlocutor && (
                  <Text style={[styles.headerStatus, { color: colors.textSecondary }]}>
                    {formatStatus(interlocutor.status, interlocutor.last_seen)}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {uploadingProgress !== null && (
        <View style={[styles.uploadProgressContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.uploadProgressInfo}>
            <Text style={{ color: colors.text }}>
              {batchMode ? `Загрузка медиа (${attachmentsLocalCount + 1}/${batchTotal || 1}) - ${Math.round(uploadingProgress * 100)}%` : `Загрузка: ${formatFileSize(uploadingData.loaded)} / ${formatFileSize(uploadingData.total)} (${Math.round(uploadingProgress * 100)}%)`}
            </Text>
            <TouchableOpacity onPress={() => uploadManager.cancelUpload(activeUploadId)}>
              <MaterialIcons name="cancel" size={24} color={colors.error} />
            </TouchableOpacity>
          </View>
          <View style={styles.progressBarBackground}>
            <View style={[styles.progressBar, { width: `${uploadingProgress * 100}%`, backgroundColor: colors.primary }]} />
          </View>
        </View>
      )}
      <FlatList
        ref={chatFlatListRef}
        data={messages}
        extraData={[messages.length, currentUserId, selectedIds.length, theme, userId]}
        keyExtractor={(item) => (item.id || Math.random()).toString()}
        renderItem={renderMessageItem}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.1}
        inverted={true}
        ListHeaderComponent={renderUploadPlaceholder}
        onScrollToIndexFailed={(info) => {
          chatFlatListRef.current?.scrollToOffset({ 
            offset: info.averageItemLength * info.index, 
            animated: true 
          });
        }}
        removeClippedSubviews={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={10}
        style={{ flex: 1 }}
      />

      <Modal
        visible={!!fullScreenMedia}
        transparent={true}
        onRequestClose={() => setFullScreenMedia(null)}
      >
        <View style={styles.fullScreenContainer}>
          <StatusBar hidden />
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={() => setFullScreenMedia(null)}
          >
            <MaterialIcons name="close" size={30} color="white" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.downloadButton} 
            onPress={handleDownloadMedia}
          >
            <MaterialIcons name="file-download" size={30} color="white" />
          </TouchableOpacity>
          
          <FlatList
            data={fullScreenMedia?.list || []}
            horizontal
            pagingEnabled
            initialScrollIndex={fullScreenMedia?.index || 0}
            getItemLayout={(_, index) => ({
              length: screenWidth,
              offset: screenWidth * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
              setCurrentMediaIndex(index);
              
              // Синхронизация чата: прокручиваем к сообщению, из которого это медиа
              const mediaItem = fullScreenMedia?.list[index];
              if (mediaItem && mediaItem.messageId) {
                const msgIndex = messages.findIndex(m => m.id === mediaItem.messageId);
                if (msgIndex !== -1) {
                  chatFlatListRef.current?.scrollToIndex({ 
                    index: msgIndex, 
                    animated: true, 
                    viewPosition: 0.5 
                  });
                }
              }
            }}
            keyExtractor={(_, i) => `fs_media_${i}`}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: mediaItem, index }) => (
              <View style={{ width: screenWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                <CachedMedia 
                  item={mediaItem}
                  style={styles.fullScreenVideo}
                  resizeMode="contain"
                  useNativeControls={true}
                  shouldPlay={currentMediaIndex === index}
                  isMuted={false}
                />
              </View>
            )}
          />
        </View>
      </Modal>

      {!selectionMode && (
        <View style={[
          styles.inputContainer, 
          { 
            backgroundColor: colors.background, 
            borderTopColor: colors.border, 
            borderTopWidth: 1,
            paddingBottom: Platform.OS === 'web' ? 20 : Math.max(insets.bottom, 12) + 5
          }
        ]}>
          {recordedUri ? (
            <View style={styles.recordedContainer}>
              <TouchableOpacity onPress={deleteRecording} style={styles.deleteRecordingButton}>
                <MaterialIcons name="delete" size={24} color={colors.error} />
              </TouchableOpacity>
              <View style={styles.recordingWaveformPlaceholder}>
                <MaterialIcons name="mic" size={20} color={colors.primary} />
                <Text style={[styles.recordingTimeText, { color: colors.text }]}>Голосовое сообщение ({formatRecordingTime(recordingDuration)})</Text>
              </View>
              <TouchableOpacity onPress={() => uploadVoiceMessage(recordedUri)} style={[styles.sendButton, { marginRight: 10 }]}>
                <MaterialIcons name="send" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {!isRecording && (
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity 
                    onPress={pickAndUploadDocument} 
                    style={styles.attachButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="insert-drive-file" size={24} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={pickAndUploadFile} 
                    style={styles.attachButton}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialIcons name="image" size={24} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}
              
              {isRecording ? (
                <View style={styles.recordingContainer}>
                  <View style={styles.recordingIndicator}>
                    <Animated.View style={[styles.recordingDot, { opacity: recordingDotOpacity }]} />
                    <Text style={[styles.recordingTimeText, { color: colors.error }]}>
                      {formatRecordingTime(recorderStatus.durationMillis || recordingDuration)}
                    </Text>
                  </View>
                  <Text style={[styles.recordingHint, { color: colors.textSecondary }]}>Отпустите для завершения</Text>
                </View>
              ) : (
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder="Сообщение..."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                />
              )}

              {(inputText.trim() && !isRecording) ? (
                <TouchableOpacity onPress={sendMessage} style={[styles.sendButton, { marginRight: 10 }]}>
                  <MaterialIcons name="send" size={24} color={colors.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity 
                  onPressIn={startRecording} 
                  onPressOut={stopRecording} 
                  style={[
                    styles.sendButton, 
                    { marginRight: 10 },
                    isRecording && { backgroundColor: colors.primary + '20', borderRadius: 20 }
                  ]}
                >
                  <MaterialIcons name={isRecording ? "mic" : "mic-none"} size={24} color={isRecording ? colors.error : colors.primary} />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  headerInfoContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 10,
    padding: 5,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  headerAvatarContainer: {
    position: 'relative',
  },
  headerOnlineBadge: {
    position: 'absolute',
    right: 8,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    zIndex: 1
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerStatus: {
    fontSize: 12,
  },
  messageWrapper: {
    flexDirection: 'row',
    marginVertical: 5,
    paddingHorizontal: 10,
    alignItems: 'flex-end',
  },
  receivedWrapper: {
    justifyContent: 'flex-start',
  },
  sentWrapper: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
    marginBottom: 2,
  },
  messageAvatarPlaceholder: {
    width: 30,
    marginRight: 8,
  },
  avatarContainer: {
    width: 38,
    justifyContent: 'flex-end',
  },
  mediaGridContainer: {
    width: 260,
    marginTop: 2,
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  messageBubble: { 
    padding: 12, 
    borderRadius: 20, 
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  sent: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  received: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 16, lineHeight: 22 },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    alignSelf: 'flex-end',
  },
  messageTime: {
    fontSize: 10,
    marginRight: 4,
  },
  statusIcon: {
    marginLeft: 2,
  },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff' },
  selectionHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
  },
  selectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 15,
    flex: 1,
  },
  selectionIndicator: {
    position: 'absolute',
    top: 5,
    right: 5,
    zIndex: 1,
  },
  input: { 
    flex: 1, 
    borderWidth: 1, 
    borderRadius: 24, 
    paddingHorizontal: 16, 
    paddingTop: 8,
    paddingBottom: 8,
    minHeight: 40,
    maxHeight: 120,
    fontSize: 16 
  },
  sendButton: { justifyContent: 'center', marginLeft: 10 },
  sendButtonText: { color: '#007AFF', fontWeight: 'bold' },
  attachButton: { justifyContent: 'center', marginRight: 10, paddingHorizontal: 10 },
  attachButtonText: { fontSize: 24, color: '#007AFF' },
  recordingContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    height: 40,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff3b30',
    marginRight: 8,
  },
  recordingTimeText: {
    fontSize: 16,
    fontWeight: '500',
  },
  recordingHint: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  recordedContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    height: 40,
  },
  deleteRecordingButton: {
    padding: 5,
  },
  recordingWaveformPlaceholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 20,
    paddingHorizontal: 15,
    height: 36,
    marginHorizontal: 10,
  },
  uploadProgressContainer: { 
    padding: 10, 
    backgroundColor: '#fff', 
    borderBottomWidth: 1, 
    borderColor: '#eee' 
  },
  uploadProgressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  progressBarBackground: {
    height: 4,
    backgroundColor: '#eee',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: { 
    height: '100%', 
  },
  fileLinkText: { color: '#fff', textDecorationLine: 'underline', marginBottom: 5 },
  fullScreenContainer: { flex: 1, backgroundColor: 'black' },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
  closeButton: { position: 'absolute', top: 40, right: 20, zIndex: 10 },
  downloadButton: { position: 'absolute', top: 40, left: 20, zIndex: 10 },
});
