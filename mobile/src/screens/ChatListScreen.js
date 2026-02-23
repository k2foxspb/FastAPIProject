import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { useNotifications } from '../context/NotificationContext';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';
import { formatName } from '../utils/formatters';

export default function ChatListScreen({ navigation }) {
  const { dialogs, fetchDialogs, isConnected } = useNotifications();
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  useFocusEffect(
    useCallback(() => {
      // If not connected, we might still want to fetch once via API as fallback
      // but primarily we rely on get_dialogs via WS in connectChatWs
      if (!isConnected) {
        fetchDialogs();
      }
    }, [isConnected, fetchDialogs])
  );

  const getAvatarUrl = (url) => {
    if (!url) return 'https://via.placeholder.com/150';
    if (url.startsWith('http')) return url;
    return `${API_BASE_URL}${url}`;
  };

  console.log('[ChatListScreen] Rendering, dialogs count:', dialogs.length);
  if (dialogs.length > 0) {
    console.log('[ChatListScreen] First dialog:', JSON.stringify(dialogs[0]));
  } else {
    console.log('[ChatListScreen] Dialogs array is EMPTY in render');
  }

  const formatTime = (timeStr) => {
    try {
      if (!timeStr) return '';
      const date = new Date(timeStr);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  const renderItem = ({ item }) => {
    console.log('[ChatListScreen] renderItem called for user:', item.user_id);
    return (
      <TouchableOpacity 
        style={[styles.dialogItem, { 
          borderBottomColor: '#FF0000', // Ярко-красная граница для теста
          borderBottomWidth: 2,
          backgroundColor: '#FFFFFF', // Всегда белый фон для теста
          minHeight: 80,
          width: '100%',
          opacity: 1,
          zIndex: 999
        }]}
        onPress={() => navigation.navigate('Chat', { userId: item.user_id, userName: formatName(item) })}
      >
        <Image 
          source={{ uri: getAvatarUrl(item.avatar_url) }} 
          style={[styles.avatar, { borderWidth: 1, borderColor: '#000' }]} 
        />
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.email, { color: '#000000' }]} numberOfLines={1}>{formatName(item) || 'Имя не загружено'}</Text>
            <Text style={[styles.time, { color: '#FF0000' }]}>
              {formatTime(item.last_message_time)}
            </Text>
          </View>
          <View style={styles.footer}>
            <Text style={[styles.lastMessage, { color: '#333333' }]} numberOfLines={1}>{item.last_message || '[Нет сообщения]'}</Text>
            {item.unread_count > 0 && (
              <View style={[styles.badge, { backgroundColor: '#FF0000' }]}>
                <Text style={styles.badgeText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (dialogs.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>У вас пока нет активных чатов.</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Используйте поиск пользователей, чтобы начать общение.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, flex: 1, minHeight: 200 }]}>
      <View style={{ padding: 10, backgroundColor: '#FFFF00' }}>
        <Text style={{ color: '#000' }}>TEST: dialogs.length = {dialogs.length}</Text>
      </View>
      <FlatList
        data={dialogs}
        keyExtractor={(item) => item.user_id.toString()}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { flexGrow: 1 }]}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingVertical: 10, minHeight: 100 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  hint: { color: 'gray', marginTop: 10, textAlign: 'center' },
  dialogItem: { 
    flexDirection: 'row', 
    padding: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: '#f0f0f0',
    alignItems: 'center' 
  },
  avatar: { width: 50, height: 50, borderRadius: 25, marginRight: 15 },
  content: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  email: { fontWeight: 'bold', fontSize: 16, flex: 1, marginRight: 10 },
  time: { color: 'gray', fontSize: 12 },
  lastMessage: { color: 'gray', flex: 1, marginRight: 10 },
  badge: { 
    backgroundColor: '#007AFF', 
    borderRadius: 10, 
    minWidth: 20, 
    height: 20, 
    justifyContent: 'center', 
    alignItems: 'center',
    paddingHorizontal: 5
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' }
});
