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

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={[styles.dialogItem, { borderBottomColor: colors.border }]}
      onPress={() => navigation.navigate('Chat', { userId: item.user_id, userName: formatName(item) })}
    >
      <Image 
        source={{ uri: getAvatarUrl(item.avatar_url) }} 
        style={styles.avatar} 
      />
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.email, { color: colors.text }]} numberOfLines={1}>{formatName(item)}</Text>
          <Text style={[styles.time, { color: colors.textSecondary }]}>
            {new Date(item.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        <View style={styles.footer}>
          <Text style={[styles.lastMessage, { color: colors.textSecondary }]} numberOfLines={1}>{item.last_message}</Text>
          {item.unread_count > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  if (dialogs.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>У вас пока нет активных чатов.</Text>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Используйте поиск пользователей, чтобы начать общение.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={dialogs}
        keyExtractor={(item) => item.user_id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { paddingVertical: 10 },
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
