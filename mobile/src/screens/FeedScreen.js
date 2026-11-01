import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, Image, Platform, ScrollView, Alert } from 'react-native';
import notifee from '@notifee/react-native';
import * as VideoThumbnails from 'expo-video-thumbnails';
import FadeInImage from '../components/FadeInImage';
import FadeInView from '../components/FadeInView';
import { newsApi, feedApi } from '../api';
import { getFullUrl, stripHtml, formatPostDateTime } from '../utils/formatters';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { NewsSkeleton } from '../components/SkeletonLoader';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useNotifications } from '../context/NotificationContext';

// Нормализует ответ старого /news/ в формат элемента ленты, чтобы рендер карточек
// был единым, пока бэкенд может быть ещё не готов отдавать новый эндпоинт /feed.
const newsToFeedItem = (item) => ({
  ...item,
  item_type: 'news',
});

// Превью видео в ленте: первый кадр через expo-video-thumbnails (как в CachedMedia)
const VideoFeedThumb = ({ uri, style }) => {
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    let cancelled = false;
    VideoThumbnails.getThumbnailAsync(uri, { time: 0 })
      .then(({ uri: frame }) => { if (!cancelled) setThumb(frame); })
      .catch((e) => console.log('[FeedScreen] video thumbnail error:', e));
    return () => { cancelled = true; };
  }, [uri]);
  return (
    <View style={[style, { backgroundColor: '#000', overflow: 'hidden' }]}>
      {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Icon name="play-circle" size={28} color="#fff" />
      </View>
    </View>
  );
};

