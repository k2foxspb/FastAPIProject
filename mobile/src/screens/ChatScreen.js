import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, Modal, Pressable, Alert, StatusBar, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { chatApi, usersApi } from '../api';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';
import { useNotifications } from '../context/NotificationContext';
import { uploadManager } from '../utils/uploadManager';
import CachedMedia from '../components/CachedMedia';
import VoiceMessage from '../components/VoiceMessage';
import FileMessage from '../components/FileMessage';
import { Video, ResizeMode, Audio } from 'expo-av';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatStatus, formatName, formatFileSize } from '../utils/formatters';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ChatScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
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
  const [currentUserIdLocal, setCurrentUserIdLocal] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState(null);
  const recordingRef = useRef(null);
  const isStartingRecording = useRef(false);
  const LIMIT = 15;
  const ws = useRef(null);
  const videoPlayerRef = useRef(null);
  const { fetchDialogs, currentUserId, setActiveChatId } = useNotifications();
  const screenWidth = Dimensions.get('window').width;
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);

  // Звук для нового сообщения в чате
  const playMessageSound = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sounds/message.mp3')
      );
      await sound.playAsync();
      // Выгружаем звук из памяти после воспроизведения
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (error) {
      console.log('Error playing message sound', error);
    }
  };

  useEffect(() => {
    setActiveChatId(userId);
    return () => setActiveChatId(null);
  }, [userId]);

  useEffect(() => {
    const initChat = async () => {
      const accessToken = await storage.getAccessToken();
      setToken(accessToken);

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

      // Загрузка данных текущего пользователя
      usersApi.getMe().then(res => setCurrentUserIdLocal(res.data.id)).catch(err => console.log(err));

      // WebSocket соединение
      const protocol = API_BASE_URL.startsWith('https') ? 'wss://' : 'ws://';
      const wsUrl = `${protocol}${API_BASE_URL.replace('http://', '').replace('https://', '')}/chat/ws/${accessToken}`;
      ws.current = new WebSocket(wsUrl);

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

      ws.current.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data);
          // Check if message is defined
          if (!message) return;
          
          console.log('[Chat WS] Received message:', message.id, message.message_type);
          
          if (message.type === 'message_deleted') {
            setMessages(prev => prev.filter(m => m.id !== message.message_id));
            return;
          }

          if (message.type === 'messages_read') {
            // Обновляем статус прочтения у наших сообщений
            setMessages(prev => prev.map(m => 
              (m.sender_id === currentUserId || m.sender_id === currentUserIdLocal) ? { ...m, is_read: true } : m
            ));
            return;
          }
          
          if (message.sender_id === userId || (message.sender_id !== userId && message.receiver_id === userId)) {
            // Если мы в этом чате, то сообщение от собеседника или наше подтверждение
            setMessages(prev => {
              if (prev.find(m => m.id === message.id)) return prev;
              const newMessages = [message, ...prev];
              console.log('[Chat WS] Updating messages state. New count:', newMessages.length);
              return newMessages;
            });
            setSkip(prev => prev + 1);
            
            // Если сообщение от собеседника, помечаем как прочитанное и играем звук
            if (message.sender_id === userId) {
              playMessageSound();
              // Отправляем через WS что прочитали для мгновенного обновления у отправителя
              if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({
                  type: 'mark_read',
                  other_id: userId
                }));
              }
              // Также вызываем API для обновления в БД и счетчиков
              chatApi.markAsRead(userId, accessToken).then(() => fetchDialogs());
            }
          }
        } catch (err) {
          console.error('[Chat WS] Error processing message:', err);
        }
      };
    };

    initChat();

    return () => {
      if (ws.current) ws.current.close();
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
    // messages отсортированы от новых к старым (inverted).
    // Пользователь хочет: свайп влево (следующий индекс) -> более ранние (старые).
    // Это значит, что старые сообщения должны быть ДАЛЬШЕ в массиве media (индекс выше).
    // А новые - в НАЧАЛЕ массива (индекс 0).
    // Так как messages уже от новых к старым, просто идем по ним.
    
    messages.forEach(msg => {
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
    });
    setAllMedia(media);
  }, [messages]);

  const openFullScreen = (uri) => {
    // Для видео/фото из кэша uri может быть локальным путем (file://...)
    // Нам нужно сопоставить его с элементом в allMedia
    const index = allMedia.findIndex(m => {
      if (m.uri === uri) return true;
      // Проверяем по имени файла, если uri локальный
      const fileName = uri.split('/').pop();
      const mFileName = m.uri.split('/').pop();
      return fileName === mFileName;
    });
    
    if (index !== -1) {
      setCurrentMediaIndex(index);
      setFullScreenMedia({ index, list: allMedia });
    } else {
      // Fallback если вдруг не нашли в общем списке
      setCurrentMediaIndex(0);
      setFullScreenMedia({ index: 0, list: [{ uri, type: 'image' }] });
    }
  };

  const sendMessage = () => {
    if (selectionMode) return;
    if (inputText.trim()) {
      const msgData = {
        receiver_id: userId,
        message: inputText.trim(),
        message_type: 'text'
      };
      ws.current.send(JSON.stringify(msgData));
      setInputText('');
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
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              const msgData = {
                receiver_id: userId,
                file_path: result.file_path,
                message_type: result.message_type
              };
              ws.current.send(JSON.stringify(msgData));
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
      // Clean up any existing recording first
      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch (e) {}
        setRecording(null);
        recordingRef.current = null;
      }

      const permission = await Audio.requestPermissionsAsync();
      if (permission.status === "granted") {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        const { recording: newRecording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = newRecording;
        setRecording(newRecording);
        setIsRecording(true);
      } else {
        Alert.alert('Доступ запрещен', 'Нам нужно разрешение на микрофон для записи голосовых сообщений');
      }
    } catch (err) {
      console.error('Failed to start recording', err);
      setIsRecording(false);
      setRecording(null);
      recordingRef.current = null;
    } finally {
      isStartingRecording.current = false;
    }
  };

  const stopRecording = async () => {
    // If we are still starting, we should wait or handle it
    if (isStartingRecording.current) {
      // Small delay to allow start to finish, or just check recordingRef
      let attempts = 0;
      while (isStartingRecording.current && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }

    const currentRecording = recordingRef.current || recording;

    if (!currentRecording) {
      setIsRecording(false);
      return;
    }
    
    setIsRecording(false);
    try {
      const status = await currentRecording.getStatusAsync();
      if (status.canRecord) {
        await currentRecording.stopAndUnloadAsync();
        const uri = currentRecording.getURI();
        if (uri) {
          uploadVoiceMessage(uri);
        }
      }
    } catch (err) {
      console.error('Failed to stop recording', err);
    } finally {
      setRecording(null);
      recordingRef.current = null;
    }
  };

  const uploadVoiceMessage = async (uri) => {
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
    const isReceived = item.sender_id === userId;
    const isOwner = item.sender_id === (currentUserId || currentUserIdLocal);
    const isSelected = selectedIds.includes(item.id);

    // Группировка: если предыдущее сообщение от того же отправителя и разница во времени менее 2 минут
    const prevMsg = messages[index + 1]; // Помним, что FlatList inverted
    const isGrouped = prevMsg && prevMsg.sender_id === item.sender_id && 
                      (new Date(item.timestamp) - new Date(prevMsg.timestamp)) < 120000;

    const handleFullScreen = (uri, type) => {
      if (selectionMode) {
        toggleSelection(item.id);
        return;
      }
      openFullScreen(uri);
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
            <VoiceMessage item={item} currentUserId={currentUserIdLocal} />
          )}
          {isFile && (
            <FileMessage item={item} currentUserId={currentUserIdLocal} />
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
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: colors.background }]}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
              <MaterialIcons name="trash-can-outline" size={24} color={selectedIds.length > 0 ? colors.error : colors.textSecondary} />
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
        data={messages}
        keyExtractor={(item) => (item.id || Math.random()).toString()}
        renderItem={renderMessageItem}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.1}
        inverted={true}
        ListHeaderComponent={renderUploadPlaceholder}
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
            }}
            keyExtractor={(_, i) => `fs_media_${i}`}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: mediaItem, index }) => (
              <View style={{ width: screenWidth, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                <CachedMedia 
                  item={mediaItem}
                  style={styles.fullScreenVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls={true}
                  shouldPlay={currentMediaIndex === index}
                  isMuted={false}
                />
              </View>
            )}
          />
        </View>
      </Modal>

      <View style={[styles.inputContainer, { backgroundColor: colors.background, borderTopColor: colors.border, borderTopWidth: 1 }]}>
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
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Сообщение..."
          placeholderTextColor={colors.textSecondary}
          multiline
        />
        {inputText.trim() ? (
          <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
            <MaterialIcons name="send" size={24} color={colors.primary} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            onPressIn={startRecording} 
            onPressOut={stopRecording} 
            style={[styles.sendButton, isRecording && { backgroundColor: colors.primary + '20', borderRadius: 20 }]}
          >
            <MaterialIcons name={isRecording ? "mic" : "mic-none"} size={24} color={isRecording ? colors.error : colors.primary} />
          </TouchableOpacity>
        )}
      </View>
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
  messageBubble: { padding: 12, borderRadius: 18, maxWidth: '80%' },
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
  input: { flex: 1, borderWidth: 1, borderRadius: 20, paddingHorizontal: 15, height: 40, fontSize: 16 },
  sendButton: { justifyContent: 'center', marginLeft: 10 },
  sendButtonText: { color: '#007AFF', fontWeight: 'bold' },
  attachButton: { justifyContent: 'center', marginRight: 10, paddingHorizontal: 10 },
  attachButtonText: { fontSize: 24, color: '#007AFF' },
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
});
