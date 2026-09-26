import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, RefreshControl } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNotifications } from '../context/NotificationContext';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { API_BASE_URL } from '../constants';
import { groupChatApi } from '../api';
import { formatName, formatMessageTime, parseISODate, getAvatarUrl } from '../utils/formatters';

export default function ChatListScreen({ navigation }) {
  const { dialogs, fetchDialogs, isConnected } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const [groups, setGroups] = useState([]);
  // Панель вкладок теперь всегда position:'absolute' (см. TabNavigator.js) и не резервирует место
  // во flex-раскладке сама — поэтому список диалогов сам добавляет отступ под неё, чтобы последний
  // элемент списка не оказался под панелью.
  const tabBarHeight = useBottomTabBarHeight();

  const fetchGroups = useCallback(async () => {
    try {
      const res = await groupChatApi.getMyGroups();
      setGroups(res.data || []);
    } catch (e) {
      console.error('[ChatListScreen] Failed to fetch groups:', e);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchDialogs(), fetchGroups()]);
    setRefreshing(false);
  }, [fetchDialogs, fetchGroups]);
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  useFocusEffect(
    useCallback(() => {
      // Всегда обновляем список диалогов и групп при фокусе на экран,
      // чтобы гарантировать актуальность статусов и последних сообщений
      fetchDialogs();
      fetchGroups();
    }, [fetchDialogs, fetchGroups])
  );


  const formatTime = (timeStr) => {
    return formatMessageTime(timeStr);
  };

  const renderItem = ({ item }) => {
    const isGroup = item.isGroup;
    return (
      <TouchableOpacity 
        style={[styles.dialogItem, { 
          borderBottomColor: colors.border,
          backgroundColor: colors.surface, 
          minHeight: 80,
          width: '100%',
        }]}
        onPress={() => (
          isGroup
            ? navigation.navigate('GroupChat', { groupId: item.id, groupName: item.name })
            : navigation.navigate('Chat', { userId: item.user_id, userName: formatName(item) })
        )}
      >
        {isGroup ? (
          <View style={[styles.avatar, styles.groupAvatar, { backgroundColor: colors.primary }]}>
            <Icon name="people" size={26} color="#fff" />
          </View>
        ) : (
          <Image 
            source={{ uri: getAvatarUrl(item.avatar_url) }} 
            style={styles.avatar} 
          />
        )}
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.email, { color: colors.text }]} numberOfLines={1}>
              {isGroup ? item.name : (formatName(item) || 'Имя не загружено')}
            </Text>
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {formatTime(item.last_message_time)}
            </Text>
          </View>
          <View style={styles.footer}>
            <Text style={[styles.lastMessage, { color: colors.textSecondary }]} numberOfLines={1}>{item.last_message || '[Нет сообщения]'}</Text>
            {item.unread_count > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={styles.badgeText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const combinedData = [
    ...groups.map(g => ({ ...g, isGroup: true })),
    ...dialogs,
  ].sort((a, b) => {
    const aTime = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
    const bTime = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background, flex: 1 }]}>
      <TouchableOpacity
        style={[styles.createGroupButton, { borderBottomColor: colors.border }]}
        onPress={() => navigation.navigate('CreateGroup')}
      >
        <View style={[styles.createGroupIcon, { backgroundColor: colors.primary }]}>
          <Icon name="people" size={20} color="#fff" />
        </View>
        <Text style={[styles.createGroupText, { color: colors.primary }]}>Новая группа</Text>
      </TouchableOpacity>

      {combinedData.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: colors.text }}>У вас пока нет активных чатов.</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>Используйте поиск пользователей, чтобы начать общение.</Text>
        </View>
      ) : (
        <FlatList
          data={combinedData}
          keyExtractor={(item) => (item.isGroup ? `group-${item.id}` : (item.user_id || Math.random())).toString()}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: 10 + tabBarHeight }]}
          style={{ flex: 1, width: '100%' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%' },
  list: { paddingVertical: 10, flexGrow: 1, width: '100%' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  hint: { color: 'gray', marginTop: 10, textAlign: 'center' },
  dialogItem: { 
    flexDirection: 'row', 
    padding: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: '#f0f0f0',
    alignItems: 'center',
    width: '100%'
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
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  groupAvatar: { justifyContent: 'center', alignItems: 'center' },
  createGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  createGroupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  createGroupText: { fontSize: 15, fontWeight: '600' },
});
