import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Image,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { announcementsApi } from '../api';
import { getFullUrl } from '../utils/formatters';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { getRoleLabel } from '../constants/roles';

const stripHtml = (html) => {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
};

export default function AnnouncementsScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();

  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'

  // Состояние аудита прочтения
  const [auditVisible, setAuditVisible] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditRecipients, setAuditRecipients] = useState([]);
  const [auditAnnouncementTitle, setAuditAnnouncementTitle] = useState('');

  const isManagerOrAdmin =
    currentUser &&
    ['owner', 'admin', 'shop_chief', 'section_chief', 'master', 'assistant_master'].includes(
      currentUser.role
    );

  const loadAnnouncements = useCallback(async () => {
    try {
      const res = await announcementsApi.getAnnouncements();
      setAnnouncements(res.data || []);
    } catch (err) {
      console.log('[AnnouncementsScreen] error loading:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAnnouncements();
    }, [loadAnnouncements])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAnnouncements();
    setRefreshing(false);
  };

  const handleCardPress = (item) => {
    navigation.navigate('AnnouncementDetail', { announcementId: item.id, announcementItem: item });

    if (!item.is_read) {
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === item.id ? { ...a, is_read: true } : a))
      );
    }
  };

  const openAudit = async (announcement) => {
    setAuditAnnouncementTitle(announcement.title);
    setAuditVisible(true);
    setAuditLoading(true);
    try {
      const res = await announcementsApi.getRecipients(announcement.id);
      setAuditRecipients(res.data || []);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить аудит доставки');
    } finally {
      setAuditLoading(false);
    }
  };

  const handleDelete = (announcementId) => {
    Alert.alert('Удаление объявления', 'Вы уверены, что хотите удалить это объявление?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await announcementsApi.deleteAnnouncement(announcementId);
            setAnnouncements((prev) => prev.filter((a) => a.id !== announcementId));
          } catch (err) {
            Alert.alert('Ошибка', 'Не удалось удалить объявление');
          }
        },
      },
    ]);
  };

  const unreadCount = announcements.filter((a) => !a.is_read).length;

  const filteredAnnouncements = announcements.filter((item) => {
    if (filter === 'unread') return !item.is_read;
    return true;
  });

  const getPriorityInfo = (priority) => {
    if (priority === 'urgent') return { label: 'Срочно', color: '#e53935' };
    if (priority === 'important') return { label: 'Важно', color: '#fb8c00' };
    return { label: 'Обычное', color: '#1e88e5' };
  };

  const renderItem = ({ item }) => {
    const authorName = item.author
      ? `${item.author.first_name || ''} ${item.author.last_name || ''}`.trim() || 'Пользователь'
      : 'Пользователь';
    const authorRole = item.author ? getRoleLabel(item.author.role) : '';
    const authorAvatar = item.author?.avatar_url;
    const isAuthorOrAdmin =
      currentUser && (currentUser.id === item.author_id || ['admin', 'owner'].includes(currentUser.role));
    const priorityInfo = getPriorityInfo(item.priority);

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => handleCardPress(item)}
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: item.is_read ? colors.border : priorityInfo.color,
            borderLeftWidth: item.is_read ? 1 : 4,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <Image
            source={{ uri: getFullUrl(authorAvatar) || 'https://via.placeholder.com/40' }}
            style={styles.avatar}
          />
          <View style={styles.headerText}>
            <View style={styles.nameRow}>
              <Text style={[styles.authorName, { color: colors.text }]}>{authorName}</Text>
              {!item.is_read && <View style={[styles.unreadDot, { backgroundColor: priorityInfo.color }]} />}
            </View>
            <Text style={[styles.authorRole, { color: colors.textSecondary }]}>
              {authorRole} {item.workshop_name ? `• ${item.workshop_name}` : ''}
            </Text>
          </View>
          <View style={[styles.priorityBadge, { backgroundColor: priorityInfo.color + '20' }]}>
            <Text style={[styles.priorityText, { color: priorityInfo.color }]}>{priorityInfo.label}</Text>
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>

        <Text
          style={[styles.content, { color: colors.textSecondary }]}
          numberOfLines={3}
        >
          {stripHtml(item.content)}
        </Text>

        <View style={styles.cardFooter}>
          <Text style={[styles.date, { color: colors.textSecondary }]}>
            {new Date(item.created_at).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>

          <View style={styles.footerActions}>
            <View style={styles.commentsBadge}>
              <Icon name="chatbubble-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.commentsBadgeText, { color: colors.textSecondary }]}>
                {item.comments_count || 0}
              </Text>
            </View>

            {isAuthorOrAdmin && (
              <>
                <TouchableOpacity
                  style={[styles.auditButton, { backgroundColor: colors.background }]}
                  onPress={() => openAudit(item)}
                >
                  <Icon name="stats-chart-outline" size={14} color={colors.primary} />
                  <Text style={[styles.auditButtonText, { color: colors.primary }]}>
                    Аудит ({item.recipients_count || 0})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.deleteButton]}
                  onPress={() => handleDelete(item.id)}
                >
                  <Icon name="trash-outline" size={16} color={colors.error || '#e53935'} />
                </TouchableOpacity>
              </>
            )}

            <Icon
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
              style={{ marginLeft: 8 }}
            />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top action bar: Filter tabs & Create button */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <View style={styles.filterTabs}>
          <TouchableOpacity
            style={[
              styles.filterTab,
              filter === 'all' && [styles.filterTabActive, { backgroundColor: colors.primary }],
            ]}
            onPress={() => setFilter('all')}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: filter === 'all' ? '#fff' : colors.textSecondary },
              ]}
            >
              Все
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterTab,
              filter === 'unread' && [styles.filterTabActive, { backgroundColor: colors.primary }],
            ]}
            onPress={() => setFilter('unread')}
          >
            <Text
              style={[
                styles.filterTabText,
                { color: filter === 'unread' ? '#fff' : colors.textSecondary },
              ]}
            >
              Непрочитанные
            </Text>
            {unreadCount > 0 && (
              <View
                style={[
                  styles.tabBadge,
                  { backgroundColor: filter === 'unread' ? '#fff' : colors.error || '#e53935' },
                ]}
              >
                <Text
                  style={[
                    styles.tabBadgeText,
                    { color: filter === 'unread' ? colors.primary : '#fff' },
                  ]}
                >
                  {unreadCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {isManagerOrAdmin && (
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('CreateAnnouncement')}
          >
            <Icon name="add" size={20} color="#fff" />
            <Text style={styles.createButtonText}>Создать</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredAnnouncements}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="notifications-off-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {filter === 'unread' ? 'Нет непрочитанных объявлений' : 'Объявлений пока нет'}
              </Text>
            </View>
          }
        />
      )}

      {/* Модальное окно аудита доставки и прочтения */}
      <Modal
        visible={auditVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setAuditVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Аудит прочтения</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {auditAnnouncementTitle}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setAuditVisible(false)}>
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {auditLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ margin: 30 }} />
            ) : (
              <ScrollView style={styles.auditList}>
                {auditRecipients.length === 0 ? (
                  <Text style={[styles.emptyAuditText, { color: colors.textSecondary }]}>
                    Список получателей пуст
                  </Text>
                ) : (
                  auditRecipients.map((rec) => {
                    const recipientName = rec.user
                      ? `${rec.user.first_name || ''} ${rec.user.last_name || ''}`.trim() || rec.user.email || 'Сотрудник'
                      : 'Сотрудник';
                    const recipientRole = rec.user ? getRoleLabel(rec.user.role) : '';

                    return (
                      <View
                        key={rec.id || rec.user_id}
                        style={[styles.auditRow, { borderBottomColor: colors.border }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.recipientName, { color: colors.text }]}>{recipientName}</Text>
                          <Text style={[styles.recipientRole, { color: colors.textSecondary }]}>
                            {recipientRole}
                          </Text>
                        </View>

                        <View style={styles.readStatusContainer}>
                          {rec.is_read ? (
                            <View style={styles.readBadge}>
                              <Icon name="checkmark-done" size={16} color="#4caf50" />
                              <Text style={styles.readText}>
                                Прочитано {rec.read_at ? new Date(rec.read_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </Text>
                            </View>
                          ) : (
                            <View style={styles.unreadStatusBadge}>
                              <Icon name="time-outline" size={14} color="#f57c00" />
                              <Text style={styles.unreadStatusText}>Не прочитано</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  filterTabs: { flexDirection: 'row', alignItems: 'center' },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterTabActive: {},
  filterTabText: { fontSize: 13, fontWeight: '600' },
  tabBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  tabBadgeText: { fontSize: 11, fontWeight: 'bold' },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  createButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold', marginLeft: 4 },
  listContent: { padding: 16 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, marginRight: 10 },
  headerText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  authorName: { fontSize: 14, fontWeight: '700' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 6 },
  authorRole: { fontSize: 12, marginTop: 1 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  priorityText: { fontSize: 11, fontWeight: 'bold' },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
  content: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  date: { fontSize: 12 },
  footerActions: { flexDirection: 'row', alignItems: 'center' },
  auditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginRight: 8,
  },
  auditButtonText: { fontSize: 11, fontWeight: '600', marginLeft: 4 },
  deleteButton: { padding: 4 },
  commentsBadge: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  commentsBadgeText: { fontSize: 12, marginLeft: 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyText: { marginTop: 12, fontSize: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17, fontWeight: 'bold' },
  modalSubtitle: { fontSize: 13, marginTop: 2 },
  auditList: { paddingHorizontal: 16 },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recipientName: { fontSize: 14, fontWeight: '600' },
  recipientRole: { fontSize: 12, marginTop: 2 },
  readStatusContainer: { alignItems: 'flex-end' },
  readBadge: { flexDirection: 'row', alignItems: 'center' },
  readText: { fontSize: 12, color: '#4caf50', marginLeft: 4, fontWeight: '500' },
  unreadStatusBadge: { flexDirection: 'row', alignItems: 'center' },
  unreadStatusText: { fontSize: 12, color: '#f57c00', marginLeft: 4 },
  emptyAuditText: { textAlign: 'center', marginVertical: 20, fontSize: 14 },
});
