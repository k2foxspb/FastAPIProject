import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { notificationsApi } from '../api';
import { useNotifications } from '../context/NotificationContext';

// Экран со списком уведомлений (GET /notifications) - открывается нажатием на
// колокольчик на экране "Лента". Нажатие на пункт помечает его прочитанным и
// пытается перейти к связанному объекту (best-effort - если тип объекта не
// распознан, просто закрывает модалку).
export default function NotificationsScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { refreshUnreadCount } = useNotifications();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.getNotifications(0, 50);
      setItems(res.data || []);
    } catch (err) {
      console.log('[NotificationsScreen] Failed to load notifications:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchNotifications();
    }, [fetchNotifications])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
      refreshUnreadCount?.();
    } catch (err) {
      console.log('[NotificationsScreen] Failed to mark all read:', err.message);
    }
  };

  const handlePressItem = async (item) => {
    if (!item.is_read) {
      setItems(prev => prev.map(n => n.id === item.id ? { ...n, is_read: true } : n));
      try {
        await notificationsApi.markRead(item.id);
        refreshUnreadCount?.();
      } catch (err) {
        console.log('[NotificationsScreen] Failed to mark read:', err.message);
      }
    }

    // Best-effort навигация к связанному объекту по data.object_type/object_id.
    const objectType = item.data?.object_type;
    const objectId = item.data?.object_id;
    if (objectType === 'post' || objectType === 'announcement') {
      navigation.goBack();
    } else if (objectType === 'user' && objectId) {
      navigation.navigate('UserProfile', { userId: objectId });
    } else if (objectType === 'friend_request') {
      navigation.navigate('Users');
    } else {
      // Тип объекта не распознан - просто закрываем модалку, уведомление уже помечено прочитанным.
      navigation.goBack();
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.item,
        { backgroundColor: item.is_read ? colors.background : colors.surface, borderColor: colors.border },
      ]}
      onPress={() => handlePressItem(item)}
    >
      {!item.is_read && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.text }]}>{item.title || 'Уведомление'}</Text>
        {!!item.body && (
          <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={3}>{item.body}</Text>
        )}
        {!!item.created_at && (
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleMarkAllRead}>
          <Text style={[styles.markAllText, { color: colors.primary }]}>Прочитать все</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="notifications-off-outline" size={56} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Уведомлений пока нет</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 12,
    borderBottomWidth: 1,
  },
  markAllText: { fontSize: 14, fontWeight: '600' },
  list: { padding: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, marginRight: 10 },
  title: { fontSize: 14, fontWeight: 'bold' },
  body: { fontSize: 13, marginTop: 4 },
  date: { fontSize: 11, marginTop: 6 },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyText: { marginTop: 10, fontSize: 14 },
});
