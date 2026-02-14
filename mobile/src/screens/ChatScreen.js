import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image, Modal, Pressable, Alert, StatusBar } from 'react-native';
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
import { formatStatus, formatName } from '../utils/formatters';
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
  const [fullScreenMedia, setFullScreenMedia] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const [interlocutor, setInterlocutor] = useState(null);
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
      const wsUrl = `ws://${API_BASE_URL.replace('http://', '').replace('https://', '')}/chat/ws/${accessToken}`;
      ws.current = new WebSocket(wsUrl);

      ws.current.onmessage = (e) => {
        const message = JSON.parse(e.data);
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
            return [message, ...prev];
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
      if (res.data.length > 0) {
        setMessages(prev => [...prev, ...res.data]);
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

  const sendMessage = () => {
    if (selectionMode) return;
    if (inputText.trim()) {
      const msgData = {
        receiver_id: userId,
        message: inputText,
        message_type: 'text'
      };
      ws.current.send(JSON.stringify(msgData));
      setInputText('');
    }
  };

  const pickAndUploadDocument = async () => {
    if (selectionMode) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled) {
        for (const asset of result.assets) {
          setUploadingProgress(0);
          const uploadResult = await uploadManager.uploadFileResumable(
            asset.uri,
            asset.name,
            asset.mimeType,
            (progress) => setUploadingProgress(progress)
          );

          if (uploadResult.status === 'completed') {
            const msgData = {
              receiver_id: userId,
              file_path: uploadResult.file_path,
              message_type: uploadResult.message_type
            };
            ws.current.send(JSON.stringify(msgData));
          }
        }
      }
    } catch (error) {
      console.error('Document picking failed', error);
      alert('Произошла ошибка при выборе или загрузке документа');
    } finally {
      setUploadingProgress(null);
    }
  };

  const pickAndUploadFile = async () => {
    if (selectionMode) return;
    try {
      // Запрашиваем разрешение
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        alert('Извините, нам нужно разрешение на доступ к галерее, чтобы это работало!');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'], // Используем массив строк для надежности в SDK 54
        quality: 1,
        allowsMultipleSelection: true,
      });

      if (!result.canceled) {
        for (const asset of result.assets) {
          const fileName = asset.uri.split('/').pop();
          
          setUploadingProgress(0);
          const uploadResult = await uploadManager.uploadFileResumable(
            asset.uri, 
            fileName, 
            asset.mimeType,
            (progress) => setUploadingProgress(progress)
          );

          if (uploadResult.status === 'completed') {
            // Отправляем сообщение в чат с ссылкой на файл
            const msgData = {
              receiver_id: userId,
              file_path: uploadResult.file_path,
              message_type: uploadResult.message_type
            };
            ws.current.send(JSON.stringify(msgData));
          }
        }
      }
  } catch (error) {
      console.error('Upload or picking failed', error);
      alert('Произошла ошибка при выборе или загрузке файла');
    } finally {
      setUploadingProgress(null);
    }
  };

  const getAvatarUrl = (url) => {
    if (!url) return 'https://via.placeholder.com/150';
    if (url.startsWith('http')) return url;
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
      
      setUploadingProgress(0);
      const uploadResult = await uploadManager.uploadFileResumable(
        uri, 
        fileName, 
        mimeType,
        (progress) => setUploadingProgress(progress)
      );

      if (uploadResult.status === 'completed') {
        const msgData = {
          receiver_id: userId,
          file_path: uploadResult.file_path,
          message_type: 'voice'
        };
        ws.current.send(JSON.stringify(msgData));
      }
    } catch (error) {
      console.error('Voice upload failed', error);
      Alert.alert('Ошибка', 'Не удалось загрузить голосовое сообщение');
    } finally {
      setUploadingProgress(null);
    }
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
      setFullScreenMedia({ uri, type });
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
          {(isImage || isVideo) && (
            <CachedMedia item={item} onFullScreen={handleFullScreen} />
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
          <Text style={{ color: colors.text }}>Загрузка: {Math.round(uploadingProgress * 100)}%</Text>
          <View style={[styles.progressBar, { width: `${uploadingProgress * 100}%`, backgroundColor: colors.primary }]} />
        </View>
      )}
      <FlatList
        data={messages}
        keyExtractor={(item) => (item.id || Math.random()).toString()}
        renderItem={renderMessageItem}
        onEndReached={loadMoreMessages}
        onEndReachedThreshold={0.1}
        inverted={true}
      />

      <Modal
        visible={!!fullScreenMedia}
        transparent={true}
        onRequestClose={() => setFullScreenMedia(null)}
      >
        <View style={styles.fullScreenContainer}>
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={() => setFullScreenMedia(null)}
          >
            <MaterialIcons name="close" size={30} color="white" />
          </TouchableOpacity>
          {fullScreenMedia?.type === 'video' ? (
            <Video
              ref={videoPlayerRef}
              source={{ uri: fullScreenMedia.uri }}
              style={styles.fullScreenVideo}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              onPlaybackStatusUpdate={(status) => {
                if (status.didJustFinish) {
                  // Автоматическая перемотка в начало по окончании
                  videoPlayerRef.current?.setPositionAsync(0);
                }
              }}
            />
          ) : (
            <Image 
              source={{ uri: fullScreenMedia?.uri }} 
              style={styles.fullScreenImage} 
              resizeMode="contain" 
            />
          )}
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
  uploadProgressContainer: { padding: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  progressBar: { height: 3, backgroundColor: '#007AFF', marginTop: 5 },
  fileLinkText: { color: '#fff', textDecorationLine: 'underline', marginBottom: 5 },
  fullScreenContainer: { flex: 1, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' },
  fullScreenImage: { width: '100%', height: '100%' },
  fullScreenVideo: { width: '100%', height: '100%' },
  closeButton: { position: 'absolute', top: 40, right: 20, zIndex: 1 },
});
