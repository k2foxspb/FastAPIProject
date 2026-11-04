import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { notificationsApi, feedApi } from '../api';
import { useNotifications } from '../context/NotificationContext';
import { startAppUpdate, isAppUpdateRunning, cancelAppUpdate, getAppUpdateSize, formatAppSize } from '../utils/appUpdate';

// Экран со списком уведомлений (GET /notifications) - открывается нажатием на
// колокольчик на экране "Лента". Нажатие на пункт помечает его прочитанным и
// пытается перейти к связанному объекту (best-effort - если тип объекта не
// распознан, просто закрывает модалку).
export default function NotificationsScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { refreshUnreadCount, notifications } = useNotifications();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Уведомления в реальном времени: приходят через общий WS-канал (как сообщения в чате),
  // контекст складывает в notifications[0] все новые события, в т.ч. type==="notification".
  // Храним обработанные id, чтобы не вставлять одно и то же событие дважды при каждом ререндере.
  const processedWsIdsRef = useRef(new Set());

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.getNotifications(0, 50);
      // Backend возвращает NotificationListResponse: {items: [...], unread_count: N},
      // а не голый массив - берём именно items, иначе items становится объектом
      // и последующие setItems(prev => prev.map(...)) падают с "prev.map is not a function".
      setItems(res.data?.items || []);
    } catch (err) {
      console.log('[NotificationsScreen] Failed to load notifications:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchNotifications();
      // Синхронизируем бейдж колокольчика с сервером при каждом открытии экрана
      refreshUnreadCount?.();
    }, [fetchNotifications, refreshUnreadCount])
  );

  // Живое появление уведомлений в списке, пока экран открыт - аналогично тому,
  // как новое сообщение сразу появляется в чате, без необходимости закрывать
  // и заново открывать экран.
  useEffect(() => {
    const latest = notifications[0];
    if (!latest || latest.type !== 'notification' || !latest.data) return;

    const wsItem = latest.data;
    const dedupeKey = `${wsItem.id}-${wsItem.count}-${wsItem.title}-${wsItem.body}`;
    if (processedWsIdsRef.current.has(dedupeKey)) return;
    processedWsIdsRef.current.add(dedupeKey);

    setItems(prev => {
      const idx = prev.findIndex(n => n.id === wsItem.id);
      const merged = {
        id: wsItem.id,
        notif_type: wsItem.notif_type,
        title: wsItem.title,
        body: wsItem.body,
        count: wsItem.count,
        is_read: wsItem.is_read,
        data: wsItem.data,
        created_at: idx !== -1 ? prev[idx].created_at : new Date().toISOString(),
      };
      if (idx !== -1) {
        const next = [...prev];
        next.splice(idx, 1);
        return [merged, ...next];
      }
      return [merged, ...prev];
    });
  }, [notifications]);

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

    // Переход к связанному объекту по data.object_type/object_id. Реальные значения
    // object_type, которые присылает бэкенд (см. app/api/routers/users.py, feed.py,
    // news.py): "profile_post" (пост/объявление), "friendship" (заявка в друзья),
    // "news", "album", "photo".
    const objectType = item.data?.object_type;
    const objectId = item.data?.object_id;

    try {
      if (objectType === 'app_version') {
        if (isAppUpdateRunning()) {
          Alert.alert('Обновление загружается', 'Отменить скачивание обновления?', [
            { text: 'Нет', style: 'cancel' },
            { text: 'Отменить', style: 'destructive', onPress: () => cancelAppUpdate() },
          ]);
        } else {
          const size = formatAppSize(await getAppUpdateSize(item.data?.file_path));
          const versionText = item.data?.version ? ` ${item.data.version}` : '';
          const sizeText = size ? `\nРазмер: ${size}` : '';
          Alert.alert('Скачать приложение?', `Скачать и установить новую версию${versionText}?${sizeText}`, [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Скачать', onPress: () => startAppUpdate(item.data?.file_path, item.data?.version) },
          ]);
        }
      } else if (objectType === 'profile_post' && objectId) {
        const res = await feedApi.getPost(objectId);
        navigation.navigate('PostDetail', { item: res.data });
      } else if (objectType === 'news' && objectId) {
        navigation.navigate('NewsDetail', { newsId: objectId });
      } else if (objectType === 'album' && objectId) {
        navigation.navigate('AlbumDetail', { albumId: objectId });
      } else if (objectType === 'photo' && objectId) {
        navigation.navigate('PhotoDetail', { photoId: objectId });
      } else if (objectType === 'friendship') {
        // Заявки в друзья показываются на вкладке "Друзья" экрана "Пользователи".
        navigation.navigate('Users', { screen: 'UsersMain', params: { initialTab: 'friends' } });
      } else if (objectType === 'user' && objectId) {
        navigation.navigate('UserProfile', { userId: objectId });
      } else {
        // Тип объекта не распознан - просто закрываем модалку, уведомление уже помечено прочитанным.
        navigation.goBack();
      }
    } catch (err) {
      console.log('[NotificationsScreen] Failed to open related object:', err.message);
      Alert.alert('Ошибка', 'Не удалось открыть связанный объект');
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.item,
        { backgroundColor: item.is_read ? colors.background : 'transparent', borderColor: colors.border },
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
