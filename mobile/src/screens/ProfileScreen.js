import React, { useState, useCallback } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, Modal, TouchableWithoutFeedback, Switch, Alert, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { usersApi, newsApi, setAuthToken } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useNotifications } from '../context/NotificationContext';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { storage } from '../utils/storage';
import { getFullUrl } from '../utils/urlHelper';
import { formatName } from '../utils/formatters';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [quietHours, setQuietHours] = useState({ enabled: false, start: '22:00', end: '08:00' });
  const { disconnect, currentUser, loadingUser } = useNotifications();
  const { theme, isDark, toggleTheme, isSystemTheme, useSystemThemeSetting } = useTheme();
  const colors = themeConstants[theme];

  const handleLogout = async () => {
    setSettingsVisible(false);
    await storage.clearTokens();
    setAuthToken(null);
    disconnect();
    navigation.replace('Login');
  };

  const handleEditProfile = () => {
    setSettingsVisible(false);
    navigation.navigate('EditProfile', { user });
  };

  const handleSyncNotifications = async () => {
    try {
      setSyncing(true);
      const { updateServerFcmToken } = require('../utils/notifications');
      const result = await updateServerFcmToken();
      
      if (result && result.success) {
        Alert.alert('Success', 'Push notifications synchronized successfully!');
      } else {
        const errorMsg = result?.error || 'Unknown error';
        Alert.alert('Sync Failed', `Failed to synchronize: ${errorMsg}\n\nPlease check if notifications are allowed in system settings.`);
      }
    } catch (e) {
      Alert.alert('Error', `Error during synchronization: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const openAvatarAlbum = () => {
    if (!user) return;
    
    // Ищем альбом с названием "Аватарки"
    const avatarAlbum = user.albums?.find(a => a.title === 'Аватарки');
    
    if (avatarAlbum && avatarAlbum.photos?.length > 0) {
      // Сортируем фото по дате (самые новые первыми)
      const sortedPhotos = [...avatarAlbum.photos].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      
      navigation.navigate('PhotoDetail', {
        photoId: sortedPhotos[0].id,
        initialPhotos: sortedPhotos,
        albumId: avatarAlbum.id,
        isOwner: true
      });
    } else if (user.avatar_url) {
      // Если альбома нет, но аватарка есть, показываем её
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
        isOwner: true
      });
    }
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
          {item.moderation_status === 'pending' && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingText}>Ожидает</Text>
            </View>
          )}
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

  useFocusEffect(
    useCallback(() => {
      // Установка иконки настроек в заголовке
      navigation.setOptions({
        headerRight: () => (
          <TouchableOpacity 
            style={{ marginRight: 15 }} 
            onPress={() => setSettingsVisible(true)}
          >
            <Icon name="settings-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        ),
      });

      const fetchProfile = async () => {
        // Если идет загрузка данных пользователя в контексте, ждем
        if (loadingUser) return;
        
        // Проверяем токен. Если его нет ни в axios, ни в хранилище - выходим
        const token = await storage.getAccessToken();
        if (!api.defaults.headers.common['Authorization'] && !token) {
          console.log('[ProfileScreen] No token found, redirecting to Login');
          handleLogout();
          return;
        }

        try {
          let userData = currentUser;
          if (!userData) {
            // Если пользователя всё еще нет и загрузка завершена, значит он не авторизован
            console.log('[ProfileScreen] No currentUser after loading, redirecting to Login');
            handleLogout();
            return;
          }
          setUser(userData);
          const postsRes = await newsApi.getUserNews(userData.id);
          setPosts(postsRes.data);
        } catch (err) {
          const status = err?.response?.status;
          if (status === 401) {
            handleLogout();
          } else {
            setError('Не удалось загрузить профиль');
            console.log(err);
          }
        }
      };

      fetchProfile();

      // Загрузка настроек тихих часов
      storage.getItem('quiet_hours_enabled').then(enabled => {
        storage.getItem('quiet_hours_start').then(start => {
          storage.getItem('quiet_hours_end').then(end => {
            setQuietHours({
              enabled: enabled === 'true',
              start: start || '22:00',
              end: end || '08:00'
            });
          }).catch(() => {});
        }).catch(() => {});
      }).catch(() => {});
    }, [navigation, colors.text, currentUser, loadingUser])
  );

  const toggleQuietHours = async () => {
    const newState = { ...quietHours, enabled: !quietHours.enabled };
    setQuietHours(newState);
    await storage.saveItem('quiet_hours_enabled', newState.enabled ? 'true' : 'false');
  };

  const changeQuietTime = (type) => {
    const times = type === 'start' 
      ? ['20:00', '21:00', '22:00', '23:00', '00:00']
      : ['06:00', '07:00', '08:00', '09:00', '10:00'];
      
    Alert.alert(
      type === 'start' ? 'Начало "тихого времени"' : 'Конец "тихого времени"',
      'Выберите время:',
      [
        ...times.map(t => ({
          text: t,
          onPress: async () => {
            const newState = { ...quietHours, [type]: t };
            setQuietHours(newState);
            await storage.saveItem(`quiet_hours_${type}`, t);
          }
        })),
        { text: 'Отмена', style: 'cancel' }
      ]
    );
  };

  if (!user) return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <Text style={{ marginBottom: 20, color: colors.text }}>{error || 'Загрузка...'}</Text>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Выйти</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderColor: colors.border }]}>
        <TouchableOpacity onPress={openAvatarAlbum}>
          <Image 
            source={{ uri: getFullUrl(user.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.avatar} 
          />
        </TouchableOpacity>
        <Text style={[styles.name, { color: colors.text }]}>{formatName(user)}</Text>
        <Text style={[styles.role, { color: colors.textSecondary }]}>{user.role}</Text>
      </View>

      <Modal
        visible={isSettingsVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSettingsVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setSettingsVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Настройки</Text>
                  <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                    <Icon name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>

                {user.role === 'admin' || user.role === 'owner' ? (
                  <TouchableOpacity 
                    style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.border }]} 
                    onPress={() => {
                      setSettingsVisible(false);
                      navigation.navigate('Admin');
                    }}
                  >
                    <Icon name="shield-checkmark-outline" size={22} color={colors.primary} />
                    <Text style={[styles.menuItemText, { color: colors.text }]}>Админ-панель</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity 
                  style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.border }]} 
                  onPress={() => {
                    setSettingsVisible(false);
                    navigation.navigate('Orders');
                  }}
                >
                  <Icon name="receipt-outline" size={22} color={colors.primary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Мои заказы</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.menuItem, { borderBottomWidth: 1, borderBottomColor: colors.border }]} 
                  onPress={handleEditProfile}
                >
                  <Icon name="create-outline" size={22} color={colors.primary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Редактировать профиль</Text>
                </TouchableOpacity>

                <View style={styles.menuSection}>
                  <Text style={[styles.menuSectionTitle, { color: colors.textSecondary }]}>Тема оформления</Text>
                  <View style={styles.themeToggleRow}>
                    <TouchableOpacity 
                      style={[
                        styles.themeOption, 
                        isSystemTheme && { backgroundColor: colors.primary }
                      ]} 
                      onPress={useSystemThemeSetting}
                    >
                      <Text style={[styles.themeOptionText, isSystemTheme && { color: '#fff' }]}>Системная</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[
                        styles.themeOption, 
                        !isSystemTheme && !isDark && { backgroundColor: colors.primary }
                      ]} 
                      onPress={() => toggleTheme('light')}
                    >
                      <Text style={[styles.themeOptionText, !isSystemTheme && !isDark && { color: '#fff' }]}>Светлая</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[
                        styles.themeOption, 
                        !isSystemTheme && isDark && { backgroundColor: colors.primary }
                      ]} 
                      onPress={() => toggleTheme('dark')}
                    >
                      <Text style={[styles.themeOptionText, !isSystemTheme && isDark && { color: '#fff' }]}>Тёмная</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.menuSection, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 5 }]}>
                  <View style={styles.quietHoursHeader}>
                    <Text style={[styles.menuSectionTitle, { color: colors.textSecondary, marginBottom: 0 }]}>Тихие часы (DND)</Text>
                    <Switch 
                      value={quietHours.enabled} 
                      onValueChange={toggleQuietHours}
                      trackColor={{ false: colors.border, true: colors.primary + '80' }}
                      thumbColor={quietHours.enabled ? colors.primary : '#f4f3f4'}
                    />
                  </View>
                  
                  {quietHours.enabled && (
                    <View style={styles.timePickerRow}>
                      <TouchableOpacity style={styles.timeButton} onPress={() => changeQuietTime('start')}>
                        <Text style={[styles.timeButtonLabel, { color: colors.textSecondary }]}>С </Text>
                        <Text style={[styles.timeButtonText, { color: colors.primary }]}>{quietHours.start}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.timeButton} onPress={() => changeQuietTime('end')}>
                        <Text style={[styles.timeButtonLabel, { color: colors.textSecondary }]}>До </Text>
                        <Text style={[styles.timeButtonText, { color: colors.primary }]}>{quietHours.end}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <Text style={[styles.menuHint, { color: colors.textSecondary }]}>
                    В это время звуковые уведомления в приложении будут отключены.
                  </Text>
                </View>

                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

                <TouchableOpacity 
                  style={styles.menuItem} 
                  onPress={handleSyncNotifications}
                  disabled={syncing}
                >
                  <Icon name="sync-outline" size={22} color={colors.primary} />
                  <Text style={[styles.menuItemText, { color: colors.primary }]}>
                    {syncing ? 'Синхронизация...' : 'Синхронизировать уведомления'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.menuItem, { marginTop: 10 }]} 
                  onPress={handleLogout}
                >
                  <Icon name="log-out-outline" size={22} color={colors.error} />
                  <Text style={[styles.menuItemText, { color: colors.error }]}>Выйти из аккаунта</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 15 }]}>Моя активность</Text>
        <View style={styles.activityRow}>
          <TouchableOpacity 
            style={[styles.activityButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => navigation.navigate('MyLikes')}
          >
            <Icon name="heart" size={24} color={colors.error} />
            <Text style={[styles.activityButtonText, { color: colors.text }]}>Понравилось</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.activityButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => navigation.navigate('MyReviews')}
          >
            <Icon name="star" size={24} color="#FFD700" />
            <Text style={[styles.activityButtonText, { color: colors.text }]}>Мои отзывы</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <TouchableOpacity 
          style={styles.sectionHeader}
          onPress={() => navigation.navigate('UserMedia', { userId: user.id, initialUser: user, isOwner: true })}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Фотографии и видео</Text>
          <Icon name="chevron-forward" size={20} color={colors.border} style={{ marginLeft: 5 }} />
        </TouchableOpacity>

        <FlatList
          horizontal
          data={user.photos}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => {
            const isVideo = item.image_url && ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes(item.image_url.split('.').pop().toLowerCase());
            return (
              <TouchableOpacity onPress={() => navigation.navigate('PhotoDetail', { 
                photoId: item.id,
                initialPhotos: user.photos,
                isOwner: true
              })}>
                <View style={{ position: 'relative' }}>
                  <Image source={{ uri: getFullUrl(item.preview_url || item.image_url) }} style={styles.photo} />
                  {isVideo && (
                    <View style={styles.videoBadge}>
                      <Icon name="play" size={12} color="#fff" />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 15 }}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Мои записи</Text>
          <TouchableOpacity onPress={() => navigation.navigate('EditNews')}>
            <Icon name="add-circle-outline" size={28} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {posts.length > 0 ? (
          posts.map((item) => renderPostItem(item))
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>У вас пока нет записей</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: '#eee' },
  avatar: { width: 100, height: 100, borderRadius: 50, marginBottom: 10 },
  name: { fontSize: 20, fontWeight: 'bold' },
  role: { color: 'gray' },
  section: { padding: 20 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold' },
  album: { marginBottom: 20 },
  albumTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  albumTitle: { fontSize: 16, fontWeight: '500' },
  photo: { width: 100, height: 100, marginRight: 10, borderRadius: 5 },
  videoBadge: {
    position: 'absolute',
    top: 5,
    right: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    padding: 2,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridPhoto: { width: 100, height: 100, margin: 5, borderRadius: 5 },
  logoutButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  logoutButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
  },
  menuItemText: {
    fontSize: 16,
    marginLeft: 15,
    fontWeight: '500',
  },
  menuSection: {
    marginTop: 10,
    paddingVertical: 10,
  },
  menuSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  themeToggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
    padding: 2,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  themeOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8E8E93',
  },
  quietHoursHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 10,
  },
  timeButtonLabel: {
    fontSize: 12,
  },
  timeButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  menuHint: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 5,
  },
  menuDivider: {
    height: 1,
    marginVertical: 10,
  },
  activityRow: { flexDirection: 'row', justifyContent: 'space-between' },
  activityButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, borderRadius: 12, borderWidth: 1, marginHorizontal: 5, ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 2) },
  activityButtonText: { marginLeft: 10, fontWeight: 'bold', fontSize: 14 },
  postCard: { borderRadius: 12, marginBottom: 16, borderWidth: 1, overflow: 'hidden', ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 3) },
  postAuthorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.05)' },
  authorInfo: { flexDirection: 'row', alignItems: 'center' },
  authorAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  authorName: { fontSize: 13, fontWeight: 'bold' },
  postContentRow: { flexDirection: 'row', padding: 10 },
  postThumbnail: { width: 70, height: 70, borderRadius: 8, marginRight: 12 },
  postTextContainer: { flex: 1, justifyContent: 'center' },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  postTitle: { fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  postContent: { fontSize: 13, lineHeight: 18 },
  postFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingBottom: 10 },
  postDate: { fontSize: 10 },
  reactionsRow: { flexDirection: 'row', alignItems: 'center' },
  reactionItem: { flexDirection: 'row', alignItems: 'center' },
  reactionCount: { fontSize: 11, marginLeft: 4 },
  pendingBadge: { backgroundColor: 'rgba(255, 165, 0, 0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  pendingText: { color: '#FFA500', fontSize: 10, fontWeight: 'bold' },
  emptyText: { textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
});
