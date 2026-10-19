import React, { useState, useCallback, useRef } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Image, Platform, ScrollView } from 'react-native';
import notifee from '@notifee/react-native';
import FadeInImage from '../components/FadeInImage';
import FadeInView from '../components/FadeInView';
import { newsApi, announcementsApi } from '../api';
import { getFullUrl, stripHtml } from '../utils/formatters';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { NewsSkeleton } from '../components/SkeletonLoader';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useNotifications } from '../context/NotificationContext';
import { isProductionRole, getRoleScope } from '../constants/roles';

export default function FeedScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser, loadingUser } = useNotifications();
  const [feedItems, setFeedItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const isLoadedRef = useRef(false);
  const loadingInProgressRef = useRef(false);

  // Может ли текущий пользователь публиковать объявления (есть подчинённые) -
  // совпадает с app/api/routers/announcements.py: рабочий (scope="self") не может публиковать.
  const canCreateAnnouncement = currentUser && isProductionRole(currentUser.role) && getRoleScope(currentUser.role) !== 'self';

  const loadData = useCallback(async (isRefresh = false) => {
    console.log('[FeedScreen] loadData starting... loadingUser:', loadingUser, 'currentUser:', !!currentUser);
    // Ждем, пока NotificationContext загрузит пользователя, чтобы не дублировать запросы
    if (loadingUser) {
      return;
    }

    if (loadingInProgressRef.current && !isRefresh) {
      console.log('[FeedScreen] loadData already in progress, skipping');
      return;
    }

    loadingInProgressRef.current = true;

    try {
      const isProduction = currentUser && isProductionRole(currentUser.role);
      const [newsRes, announcementsRes] = await Promise.all([
        newsApi.getNews().catch(() => ({ data: [] })),
        isProduction ? announcementsApi.getAnnouncements().catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);

      if (currentUser) {
        setUser(currentUser);
      } else {
        setUser(null);
      }

      // Объединяем новости и объявления в единую ленту, отсортированную по дате.
      const newsItems = (newsRes.data || []).map(item => ({ ...item, __feedType: 'news' }));
      const announcementItems = (announcementsRes.data || []).map(item => ({ ...item, __feedType: 'announcement' }));
      const merged = [...newsItems, ...announcementItems].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );

      setFeedItems(merged);
      isLoadedRef.current = true;
    } catch (err) {
      console.log('[FeedScreen] loadData error:', err);
    } finally {
      setLoading(false);
      loadingInProgressRef.current = false;
    }
  }, [currentUser, loadingUser]);

  useFocusEffect(
    useCallback(() => {
      console.log('[FeedScreen] Focused, loading data...');
      if (!isLoadedRef.current) {
        loadData();
      }
      
      if (Platform.OS !== 'web') {
        notifee.cancelNotification('new_posts').catch(() => {});
      }

      return () => {
        isLoadedRef.current = false;
      };
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const canManageNews = user?.role === 'admin' || user?.role === 'owner';

  const handleAnnouncementPress = (item) => {
    if (!item.is_read) {
      announcementsApi.markAsRead(item.id).catch(() => {});
      setFeedItems(prev => prev.map(i => (i.__feedType === 'announcement' && i.id === item.id ? { ...i, is_read: true } : i)));
    }
  };

  const renderAnnouncementItem = ({ item }) => {
    const authorName = item.author
      ? `${item.author.first_name || ''} ${item.author.last_name || ''}`.trim() || 'Пользователь'
      : 'Пользователь';
    const groupLabel = item.section_name || item.workshop_name || null;

    return (
      <TouchableOpacity
        style={[styles.announcementCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}
        onPress={() => handleAnnouncementPress(item)}
        activeOpacity={0.8}
      >
        <View style={styles.announcementHeader}>
          <View style={[styles.announcementBadge, { backgroundColor: colors.primary }]}>
            <Icon name="megaphone-outline" size={14} color="#fff" />
            <Text style={styles.announcementBadgeText}>Объявление</Text>
          </View>
          {!item.is_read && <View style={[styles.unreadDot, { backgroundColor: colors.error }]} />}
        </View>
        <Text style={[styles.newsTitle, { color: colors.text, marginTop: 8 }]}>{item.title}</Text>
        <Text style={[styles.newsContentText, { color: colors.textSecondary, marginTop: 4 }]} numberOfLines={4}>
          {item.content}
        </Text>
        <View style={styles.newsFooter}>
          <Text style={[styles.newsDate, { color: colors.textSecondary }]}>
            {authorName} · {new Date(item.created_at).toLocaleDateString()}
            {groupLabel ? ` · ${groupLabel}` : ''}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderNewsItem = ({ item }) => {
    const newsThumbnail = item.images && item.images.length > 0 
      ? item.images[0].thumbnail_url 
      : item.image_url;

    return (
      <TouchableOpacity 
        style={[styles.newsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('NewsDetail', { newsId: item.id, newsItem: item })}
      >
        <View style={styles.newsAuthorHeader}>
          <TouchableOpacity 
            style={styles.authorInfo}
            onPress={() => navigation.navigate('UserProfile', { userId: item.author_id })}
          >
            <Image 
              source={{ uri: getFullUrl(item.author_avatar_url) || 'https://via.placeholder.com/40' }} 
              style={styles.authorAvatar} 
            />
            <View>
              <Text style={[styles.authorName, { color: colors.text }]}>
                {item.author_first_name ? `${item.author_first_name} ${item.author_last_name || ''}` : 'Пользователь'}
              </Text>
              <Text style={[styles.newsDate, { color: colors.textSecondary }]}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
          </TouchableOpacity>
          {canManageNews && (
            <TouchableOpacity onPress={(e) => {
              e.stopPropagation();
              navigation.navigate('EditNews', { newsItem: item });
            }}>
              <Icon name="create-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.newsContentRow}>
          {newsThumbnail && (
            <FadeInImage 
              source={{ uri: getFullUrl(newsThumbnail) }} 
              style={styles.newsThumbnail} 
            />
          )}
          <View style={styles.newsTextContainer}>
            <Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            <Text style={[styles.newsContentText, { color: colors.textSecondary }]} numberOfLines={2}>
              {stripHtml(item.content)}
            </Text>
          </View>
        </View>

        <View style={styles.newsFooter}>
          <View style={styles.reactionsRow}>
            <View style={styles.reactionItem}>
              <Icon name={item.my_reaction === 1 ? "heart" : "heart-outline"} size={16} color={item.my_reaction === 1 ? colors.error : colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.likes_count || 0}</Text>
            </View>
            <View style={[styles.reactionItem, { marginLeft: 15 }]}>
              <Icon name="chatbubble-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.comments_count || 0}</Text>
            </View>
          </View>
          <Icon name="chevron-forward" size={16} color={colors.border} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderFeedItem = (props) => (
    props.item.__feedType === 'announcement' ? renderAnnouncementItem(props) : renderNewsItem(props)
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {loading && !refreshing ? (
        <ScrollView style={styles.listContent}>
          <NewsSkeleton />
          <NewsSkeleton />
        </ScrollView>
      ) : (
        <FadeInView visible={!loading} duration={250}>
          <FlatList
          data={feedItems}
          keyExtractor={(item) => `${item.__feedType}_${item.id}`}
          renderItem={renderFeedItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon name="newspaper-outline" size={64} color={colors.border} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Пока новостей нет
              </Text>
            </View>
          }
        />
        </FadeInView>
      )}

      {canManageNews && (
        <TouchableOpacity 
          style={[styles.fab, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('EditNews')}
        >
          <Icon name="add-outline" size={30} color="#fff" />
        </TouchableOpacity>
      )}

      {canCreateAnnouncement && (
        <TouchableOpacity
          style={[styles.fab, styles.fabSecondary, { backgroundColor: colors.surface, borderColor: colors.primary }]}
          onPress={() => navigation.navigate('CreateAnnouncement')}
        >
          <Icon name="megaphone-outline" size={26} color={colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 10 },
  newsCard: { borderRadius: 12, marginBottom: 16, overflow: 'hidden', borderWidth: 1, ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 4) },
  newsAuthorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)' },
  authorInfo: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  authorName: { fontSize: 14, fontWeight: 'bold' },
  newsContentRow: { flexDirection: 'row', padding: 12 },
  newsThumbnail: { width: 80, height: 80, borderRadius: 8 },
  newsTextContainer: { flex: 1, paddingLeft: 12, justifyContent: 'center' },
  newsTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  newsContentText: { fontSize: 13, lineHeight: 18 },
  newsFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingTop: 0 },
  newsDate: { fontSize: 11 },
  reactionsRow: { flexDirection: 'row', alignItems: 'center' },
  reactionItem: { flexDirection: 'row', alignItems: 'center' },
  reactionCount: { fontSize: 12, marginLeft: 4 },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', ...getShadow('#000', { width: 0, height: 4 }, 0.3, 4.65, 8) },
  fabSecondary: { bottom: 90, width: 52, height: 52, borderRadius: 26, borderWidth: 1 },
  announcementCard: { borderRadius: 12, marginBottom: 16, padding: 14, borderWidth: 1.5, ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 4) },
  announcementHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  announcementBadge: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  announcementBadgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold', marginLeft: 4 },
  unreadDot: { width: 10, height: 10, borderRadius: 5 },
  emptyContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 100,
    paddingHorizontal: 40
  },
  emptyText: { marginTop: 16, fontSize: 16, textAlign: 'center', fontWeight: '500' },
});
