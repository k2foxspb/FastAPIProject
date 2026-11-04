import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import RenderHTML from 'react-native-render-html';
import { usersApi, adminApi, newsApi } from '../api';
import { API_BASE_URL } from '../constants';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { theme as themeConstants } from '../constants/theme';
import { formatStatus, formatName, getAvatarUrl, stripHtml, getFullUrl } from '../utils/formatters';
import { getRoleLabel, isAdminOrOwner } from '../constants/roles';
import RoleBadge from '../components/RoleBadge';
import FadeInImage from '../components/FadeInImage';
import VideoFeedThumb from '../components/VideoFeedThumb';

// Вынесенный мемоизированный компонент для HTML-контента публикации в списке - без него
// при каждом перерисовывании экрана RenderHTML получал новые объекты source/tagsStyles
// для каждого поста и TRenderEngineProvider затевал дорогой ререндер. useMemo внутри
// обычной функции рендера списка использовать нельзя, поэтому вынесено в отдельный компонент.
const PostHtmlContent = React.memo(function PostHtmlContent({ html, contentWidth, colors }) {
  const source = useMemo(() => ({ html }), [html]);
  const tagsStyles = useMemo(() => ({
    body: { color: colors.text, fontSize: 14, lineHeight: 20 },
    p: { marginBottom: 6 },
    img: { borderRadius: 8, marginVertical: 6, maxWidth: '100%' },
  }), [colors.text]);

  return <RenderHTML contentWidth={contentWidth} source={source} tagsStyles={tagsStyles} />;
});