export default function FeedScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser, loadingUser, unreadNotificationsCount, refreshUnreadCount } = useNotifications();
  const [feedList, setFeedList] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const isLoadedRef = useRef(false);
  const loadingInProgressRef = useRef(false);

  const isAdminOrOwner = currentUser?.role === 'admin' || currentUser?.role === 'owner';

  const loadData = useCallback(async (isRefresh = false) => {
    if (loadingUser) {
      return;
    }

    if (loadingInProgressRef.current && !isRefresh) {
      return;
    }

    loadingInProgressRef.current = true;

    try {
      // Пытаемся получить единую ленту (/feed). Если бэкенд ещё не готов (404),
      // тихо откатываемся на старый способ получения только новостей, чтобы
      // приложение не сломалось в процессе параллельной доработки backend.
      try {
        const res = await feedApi.getFeed(0, 30);
        // Бэкенд /feed возвращает объект { items, total, skip, limit }, а не голый массив.
        setFeedList(res.data?.items || []);
      } catch (feedErr) {
        if (feedErr?.response?.status === 404) {
          const newsRes = await newsApi.getNews().catch(() => ({ data: [] }));
          setFeedList((newsRes.data || []).map(newsToFeedItem));
        } else {
          throw feedErr;
        }
      }

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
      refreshUnreadCount?.();

      navigation.setOptions({
        headerShown: true,
        title: 'Лента',
        headerRight: () => (
          <TouchableOpacity
            style={{ marginRight: 18 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => navigation.navigate('Notifications')}
          >
            <View style={styles.bellIconWrapper}>
              <Icon name="notifications-outline" size={24} color={colors.text} />
              {unreadNotificationsCount > 0 && (
                <View style={[styles.bellBadge, { backgroundColor: colors.error || '#e53935' }]}>
                  <Text style={styles.bellBadgeText} numberOfLines={1}>
                    {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ),
      });

      if (Platform.OS !== 'web') {
        notifee.cancelNotification('new_posts').catch(() => {});
      }

      return () => {
        isLoadedRef.current = false;
      };
    }, [loadData, navigation, colors.text, unreadNotificationsCount, refreshUnreadCount])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    await refreshUnreadCount?.();
    setRefreshing(false);
  };

  const getItemTypeBadge = (itemType) => {
    if (itemType === 'announcement') return { label: 'Объявление', icon: 'megaphone' };
    // Публикации (посты) пользователей больше не помечаются отдельным бейджем - он не нужен.
    if (itemType === 'post') return null;
    return { label: 'Новость', icon: 'newspaper-outline' };
  };

  const getPrivacyBadge = (privacy) => {
    if (privacy === 'friends') return { label: 'Для друзей', icon: 'people-outline' };
    if (privacy === 'private') return { label: 'Только я', icon: 'lock-closed-outline' };
    return null;
  };

  const handleModerate = (item) => {
    Alert.alert('Отметить проверенным', 'Пометить публикацию как проверенную модератором? Это действие необратимо.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отметить',
        onPress: async () => {
          try {
            await feedApi.moderatePost(item.id);
            setFeedList(prev => prev.map(p => p.id === item.id && p.item_type === item.item_type ? { ...p, moderation_status: 'approved' } : p));
          } catch (err) {
            Alert.alert('Ошибка', 'Не удалось выполнить модерацию');
          }
        },
      },
    ]);
  };

  const handleToggleHide = async (item) => {
    try {
      if (item.is_hidden) {
        await feedApi.unhidePost(item.id);
      } else {
        await feedApi.hidePost(item.id);
      }
      setFeedList(prev => prev.map(p => p.id === item.id && p.item_type === item.item_type ? { ...p, is_hidden: !p.is_hidden } : p));
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось изменить видимость публикации');
    }
  };

  const handleDeletePost = (item) => {
    Alert.alert('Удаление публикации', 'Вы уверены, что хотите удалить эту публикацию?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await feedApi.deletePost(item.id);
            setFeedList(prev => prev.filter(p => !(p.id === item.id && p.item_type === item.item_type)));
          } catch (err) {
            Alert.alert('Ошибка', 'Не удалось удалить публикацию');
          }
        },
      },
    ]);
  };

  const renderFeedItem = ({ item }) => {
    const isNews = item.item_type === 'news';
    const isAnnouncement = item.item_type === 'announcement';
    const typeBadge = getItemTypeBadge(item.item_type);
    const privacyBadge = getPrivacyBadge(item.privacy);
    const hasImages = item.images && item.images.length > 0;
    const videoUrl = item.media_type === 'video' && !hasImages && !item.image_url ? getFullUrl(item.media_url) : null;
    const thumbnail = hasImages ? item.images[0].thumbnail_url : (item.image_url || (videoUrl ? null : item.media_url));
    // /feed возвращает автора как вложенный объект item.author (id/first_name/last_name/avatar_url),
    // а старый /news/ (фолбэк, пока бэкенд не готов) - плоскими полями author_first_name/...
    const authorObj = item.author || {};
    const authorName = (authorObj.first_name || authorObj.last_name)
      ? `${authorObj.first_name || ''} ${authorObj.last_name || ''}`.trim()
      : (item.author_first_name
          ? `${item.author_first_name} ${item.author_last_name || ''}`.trim()
          : (item.user_first_name ? `${item.user_first_name} ${item.user_last_name || ''}`.trim() : 'Пользователь'));
    const authorAvatarUrl = authorObj.avatar_url || item.author_avatar_url || item.user_avatar_url;

    return (
      <TouchableOpacity
        style={[
          styles.newsCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
          isAnnouncement && { backgroundColor: colors.primary + '14', borderColor: colors.primary },
        ]}
        onPress={() => {
          if (isNews) {
            navigation.navigate('NewsDetail', { newsId: item.id, newsItem: item });
          } else {
            navigation.navigate('PostDetail', { item });
          }
        }}
        activeOpacity={0.7}
      >
        {(item.moderation_status === 'pending' || item.moderation_status === 'approved' || item.is_hidden) && (
          <View style={styles.statusBadgeContainer}>
            {item.moderation_status === 'pending' && (
              <View style={[styles.statusIconBadge, { backgroundColor: 'rgba(255,165,0,0.15)' }]}>
                <Icon name="time-outline" size={13} color="#FFA500" />
              </View>
            )}
            {item.moderation_status === 'approved' && (
              <View style={[styles.statusIconBadge, { backgroundColor: 'rgba(76,175,80,0.15)' }]}>
                <Icon name="checkmark-circle-outline" size={13} color="#4CAF50" />
              </View>
            )}
            {item.is_hidden && (
              <View style={[styles.statusIconBadge, { backgroundColor: 'rgba(229,57,53,0.12)' }]}>
                <Icon name="eye-off-outline" size={13} color={colors.error || '#e53935'} />
              </View>
            )}
          </View>
        )}
        <View style={styles.newsAuthorHeader}>
          <TouchableOpacity
            style={styles.authorInfo}
            disabled={isNews}
            onPress={() => navigation.navigate('UserProfile', { userId: item.author_id || item.user_id })}
          >
            <Image
              source={{ uri: getFullUrl(authorAvatarUrl) || 'https://via.placeholder.com/40' }}
              style={styles.authorAvatar}
            />
            <View>
              <Text style={[styles.authorName, { color: colors.text }]}>{authorName}</Text>
              <Text style={[styles.newsDate, { color: colors.textSecondary }]}>
                {formatPostDateTime(item.created_at)}
              </Text>
            </View>
          </TouchableOpacity>
          {isAdminOrOwner && isNews && (
            <TouchableOpacity onPress={(e) => {
              e.stopPropagation();
              navigation.navigate('EditNews', { newsItem: item });
            }}>
              <Icon name="create-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.badgesRow}>
          {typeBadge && (
            <View style={[styles.typeBadge, isAnnouncement && { backgroundColor: colors.primary }]}>
              <Icon name={typeBadge.icon} size={11} color={isAnnouncement ? '#fff' : colors.primary} />
              <Text style={[styles.typeBadgeText, { color: isAnnouncement ? '#fff' : colors.primary }]}>{typeBadge.label}</Text>
            </View>
          )}
          {privacyBadge && (
            <View style={styles.typeBadge}>
              <Icon name={privacyBadge.icon} size={11} color={colors.textSecondary} />
              <Text style={[styles.typeBadgeText, { color: colors.textSecondary }]}>{privacyBadge.label}</Text>
            </View>
          )}
        </View>

        <View style={styles.newsContentRow}>
          {videoUrl && (
            <VideoFeedThumb uri={videoUrl} style={styles.newsThumbnail} />
          )}
          {!videoUrl && thumbnail && (
            <FadeInImage
              source={{ uri: getFullUrl(thumbnail) }}
              style={styles.newsThumbnail}
            />
          )}
          <View style={styles.newsTextContainer}>
            {!!item.title && (
              <Text style={[styles.newsTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
            )}
            <Text style={[styles.newsContentText, { color: colors.textSecondary }]} numberOfLines={3}>
              {stripHtml(item.content)}
            </Text>
          </View>
        </View>

        <View style={styles.newsFooter}>
          <View style={styles.reactionsRow}>
            <View style={styles.reactionItem}>
              <Icon name={(item.my_reaction === 1 || item.my_reaction) ? "heart" : "heart-outline"} size={16} color={(item.my_reaction === 1 || item.my_reaction) ? colors.error : colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.likes_count || item.reactions_count || 0}</Text>
            </View>
            <View style={[styles.reactionItem, { marginLeft: 15 }]}>
              <Icon name="chatbubble-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.comments_count || 0}</Text>
            </View>
          </View>
          {!isNews && isAdminOrOwner && (
            <View style={styles.moderationRow}>
              {item.moderation_status === 'pending' && (
                <TouchableOpacity style={styles.moderationBtn} onPress={() => handleModerate(item)}>
                  <Icon name="checkmark-done-outline" size={16} color="#4CAF50" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.moderationBtn} onPress={() => handleToggleHide(item)}>
                <Icon name={item.is_hidden ? 'eye-outline' : 'eye-off-outline'} size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.moderationBtn} onPress={() => handleDeletePost(item)}>
                <Icon name="trash-outline" size={16} color={colors.error || '#e53935'} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Action Header: создание поста / объявления (только admin/owner) */}
      <View style={[styles.actionHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.proposeBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate('CreatePost')}
        >
          <Icon name="add" size={16} color="#fff" />
          <Text style={styles.proposeBtnText}>Новая публикация</Text>
        </TouchableOpacity>

        {isAdminOrOwner && (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.primary }]}
            onPress={() => navigation.navigate('CreatePost', { isAnnouncement: true })}
          >
            <Icon name="megaphone-outline" size={16} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Объявление</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && !refreshing ? (
        <ScrollView style={styles.listContent}>
          <NewsSkeleton />
          <NewsSkeleton />
        </ScrollView>
      ) : (
        <FadeInView visible={!loading} duration={250}>
          <FlatList
            data={feedList}
            keyExtractor={(item, index) => `${item.item_type}-${item.id}-${index}`}
            renderItem={renderFeedItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon name="newspaper-outline" size={64} color={colors.border} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Пока в ленте ничего нет
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
  bellIconWrapper: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold', includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },
  headerRightActions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
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
  newsCard: { borderRadius: 12, marginBottom: 14, overflow: 'hidden', borderWidth: 1, position: 'relative', ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 4) },
  statusBadgeContainer: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', zIndex: 10, elevation: 10 },
  newsAuthorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)' },
  authorInfo: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  authorName: { fontSize: 14, fontWeight: 'bold' },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 6 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginRight: 6,
    marginBottom: 6,
  },
  typeBadgeText: { fontSize: 10, fontWeight: '600', marginLeft: 4 },
  statusIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    marginBottom: 6,
  },
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
  moderationRow: { flexDirection: 'row', alignItems: 'center' },
  moderationBtn: { marginLeft: 14 },
  emptyContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 100,
    paddingHorizontal: 40
  },
  emptyText: { marginTop: 16, fontSize: 16, textAlign: 'center', fontWeight: '500' },
});
