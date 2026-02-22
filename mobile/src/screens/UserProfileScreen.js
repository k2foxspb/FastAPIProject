import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi, adminApi } from '../api';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const userRes = isAdminView 
        ? await adminApi.getUser(userId)
        : await usersApi.getUser(userId);
      setUser(userRes.data);
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
});
