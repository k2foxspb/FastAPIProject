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
  const [newsList, setNewsList] = useState([]);
  const [unreadAnnouncementsCount, setUnreadAnnouncementsCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const isLoadedRef = useRef(false);
  const loadingInProgressRef = useRef(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (loadingUser) {
      return;
    }

    if (loadingInProgressRef.current && !isRefresh) {
      return;
    }

    loadingInProgressRef.current = true;

    try {
      const [newsRes, announcementsRes] = await Promise.all([
        newsApi.getNews().catch(() => ({ data: [] })),
        announcementsApi.getAnnouncements().catch(() => ({ data: [] })),
      ]);

      setNewsList(newsRes.data || []);

      const unreadCount = (announcementsRes.data || []).filter(a => !a.is_read).length;
      setUnreadAnnouncementsCount(unreadCount);

      isLoadedRef.current = true;
    } catch (err) {
      console.log('[FeedScreen] loadData error:', err);
    } finally {
      setLoading(false);
      loadingInProgressRef.current = false;
    }
  }, [loadingUser]);

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

  const isAdminOrOwner = currentUser?.role === 'admin' || currentUser?.role === 'owner';

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
          {isAdminOrOwner && (
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Action Header: Announcements link, Propose News button, Moderation (if admin) */}
      <View style={[styles.actionHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.announcementsButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => navigation.navigate('Announcements')}
        >
          <Icon name="megaphone-outline" size={18} color={colors.primary} />
          <Text style={[styles.announcementsButtonText, { color: colors.text }]}>Объявления</Text>
          {unreadAnnouncementsCount > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.error || '#e53935' }]}>
              <Text style={styles.badgeText}>{unreadAnnouncementsCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerRightActions}>
          {isAdminOrOwner && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => navigation.navigate('AdminModeration')}
            >
              <Icon name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.primary }]}>Модерация</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.proposeBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('EditNews')}
          >
            <Icon name="add" size={16} color="#fff" />
            <Text style={styles.proposeBtnText}>Предложить новость</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && !refreshing ? (
        <ScrollView style={styles.listContent}>
          <NewsSkeleton />
          <NewsSkeleton />
        </ScrollView>
      ) : (
        <FadeInView visible={!loading} duration={250}>
          <FlatList
            data={newsList}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderNewsItem}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  actionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  announcementsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  announcementsButtonText: { fontSize: 13, fontWeight: '600', marginLeft: 6 },
  badge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  headerRightActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 8,
  },
  actionBtnText: { fontSize: 12, fontWeight: '600', marginLeft: 4 },
  proposeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  proposeBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
  listContent: { padding: 12 },
  newsCard: { borderRadius: 12, marginBottom: 14, overflow: 'hidden', borderWidth: 1, ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 4) },
  newsAuthorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)' },
  authorInfo: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  authorName: { fontSize: 14, fontWeight: 'bold' },
  newsContentRow: { flexDirection: 'row', padding: 12 },
  newsThumbnail: { width: 80, height: 80, borderRadius: 8 },
  newsTextContainer: { flex: 1, paddingLeft: 12, justifyContent: 'center' },
  newsTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  newsContentText: { fontSize: 13, lineHeight: 18 },
  newsFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingTop: 0 },
  newsDate: { fontSize: 11 },
  reactionsRow: { flexDirection: 'row', alignItems: 'center' },
  reactionItem: { flexDirection: 'row', alignItems: 'center' },
  reactionCount: { fontSize: 12, marginLeft: 4 },
  emptyContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 100,
    paddingHorizontal: 40
  },
  emptyText: { marginTop: 16, fontSize: 16, textAlign: 'center', fontWeight: '500' },
});
