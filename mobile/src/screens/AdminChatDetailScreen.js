import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Image, ActivityIndicator, TouchableOpacity, Alert, Modal, Pressable, Dimensions, Platform } from 'react-native';
import { getShadow } from '../utils/shadowStyles';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import api from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { formatName } from '../utils/formatters';
import CachedMedia from '../components/CachedMedia';
import VoiceMessage from '../components/VoiceMessage';
import FileMessage from '../components/FileMessage';
import VideoPlayer from '../components/VideoPlayer';
import { documentDirectory, getInfoAsync, downloadAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { setPlaybackAudioMode } from '../utils/audioSettings';

export default function AdminChatDetailScreen({ route, navigation }) {
  const { u1, u2 } = route.params;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const flatListRef = useRef();
  const [fullScreenMedia, setFullScreenMedia] = useState(null);
  const screen = Dimensions.get('window');

  // Выделение сообщений
  const [selectedIds, setSelectedIds] = useState([]);
  const isSelectionMode = selectedIds.length > 0;

  useEffect(() => {
    navigation.setOptions({ title: `${formatName(u1)} & ${formatName(u2)}` });
    fetchHistory();
  }, []);

  // Обновляем заголовок при изменении выделения
  useEffect(() => {
    if (isSelectionMode) {
      navigation.setOptions({
        title: `Выбрано: ${selectedIds.length}`,
        headerRight: () => (
          <TouchableOpacity onPress={handleBulkDelete} style={{ marginRight: 16 }}>
            <Icon name="trash-outline" size={22} color="#e53935" />
          </TouchableOpacity>
        ),
        headerLeft: () => (
          <TouchableOpacity onPress={() => setSelectedIds([])} style={{ marginLeft: 16 }}>
            <Icon name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        ),
      });
    } else {
      navigation.setOptions({
        title: `${formatName(u1)} & ${formatName(u2)}`,
        headerRight: null,
        headerLeft: null,
      });
    }
  }, [selectedIds, isSelectionMode]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/admin/chats/${u1.id}/${u2.id}`);
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
      Alert.alert('Ошибка', 'Не удалось загрузить историю переписки');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }, []);

  const handleLongPress = useCallback((id) => {
    setSelectedIds([id]);
  }, []);

  const handleBulkDelete = () => {
    Alert.alert(
      'Удаление',
      `Удалить ${selectedIds.length} сообщений навсегда?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/admin/chats/messages', { data: selectedIds });
              setMessages(prev => prev.filter(m => !selectedIds.includes(m.id)));
              setSelectedIds([]);
            } catch (error) {
              console.error('Failed to bulk delete messages:', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщения');
            }
          }
        }
      ]
    );
  };

  const deleteMessage = (messageId) => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить это сообщение навсегда?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/admin/chats/messages/${messageId}`);
              setMessages(prev => prev.filter(m => m.id !== messageId));
            } catch (error) {
              console.error('Failed to delete message:', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщение');
            }
          }
        }
      ]
    );
  };

  const handleDownloadMedia = async () => {
    if (!fullScreenMedia) return;

    if (Platform.OS === 'web') {
      try {
        const uri = fullScreenMedia.uri;
        const fileName = uri.split('/').pop() || 'file';
        const link = document.createElement('a');
        link.href = uri;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (e) {
        window.open(fullScreenMedia.uri, '_blank');
      }
      return;
    }

    try {
      const uri = fullScreenMedia.uri;
      const fileName = uri.split('/').pop() || 'file';
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
          const mimeType = fullScreenMedia.type === 'video' ? 'video/mp4' : 'image/jpeg';
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

  const isDeleted = (item) => item.deleted_by_sender && item.deleted_by_receiver;
  const isPartiallyDeleted = (item) => item.deleted_by_sender || item.deleted_by_receiver;

  const renderItem = ({ item }) => {
    const isU1 = item.sender_id === u1.id;
    const sender = isU1 ? u1 : u2;
    const isSelected = selectedIds.includes(item.id);
    const deleted = isDeleted(item);
    const partiallyDeleted = !deleted && isPartiallyDeleted(item);

    const handleFullScreen = (uri, type) => {
      if (type === 'video') {
        setPlaybackAudioMode();
      }
      setFullScreenMedia({ uri, type });
    };

    const handlePress = () => {
      if (isSelectionMode) {
        toggleSelect(item.id);
      }
    };

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        onLongPress={() => handleLongPress(item.id)}
        delayLongPress={300}
      >
        <View style={[
          styles.messageWrapper,
          isU1 ? styles.u1Wrapper : styles.u2Wrapper,
          isSelected && { backgroundColor: colors.primary + '33' },
        ]}>
          {isSelected && (
            <View style={[styles.checkmark, { backgroundColor: colors.primary }]}>
              <Icon name="checkmark" size={12} color="#fff" />
            </View>
          )}
          {!isU1 && (
            <Image
              source={{ uri: getFullUrl(sender.avatar_url) || 'https://via.placeholder.com/150' }}
              style={styles.smallAvatar}
            />
          )}
          <View style={[
            styles.messageBubble,
            { backgroundColor: isU1 ? colors.primary : colors.surface, borderColor: colors.border },
            !isU1 && styles.u2Bubble,
            deleted && styles.deletedBubble,
            partiallyDeleted && styles.partiallyDeletedBubble,
          ]}>
            {/* Метка удалённого сообщения */}
            {deleted && (
              <View style={styles.deletedBadge}>
                <Icon name="trash-outline" size={12} color={colors.textSecondary} />
                <Text style={[styles.deletedText, { color: colors.textSecondary }]}>Сообщение удалено</Text>
              </View>
            )}
            {partiallyDeleted && (
              <View style={styles.deletedBadge}>
                <Icon name="eye-off-outline" size={12} color={colors.textSecondary} />
                <Text style={[styles.deletedText, { color: colors.textSecondary }]}>
                  {item.deleted_by_sender ? 'Удалено отправителем' : 'Удалено получателем'}
                </Text>
              </View>
            )}

            {/* Медиа-файлы (показываем даже для удалённых, если файл ещё есть) */}
            {!deleted && (item.message_type === 'image' || item.message_type === 'video') && item.file_path ? (
              <CachedMedia
                item={item}
                style={{ width: 200, height: 150, borderRadius: 10, overflow: 'hidden' }}
                onFullScreen={handleFullScreen}
                shouldPlay={false}
                isMuted={true}
              />
            ) : null}
            {!deleted && item.message_type === 'voice' && item.file_path ? (
              <VoiceMessage item={item} currentUserId={u1.id} />
            ) : null}
            {!deleted && item.message_type === 'file' && item.file_path ? (
              <FileMessage item={item} currentUserId={u1.id} />
            ) : null}

            {/* Текст сообщения */}
            {!deleted && item.message ? (
              <Text style={[styles.messageText, { color: isU1 ? '#fff' : colors.text, marginTop: 4 }]}>
                {item.message}
              </Text>
            ) : null}

            <View style={styles.messageFooter}>
              <Text style={[styles.messageTime, { color: isU1 ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
              {!isSelectionMode && (
                <TouchableOpacity onPress={() => deleteMessage(item.id)} style={styles.deleteBtn}>
                  <Icon name="trash-outline" size={14} color={isU1 ? 'rgba(255,255,255,0.7)' : colors.error} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          {isU1 && (
            <Image
              source={{ uri: getFullUrl(sender.avatar_url) || 'https://via.placeholder.com/150' }}
              style={styles.smallAvatar}
            />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Панель выделения */}
      {isSelectionMode && (
        <View style={[styles.selectionBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setSelectedIds([])} style={styles.selectionBarBtn}>
            <Icon name="close" size={20} color={colors.text} />
            <Text style={[styles.selectionBarText, { color: colors.text }]}>Отмена</Text>
          </TouchableOpacity>
          <Text style={[styles.selectionCount, { color: colors.text }]}>
            Выбрано: {selectedIds.length}
          </Text>
          <TouchableOpacity onPress={handleBulkDelete} style={styles.selectionBarBtn}>
            <Icon name="trash-outline" size={20} color="#e53935" />
            <Text style={[styles.selectionBarText, { color: '#e53935' }]}>Удалить</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        extraData={[selectedIds, isSelectionMode]}
      />

      {/* Full-screen media viewer */}
      <Modal
        visible={!!fullScreenMedia}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFullScreenMedia(null)}
      >
        <View style={styles.fullScreenContainer}>
          <Pressable style={styles.fullScreenBackdrop} onPress={() => setFullScreenMedia(null)} />
          {fullScreenMedia && (
            <View style={[styles.fullScreenContent, { width: screen.width, height: screen.height }]}>
              {fullScreenMedia.type === 'video' ? (
                <VideoPlayer
                  uri={fullScreenMedia.uri}
                  style={styles.fullScreenVideo}
                  resizeMode="contain"
                  useNativeControls
                  shouldPlay
                />
              ) : (
                <Image
                  source={{ uri: fullScreenMedia.uri }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                />
              )}
              <TouchableOpacity style={styles.fullScreenClose} onPress={() => setFullScreenMedia(null)}>
                <Icon name="close" size={28} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.fullScreenDownload} onPress={handleDownloadMedia}>
                <Icon name="download" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 10, paddingBottom: 20 },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  selectionBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectionBarText: {
    fontSize: 14,
    marginLeft: 4,
  },
  selectionCount: {
    fontSize: 15,
    fontWeight: '600',
  },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-end',
    maxWidth: '85%',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  u1Wrapper: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end'
  },
  u2Wrapper: {
    alignSelf: 'flex-start'
  },
  checkmark: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
    marginBottom: 4,
  },
  smallAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginHorizontal: 5,
    marginBottom: 2
  },
  messageBubble: {
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 60,
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 1),
  },
  u2Bubble: {
    borderBottomLeftRadius: 2
  },
  deletedBubble: {
    opacity: 0.6,
  },
  partiallyDeletedBubble: {
    opacity: 0.75,
  },
  deletedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  deletedText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: 4,
  },
  messageText: {
    fontSize: 15
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4
  },
  messageTime: {
    fontSize: 10,
    marginRight: 8
  },
  deleteBtn: {
    padding: 2
  },
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  fullScreenBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.95)'
  },
  fullScreenContent: {
    justifyContent: 'center',
    alignItems: 'center'
  },
  fullScreenImage: {
    width: '100%',
    height: '100%'
  },
  fullScreenVideo: {
    width: '100%',
    height: '100%'
  },
  fullScreenClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    padding: 8
  },
  fullScreenDownload: {
    position: 'absolute',
    top: 40,
    left: 20,
    padding: 8
  }
});
