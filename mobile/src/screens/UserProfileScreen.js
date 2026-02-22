import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi, adminApi, newsApi } from '../api';
import { API_BASE_URL } from '../constants';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatStatus, formatName } from '../utils/formatters';

export default function UserProfileScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { userId, isAdminView } = route.params;
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const userRes = isAdminView 
        ? await adminApi.getUser(userId)
        : await usersApi.getUser(userId);
      setUser(userRes.data);
      
      const postsRes = await newsApi.getUserNews(userId);
      setPosts(postsRes.data);
      
      setError(null);
    } catch (err) {
      setError('Не удалось загрузить профиль пользователя');
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, [userId, isAdminView]);

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

  const getFullUrl = (path) => {
    if (!path) return 'https://via.placeholder.com/150';
    if (path.startsWith('http')) return path;
    return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const renderPostItem = (item) => {
    const stripHtml = (html) => {
      if (!html) return '';
      return html.replace(/<[^>]*>?/gm, '');
    };
    
    const postThumbnail = item.images && item.images.length > 0 
      ? item.images[0].thumbnail_url 
      : item.image_url;

    return (
      <TouchableOpacity 
        key={item.id}
        style={[styles.postCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => navigation.navigate('NewsDetail', { newsId: item.id, newsItem: item })}
      >
        <View style={styles.postAuthorHeader}>
          <View style={styles.authorInfo}>
            <Image 
              source={{ uri: getFullUrl(user.avatar_url) || 'https://via.placeholder.com/40' }} 
              style={styles.authorAvatar} 
            />
            <View>
              <Text style={[styles.authorName, { color: colors.text }]}>{formatName(user)}</Text>
              <Text style={[styles.postDate, { color: colors.textSecondary }]}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.postContentRow}>
          {postThumbnail && (
            <Image 
              source={{ uri: getFullUrl(postThumbnail) }} 
              style={styles.postThumbnail} 
            />
          )}
          <View style={styles.postTextContainer}>
            <Text style={[styles.postTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.postContent, { color: colors.textSecondary }]} numberOfLines={2}>
              {stripHtml(item.content)}
            </Text>
          </View>
        </View>

        <View style={styles.postFooter}>
          <View style={styles.reactionsRow}>
            <View style={styles.reactionItem}>
              <Icon name={item.my_reaction === 1 ? "heart" : "heart-outline"} size={14} color={item.my_reaction === 1 ? colors.error : colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.likes_count || 0}</Text>
            </View>
            <View style={[styles.reactionItem, { marginLeft: 15 }]}>
              <Icon name="chatbubble-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>{item.comments_count || 0}</Text>
            </View>
          </View>
          <Icon name="chevron-forward" size={14} color={colors.border} />
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
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.avatarContainer} onPress={openAvatarAlbum}>
          <Image 
            source={{ uri: getFullUrl(user.avatar_url) }} 
            style={styles.avatar} 
          />
          {user.status === 'online' && (
            <View style={[styles.onlineBadge, { backgroundColor: '#4CAF50', borderColor: colors.background }]} />
          )}
        </TouchableOpacity>
        <Text style={[styles.name, { color: colors.text }]}>{formatName(user)}</Text>
        <View style={styles.roleContainer}>
          <Text style={[styles.role, { color: colors.textSecondary }]}>{user.role}</Text>
          <Text style={[styles.statusText, { color: colors.textSecondary }]}> • {formatStatus(user.status, user.last_seen)}</Text>
        </View>
        
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={[styles.friendBtn, { borderColor: colors.primary, borderWidth: 1 }]}
            onPress={handleFriendAction}
          >
            <Icon 
              name={user.friendship_status === 'accepted' ? "person-remove-outline" : "person-add-outline"} 
              size={20} 
              color={colors.primary} 
            />
            <Text style={[styles.friendBtnText, { color: colors.primary }]}>{getFriendButtonLabel()}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.messageBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('Messages', { 
              screen: 'Chat', 
              params: { userId: user.id, userName: formatName(user) } 
            })}
          >
            <Icon name="chatbubble-ellipses-outline" size={20} color="#fff" />
            <Text style={styles.messageBtnText}>Написать</Text>
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
                <Image source={{ uri: getFullUrl(item.preview_url || item.image_url) }} style={styles.photo} />
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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Записи</Text>
        {posts.length > 0 ? (
          posts.map((item) => renderPostItem(item))
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>У пользователя пока нет записей</Text>
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
  name: { fontSize: 20, fontWeight: 'bold' },
  roleContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  role: { },
  statusText: { },
  actionButtons: { flexDirection: 'row', width: '100%', justifyContent: 'center' },
  friendBtn: { 
    flexDirection: 'row', 
    paddingHorizontal: 15, 
    paddingVertical: 10, 
    borderRadius: 20,
    alignItems: 'center',
    marginRight: 10
  },
  friendBtnText: { marginLeft: 5, fontWeight: '600' },
  messageBtn: { 
    flexDirection: 'row', 
    paddingHorizontal: 15, 
    paddingVertical: 10, 
    borderRadius: 20,
    alignItems: 'center'
  },
  messageBtnText: { color: '#fff', marginLeft: 5, fontWeight: '600' },
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
  activityButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 12, borderWidth: 1, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  activityButtonText: { marginLeft: 10, fontWeight: 'bold', fontSize: 14 },
  postCard: { borderRadius: 12, marginBottom: 16, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, borderWidth: 1, overflow: 'hidden' },
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
});