export default function UserProfileScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { userId, isAdminView } = route.params;
  const { userStatuses } = useNotifications();
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);


  // Применяем WebSocket статус к текущему пользователю
  useEffect(() => {
    if (user && userStatuses[user.id]) {
      setUser(prev => ({ ...prev, ...userStatuses[user.id] }));
    }
  }, [userStatuses, user?.id]);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const userRes = isAdminView 
        ? await adminApi.getUser(userId)
        : await usersApi.getUser(userId);
      
      let userData = userRes.data;
      // Сразу применяем статус из WebSocket, если он есть
      if (userStatuses[userData.id]) {
        userData = { ...userData, ...userStatuses[userData.id] };
      }
      
      setUser(userData);
      
      const postsRes = await usersApi.getProfilePosts(userId);
      setPosts(postsRes.data || []);
      
      setError(null);
    } catch (err) {
      setError('Не удалось загрузить профиль пользователя');
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, [userId, isAdminView, userStatuses]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUser();
    setRefreshing(false);
  }, [fetchUser]);

  const handleFriendAction = async () => {
    try {
      if (!user.friendship_status) {
        await usersApi.sendFriendRequest(user.id);
      } else if (user.friendship_status === 'pending' || user.friendship_status === 'requested_by_me') {
        await usersApi.rejectFriendRequest(user.id);
      } else if (user.friendship_status === 'requested_by_them') {
        await usersApi.acceptFriendRequest(user.id);
      } else if (user.friendship_status === 'accepted') {
        await usersApi.deleteFriend(user.id);
      }
      fetchUser();
    } catch (err) {
      console.log(err);
    }
  };

  const getFriendButtonLabel = () => {
    if (!user.friendship_status) return 'Добавить в друзья';
    if (user.friendship_status === 'pending' || user.friendship_status === 'requested_by_me') return 'Отменить заявку';
    if (user.friendship_status === 'requested_by_them') return 'Принять заявку';
    if (user.friendship_status === 'accepted') return 'Удалить из друзей';
    return 'Добавить в друзья';
  };

  const openAvatarAlbum = () => {
    if (!user) return;
    
    // Ищем альбом с названием "Аватарки"
    const avatarAlbum = user.albums?.find(a => a.title === 'Аватарки');
    
    if (avatarAlbum && avatarAlbum.photos?.length > 0) {
      // Сортируем фото по дате (самые новые первыми, как в альбоме аватарок)
      // Находим текущую аватарку (самую последнюю добавленную)
      const sortedPhotos = [...avatarAlbum.photos].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      navigation.navigate('PhotoDetail', {
        photoId: sortedPhotos[0].id,
        initialPhotos: sortedPhotos,
        albumId: avatarAlbum.id,
        isOwner: false
      });
    } else if (user.avatar_url) {
      // Если альбома нет, но аватарка есть, показываем хотя бы её
      const tempPhoto = {
        id: -1,
        image_url: user.avatar_url,
        preview_url: user.avatar_preview_url || user.avatar_url,
        description: 'Текущая аватарка',
        created_at: new Date().toISOString()
      };
      navigation.navigate('PhotoDetail', {
        photoId: -1,
        initialPhotos: [tempPhoto],
        isOwner: false
      });
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchUser();
    }, [fetchUser])
  );


  const handleReactToPost = async (postId) => {
    try {
      const res = await usersApi.reactToProfilePost(postId, 'like');
      const action = res.data?.action;
      setPosts(prev => prev.map(p => {
        if (p.id === postId) {
          const currentCount = p.reactions_count || 0;
          if (action === 'added') {
            return { ...p, my_reaction: 'like', reactions_count: currentCount + 1 };
          } else if (action === 'removed') {
            return { ...p, my_reaction: null, reactions_count: Math.max(0, currentCount - 1) };
          }
        }
        return p;
      }));
    } catch (err) {
      console.log('React error:', err);
    }
  };

  // Открывает полноценный экран публикации (текст целиком, медиа, комментарии).
  // Поля публикации профиля (post_type/user/user_id) приводятся к виду, который
  // ожидает PostDetailScreen (item_type/author/author_id), как в ленте.
  const openPost = (post) => {
    navigation.navigate('PostDetail', {
      item: {
        ...post,
        item_type: post.post_type === 'announcement' ? 'announcement' : 'post',
        author: post.user,
        author_id: post.user_id,
      },
    });
  };

  const getPrivacyBadge = (privacy) => {
    if (privacy === 'friends') return { label: 'Для друзей', icon: 'people-outline' };
    if (privacy === 'private') return { label: 'Только я', icon: 'lock-closed-outline' };
    return { label: 'Публично', icon: 'globe-outline' };
  };

  const renderPostItem = (item) => {
    const privacyInfo = getPrivacyBadge(item.privacy);
    const hasMedia = !!item.media_url;
    const isVideoMedia = hasMedia && (
      item.media_type === 'video' ||
      ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes((item.media_url.split('?')[0].split('.').pop() || '').toLowerCase())
    );

    return (
      <TouchableOpacity 
        key={item.id}
        activeOpacity={0.9}
        onPress={() => openPost(item)}
        style={[styles.postCard, { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: theme === 'dark' ? 1 : 0, shadowOpacity: theme === 'dark' ? 0.1 : 0, elevation: theme === 'dark' ? 3 : 0 }]}
      >
        <View style={styles.postAuthorHeader}>
          <View style={styles.authorInfo}>
            <Image 
              source={{ uri: getAvatarUrl(user.avatar_url) || 'https://via.placeholder.com/40' }} 
              style={styles.authorAvatar} 
            />
            <View>
              <Text style={[styles.authorName, { color: colors.text }]}>{formatName(user)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Text style={[styles.postDate, { color: colors.textSecondary }]}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
                  <Icon name={privacyInfo.icon} size={11} color={colors.textSecondary} />
                  <Text style={{ fontSize: 10, color: colors.textSecondary, marginLeft: 3 }}>
                    {privacyInfo.label}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>

        {!!item.content && (
          item.content.includes('<') && item.content.includes('>') ? (
            <PostHtmlContent
              html={item.content}
              contentWidth={Dimensions.get('window').width - 60}
              colors={colors}
            />
          ) : (
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.text, paddingHorizontal: 12, paddingVertical: 8 }}>
              {item.content}
            </Text>
          )
        )}

        {hasMedia && (
          isVideoMedia ? (
            <VideoFeedThumb
              uri={getFullUrl(item.media_url)}
              style={{ width: '100%', height: 200, marginVertical: 4 }}
            />
          ) : (
            <FadeInImage
              source={{ uri: getFullUrl(item.media_url) }}
              style={{ width: '100%', height: 200, marginVertical: 4 }}
              resizeMode="cover"
            />
          )
        )}

        <View style={styles.postFooter}>
          <View style={styles.reactionsRow}>
            <TouchableOpacity 
              style={styles.reactionItem}
              onPress={(e) => { e.stopPropagation(); handleReactToPost(item.id); }}
            >
              <Icon 
                name={item.my_reaction ? "heart" : "heart-outline"} 
                size={18} 
                color={item.my_reaction ? (colors.error || '#e53935') : colors.textSecondary} 
              />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>
                {item.reactions_count || 0}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.reactionItem, { marginLeft: 16 }]}
              onPress={(e) => { e.stopPropagation(); openPost(item); }}
            >
              <Icon name="chatbubble-outline" size={17} color={colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>
                {item.comments_count || 0}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );

  if (error || !user) return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Text style={[styles.errorText, { color: colors.error }]}>{error || 'Пользователь не найден'}</Text>
      <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={fetchUser}>
        <Text style={styles.retryText}>Повторить</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.avatarContainer} onPress={openAvatarAlbum}>
          <Image 
            source={{ uri: getAvatarUrl(user.avatar_url) }} 
            style={styles.avatar} 
          />
          {user.status === 'online' && (
            <View style={[styles.onlineBadge, { backgroundColor: '#4CAF50', borderColor: colors.background }]} />
          )}
          <RoleBadge role={user.role} size={28} borderColor={colors.background} style={styles.roleBadge} />
        </TouchableOpacity>
        <Text style={[styles.name, { color: colors.text }]}>{formatName(user)}</Text>
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>{formatStatus(user.status, user.last_seen)}</Text>

        {isAdminOrOwner(user.role) && (
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text }]}>{getRoleLabel(user.role)}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Роль</Text>
            </View>
          </View>
        )}

        <View style={styles.actionsGrid}>
          <TouchableOpacity 
            style={[styles.actionBtn, { borderColor: colors.primary, borderWidth: 1 }]}
            onPress={handleFriendAction}
          >
            <Icon 
              name={user.friendship_status === 'accepted' ? "person-remove-outline" : "person-add-outline"} 
              size={18} 
              color={colors.primary} 
            />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>{getFriendButtonLabel()}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('Messages', { screen: 'Chat', params: { userId: user.id, userName: formatName(user) }, initial: false })}
          >
            <Icon name="chatbubble-ellipses-outline" size={18} color="#fff" />
            <Text style={[styles.actionBtnText, { color: '#fff' }]}>Написать</Text>
          </TouchableOpacity>
        </View>

      </View>

      <View style={styles.section}>
        <TouchableOpacity 
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}
          onPress={() => navigation.navigate('UserMedia', { userId: user.id, initialUser: user, isOwner: false })}
        >
          <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Фотографии и видео ({user.photos?.length || 0})</Text>
          <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <FlatList
          horizontal
          data={user.photos}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => {
            const isVideo = item.image_url && ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes(item.image_url.split('.').pop().toLowerCase());
            return (
              <TouchableOpacity 
                onPress={() => navigation.navigate('PhotoDetail', { 
                  photoId: item.id, 
                  initialPhotos: user.photos,
                  isOwner: false
                })}
                style={{ position: 'relative' }}
              >
                <Image source={{ uri: getAvatarUrl(item.preview_url || item.image_url) }} style={styles.photo} />
                {isVideo && (
                  <View style={[styles.privateBadge, { top: 5, right: 15, backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                    <Icon name="play" size={12} color="#fff" />
                  </View>
                )}
                {item.privacy === 'private' && (
                  <View style={[styles.privateBadge, { top: 5, right: isVideo ? 35 : 15 }]}>
                    <Icon name="lock-closed" size={12} color="#fff" />
                  </View>
                )}
                {item.privacy === 'friends' && (
                  <View style={[styles.privateBadge, { top: 5, right: isVideo ? 35 : 15 }]}>
                    <Icon name="people" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 15 }}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Публикации</Text>
        {posts.length > 0 ? (
          posts.map((item) => renderPostItem(item))
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>У пользователя пока нет публикаций</Text>
        )}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', padding: 20, borderBottomWidth: 1 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 10 },
  onlineBadge: {
    position: 'absolute',
    right: 5,
    bottom: 15,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    zIndex: 1
  },
  roleBadge: { top: 0, right: 2 },
  name: { fontSize: 20, fontWeight: 'bold', marginBottom: 2 },
  statusText: { fontSize: 13, marginBottom: 10 },
  statsContainer: { flexDirection: 'row', width: '100%', justifyContent: 'center', marginBottom: 10 },
  statItem: { alignItems: 'center', justifyContent: 'center', paddingVertical: 5 },
  statValue: { fontSize: 16, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 2 },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: '100%',
    marginTop: 5,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    margin: 5,
  },
  actionBtnText: { marginLeft: 8, fontWeight: '600', fontSize: 13 },
  managementBlock: {
    width: '100%',
    marginTop: 15,
    paddingTop: 12,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderRadius: 12,
  },
  managementTitle: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 8,
  },
  section: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  album: { marginBottom: 20 },
  albumTitle: { fontSize: 16, fontWeight: '500', marginBottom: 8 },
  photo: { width: 100, height: 100, marginRight: 10, borderRadius: 5 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridPhotoContainer: { position: 'relative' },
  gridPhoto: { width: 100, height: 100, margin: 5, borderRadius: 5 },
  privateBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    padding: 2
  },
  errorText: { marginBottom: 10 },
  retryBtn: { padding: 10, borderRadius: 5 },
  retryText: { color: '#fff' },
  activityButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 12, borderWidth: 1, ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 2) },
  activityButtonText: { marginLeft: 10, fontWeight: 'bold', fontSize: 14 },
  postCard: { borderRadius: 12, marginBottom: 16, borderWidth: 1, overflow: 'hidden', ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 3) },
  postAuthorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)' },
  authorInfo: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  authorName: { fontSize: 13, fontWeight: 'bold' },
  postContentRow: { flexDirection: 'row', padding: 10 },
  postThumbnail: { width: 70, height: 70, borderRadius: 8, marginRight: 12 },
  postTextContainer: { flex: 1, justifyContent: 'center' },
  postTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  postContent: { fontSize: 13, lineHeight: 18 },
  postFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 10 },
  postDate: { fontSize: 10 },
  reactionsRow: { flexDirection: 'row', alignItems: 'center' },
  reactionItem: { flexDirection: 'row', alignItems: 'center' },
  reactionCount: { fontSize: 11, marginLeft: 4 },
  emptyText: { textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  pickerContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  pickerTitle: { fontSize: 16, fontWeight: 'bold', flex: 1, marginRight: 10 },
  pickerMessage: { fontSize: 14, marginBottom: 10 },
  pickerList: { flexGrow: 0 },
  pickerRow: { paddingVertical: 14, borderBottomWidth: 1 },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
  },
  commentsList: {
    paddingHorizontal: 16,
    maxHeight: 300,
  },
  emptyCommentsText: {
    textAlign: 'center',
    marginVertical: 20,
    fontSize: 13,
  },
  commentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
  },
  commentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentAuthorName: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  commentText: {
    fontSize: 13,
    marginTop: 2,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 13,
    marginRight: 8,
  },
  sendCommentBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
