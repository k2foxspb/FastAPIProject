import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Image, ActivityIndicator, TouchableOpacity, Alert, Modal, Pressable, Dimensions, Share, Platform } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import api from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { formatName } from '../utils/formatters';
import CachedMedia from '../components/CachedMedia';
import VoiceMessage from '../components/VoiceMessage';
import FileMessage from '../components/FileMessage';
import { Video, ResizeMode } from 'expo-av';
import { documentDirectory, getInfoAsync, downloadAsync, readAsStringAsync, writeAsStringAsync, EncodingType, StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export default function AdminChatDetailScreen({ route, navigation }) {
  const { u1, u2 } = route.params;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const flatListRef = useRef();
  const [fullScreenMedia, setFullScreenMedia] = useState(null); // { uri, type }
  const screen = Dimensions.get('window');

  useEffect(() => {
    navigation.setOptions({ title: `${formatName(u1)} & ${formatName(u2)}` });
    fetchHistory();
  }, []);

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
              setMessages(messages.filter(m => m.id !== messageId));
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

  const renderItem = ({ item }) => {
    const isU1 = item.sender_id === u1.id;
    const sender = isU1 ? u1 : u2;

    const handleFullScreen = (uri, type) => {
      setFullScreenMedia({ uri, type });
    };

    return (
      <View style={[
        styles.messageWrapper, 
        isU1 ? styles.u1Wrapper : styles.u2Wrapper
      ]}>
        {!isU1 && (
          <Image 
            source={{ uri: getFullUrl(sender.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.smallAvatar} 
          />
        )}
        <View style={[
          styles.messageBubble,
          { backgroundColor: isU1 ? colors.primary : colors.surface, borderColor: colors.border },
          !isU1 && styles.u2Bubble
        ]}>
          {/* Медиа-файлы */}
          {(item.message_type === 'image' || item.message_type === 'video') && item.file_path ? (
            <CachedMedia 
              item={item} 
              style={{ width: 200, height: 150, borderRadius: 10, overflow: 'hidden' }} 
              onFullScreen={handleFullScreen}
              shouldPlay={false}
              isMuted={true}
            />
          ) : null}
          {item.message_type === 'voice' && item.file_path ? (
            <VoiceMessage item={item} currentUserId={u1.id} />
          ) : null}
          {item.message_type === 'file' && item.file_path ? (
            <FileMessage item={item} currentUserId={u1.id} />
          ) : null}

          {/* Текст сообщения */}
          {item.message ? (
            <Text style={[styles.messageText, { color: isU1 ? '#fff' : colors.text, marginTop: 4 }]}>
              {item.message}
            </Text>
          ) : null}

          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, { color: isU1 ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <TouchableOpacity onPress={() => deleteMessage(item.id)} style={styles.deleteBtn}>
              <Icon name="trash-outline" size={14} color={isU1 ? 'rgba(255,255,255,0.7)' : colors.error} />
            </TouchableOpacity>
          </View>
        </View>
        {isU1 && (
          <Image 
            source={{ uri: getFullUrl(sender.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.smallAvatar} 
          />
        )}
      </View>
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
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
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
                <Video
                  source={{ uri: fullScreenMedia.uri }}
                  style={styles.fullScreenVideo}
                  resizeMode={ResizeMode.CONTAIN}
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
  list: { padding: 10 },
  messageWrapper: {
    flexDirection: 'row',
    marginBottom: 10,
    alignItems: 'flex-end',
    maxWidth: '85%'
  },
  u1Wrapper: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end'
  },
  u2Wrapper: {
    alignSelf: 'flex-start'
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  u2Bubble: {
    borderBottomLeftRadius: 2
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
