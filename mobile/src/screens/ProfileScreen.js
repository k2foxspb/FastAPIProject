import React, { useState, useCallback, useRef } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, Modal, TouchableWithoutFeedback, Switch, Alert, Platform, Linking, RefreshControl, Dimensions, TextInput, ActivityIndicator } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import RenderHTML from 'react-native-render-html';
import api, { usersApi, newsApi, setAuthToken } from '../api';
import { API_BASE_URL } from '../constants';
import { Ionicons as Icon } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNotifications } from '../context/NotificationContext';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { storage } from '../utils/storage';
import { formatName, getFullUrl } from '../utils/formatters';
import { isProductionRole, getRoleLabel, getRoleIcon, getRoleScope } from '../constants/roles';
import { SkeletonItem, NewsSkeleton } from '../components/SkeletonLoader';
import { requestAllAppPermissions } from '../utils/permissions';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const [isUpdateBannerHidden, setIsUpdateBannerHidden] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fetchProfileRef = useRef(null);
  const [quietHours, setQuietHours] = useState({ enabled: false, start: '22:00', end: '08:00' });
  const [notificationGroups, setNotificationGroups] = useState({ disabled: [], available: {} });

  // Состояния для личных публикаций в профиле
  const [createPostVisible, setCreatePostVisible] = useState(false);
  const [newPostContent, setNewPostContent] = useState('');
  const [newPostPrivacy, setNewPostPrivacy] = useState('public'); // 'public' | 'friends' | 'private'
  const [creatingPost, setCreatingPost] = useState(false);

  // Состояния для комментариев к публикации
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [activePostForComments, setActivePostForComments] = useState(null);
  const [postComments, setPostComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const { disconnect, currentUser, loadingUser, loadUser } = useNotifications();
  const { theme, isDark, toggleTheme, isSystemTheme, useSystemThemeSetting } = useTheme();
  const colors = themeConstants[theme];
  const insets = useSafeAreaInsets();

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

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) {
      Alert.alert('Ошибка', 'Введите текст публикации');
      return;
    }
    setCreatingPost(true);
    try {
      const res = await usersApi.createProfilePost({
        content: newPostContent.trim(),
        privacy: newPostPrivacy,
      });
      setPosts(prev => [res.data, ...prev]);
      setNewPostContent('');
      setNewPostPrivacy('public');
      setCreatePostVisible(false);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось создать публикацию');
    } finally {
      setCreatingPost(false);
    }
  };

  const handleDeletePost = (postId) => {
    Alert.alert('Удаление публикации', 'Вы уверены, что хотите удалить эту публикацию?', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await usersApi.deleteProfilePost(postId);
            setPosts(prev => prev.filter(p => p.id !== postId));
          } catch (err) {
            Alert.alert('Ошибка', 'Не удалось удалить публикацию');
          }
        },
      },
    ]);
  };

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

  const openComments = async (post) => {
    setActivePostForComments(post);
    setCommentsVisible(true);
    setLoadingComments(true);
    try {
      const res = await usersApi.getProfilePostComments(post.id);
      setPostComments(res.data || []);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить комментарии');
    } finally {
      setLoadingComments(false);
    }
  };

  const handleAddComment = async () => {
    if (!newCommentText.trim() || !activePostForComments) return;
    setSubmittingComment(true);
    try {
      const res = await usersApi.addProfilePostComment(activePostForComments.id, newCommentText.trim());
      setPostComments(prev => [...prev, res.data]);
      setNewCommentText('');
      setPosts(prev => prev.map(p => p.id === activePostForComments.id ? { ...p, comments_count: (p.comments_count || 0) + 1 } : p));
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось отправить комментарий');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await usersApi.deleteProfilePostComment(commentId);
      setPostComments(prev => prev.filter(c => c.id !== commentId));
      if (activePostForComments) {
        setPosts(prev => prev.map(p => p.id === activePostForComments.id ? { ...p, comments_count: Math.max(0, (p.comments_count || 1) - 1) } : p));
      }
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось удалить комментарий');
    }
  };

  const getPrivacyBadge = (privacy) => {
    if (privacy === 'friends') return { label: 'Для друзей', icon: 'people-outline' };
    if (privacy === 'private') return { label: 'Только я', icon: 'lock-closed-outline' };
    return { label: 'Публично', icon: 'globe-outline' };
  };

  const renderPostItem = (item) => {
    const privacyInfo = getPrivacyBadge(item.privacy);
    const hasMedia = !!item.media_url;

    return (
      <View 
        key={item.id}
        style={[styles.postCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.postAuthorHeader}>
          <View style={styles.authorInfo}>
            <Image 
              source={{ uri: getFullUrl(user.avatar_url) || 'https://via.placeholder.com/40' }} 
              style={styles.authorAvatar} 
            />
            <View>
              <Text style={[styles.authorName, { color: colors.text }]}>{formatName(user)}</Text>
              <View style={styles.postMetaRow}>
                <Text style={[styles.postDate, { color: colors.textSecondary }]}>
                  {new Date(item.created_at).toLocaleDateString()}
                </Text>
                <View style={styles.privacyBadge}>
                  <Icon name={privacyInfo.icon} size={11} color={colors.textSecondary} />
                  <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
                    {privacyInfo.label}
                  </Text>
                </View>
              </View>
            </View>
          </View>
          <TouchableOpacity onPress={() => handleDeletePost(item.id)} style={{ padding: 4 }}>
            <Icon name="trash-outline" size={16} color={colors.error || '#e53935'} />
          </TouchableOpacity>
        </View>

        {!!item.content && (
          item.content.includes('<') && item.content.includes('>') ? (
            <RenderHTML
              contentWidth={Dimensions.get('window').width - 60}
              source={{ html: item.content }}
              tagsStyles={{
                body: { color: colors.text, fontSize: 15, lineHeight: 22 },
                p: { marginBottom: 6 },
                img: { borderRadius: 8, marginVertical: 6, maxWidth: '100%' },
              }}
            />
          ) : (
            <Text style={[styles.postContentText, { color: colors.text }]}>
              {item.content}
            </Text>
          )
        )}

        {hasMedia && (
          <Image
            source={{ uri: getFullUrl(item.media_url) }}
            style={styles.postMedia}
            resizeMode="cover"
          />
        )}

        <View style={styles.postFooter}>
          <View style={styles.reactionsRow}>
            <TouchableOpacity 
              style={styles.reactionItem}
              onPress={() => handleReactToPost(item.id)}
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
              onPress={() => openComments(item)}
            >
              <Icon name="chatbubble-outline" size={17} color={colors.textSecondary} />
              <Text style={[styles.reactionCount, { color: colors.textSecondary }]}>
                {item.comments_count || 0}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
        if (loadingUser) return;
        
        try {
          // Запрашиваем разрешения при входе в профиль
          requestAllAppPermissions();

          // Проверяем токен
          const token = await storage.getAccessToken();
          if (!token) {
            console.log('[ProfileScreen] No token found, showing login screen');
            navigation.replace('Login');
            return;
          }

          // Обновляем данные текущего пользователя из API
          const appVersion = Constants.expoConfig?.version || '1.0.10';
          const userRes = await usersApi.getMe(appVersion);
          const userData = userRes.data;
          
          setUser(userData);
          const postsRes = await usersApi.getProfilePosts(userData.id);
          setPosts(postsRes.data || []);
          
          if (userData.latest_app_version) {
            const hiddenId = await storage.getItem('hidden_update_id');
            if (hiddenId === String(userData.latest_app_version.id)) {
              setIsUpdateBannerHidden(true);
            }
          }
        } catch (err) {
          const status = err?.response?.status;
          if (status === 401) {
            await storage.clearTokens();
            setAuthToken(null);
            disconnect();
            navigation.replace('Login');
          } else {
            setError('Не удалось загрузить профиль');
            console.log(err);
          }
        }
      };

      fetchProfileRef.current = fetchProfile;
      fetchProfile();

      // Загрузка настроек уведомлений (тихие часы + отключённые группы) с сервера.
      // Сервер - источник истины (единые настройки на всех устройствах), но
      // дублируем тихие часы в локальное хранилище, чтобы isWithinQuietHours()
      // могла быстро проверить их офлайн (для звука уведомлений внутри приложения).
      usersApi.getNotificationSettings()
        .then(res => {
          const data = res.data || {};
          setQuietHours({
            enabled: !!data.quiet_hours_enabled,
            start: data.quiet_hours_start || '22:00',
            end: data.quiet_hours_end || '08:00',
          });
          setNotificationGroups({
            disabled: data.disabled_groups || [],
            available: data.available_groups || {},
          });
          storage.saveItem('quiet_hours_enabled', data.quiet_hours_enabled ? 'true' : 'false');
          storage.saveItem('quiet_hours_start', data.quiet_hours_start || '22:00');
          storage.saveItem('quiet_hours_end', data.quiet_hours_end || '08:00');
        })
        .catch(() => {
          // Сервер недоступен - используем последние известные локальные значения
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
        });
    }, [navigation, colors.text, loadUser, loadingUser])
  );

  const toggleQuietHours = async () => {
    const newState = { ...quietHours, enabled: !quietHours.enabled };
    setQuietHours(newState);
    await storage.saveItem('quiet_hours_enabled', newState.enabled ? 'true' : 'false');
    usersApi.updateNotificationSettings({ quiet_hours_enabled: newState.enabled }).catch(() => {});
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
            usersApi.updateNotificationSettings(
              type === 'start' ? { quiet_hours_start: t } : { quiet_hours_end: t }
            ).catch(() => {});
          }
        })),
        { text: 'Отмена', style: 'cancel' }
      ]
    );
  };

  const toggleNotificationGroup = async (groupCode) => {
    const isDisabled = notificationGroups.disabled.includes(groupCode);
    const newDisabled = isDisabled
      ? notificationGroups.disabled.filter(g => g !== groupCode)
      : [...notificationGroups.disabled, groupCode];
    setNotificationGroups({ ...notificationGroups, disabled: newDisabled });
    try {
      await usersApi.updateNotificationSettings({ disabled_groups: newDisabled });
    } catch (e) {
      // Откатываем состояние при ошибке сохранения на сервере
      setNotificationGroups({ ...notificationGroups, disabled: notificationGroups.disabled });
    }
  };

  const handleHideUpdate = async (id) => {
    if (!id) return;
    await storage.saveItem('hidden_update_id', String(id));
    setIsUpdateBannerHidden(true);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (fetchProfileRef.current) await fetchProfileRef.current();
    setRefreshing(false);
  }, []);

  if (error && !user) return (
    <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
      <Icon name="alert-circle-outline" size={64} color={colors.error} />
      <Text style={[styles.name, { color: colors.text, marginTop: 20, textAlign: 'center' }]}>{error}</Text>
      <TouchableOpacity 
        style={[styles.saveButton, { backgroundColor: colors.primary, marginTop: 20, width: '100%' }]}
        onPress={() => {
          setError(null);
          loadUser();
        }}
      >
        <Text style={styles.saveButtonText}>Попробовать снова</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={[styles.menuItem, { marginTop: 10, justifyContent: 'center' }]}
        onPress={handleLogout}
      >
        <Text style={[styles.menuItemText, { color: colors.error }]}>Выйти</Text>
      </TouchableOpacity>
    </View>
  );

  if (!user) return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingBottom: 20 }]}>
        <SkeletonItem width={100} height={100} borderRadius={50} style={{ alignSelf: 'center', marginBottom: 15 }} />
        <SkeletonItem width={180} height={24} style={{ alignSelf: 'center', marginBottom: 8 }} />
        <SkeletonItem width={120} height={16} style={{ alignSelf: 'center' }} />
      </View>
      <View style={{ padding: 15 }}>
        <SkeletonItem width={150} height={20} style={{ marginBottom: 15 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
          <SkeletonItem width="48%" height={80} borderRadius={12} />
          <SkeletonItem width="48%" height={80} borderRadius={12} />
        </View>
        <NewsSkeleton />
        <NewsSkeleton />
      </View>
    </View>
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {user.update_available && !isUpdateBannerHidden && (
        <View style={styles.updateBannerWrapper}>
          <TouchableOpacity 
            style={styles.updateBanner} 
            onPress={() => {
              const url = user.latest_app_version?.file_path || (Platform.OS === 'ios' 
                ? 'https://fokin.fun' 
                : 'https://fokin.fun');
              Linking.openURL(getFullUrl(url)).catch(err => console.error("Couldn't load page", err));
            }}
          >
            <Icon name="cloud-download-outline" size={24} color="#fff" />
            <View style={styles.updateBannerTextContainer}>
              <Text style={styles.updateBannerTitle}>Доступна новая версия!</Text>
              <Text style={styles.updateBannerSubtitle}>Нажмите, чтобы обновить приложение</Text>
            </View>
            <Icon name="chevron-forward" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.closeBannerButton} 
            onPress={() => handleHideUpdate(user.latest_app_version?.id)}
          >
            <Icon name="close-circle" size={22} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>
      )}
      <View style={[styles.header, { borderColor: colors.border }]}>
        <TouchableOpacity onPress={openAvatarAlbum} style={styles.avatarContainer}>
          <Image 
            source={{ uri: getFullUrl(user.avatar_url) || 'https://via.placeholder.com/150' }} 
            style={styles.avatar} 
          />
          <View style={[styles.roleBadge, { backgroundColor: colors.primary }]}>
            <Icon name={getRoleIcon(user.role)} size={12} color="#fff" />
          </View>
        </TouchableOpacity>
        <Text style={[styles.name, { color: colors.text }]}>{formatName(user)}</Text>

        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: colors.text, fontSize: 14 }]}>
              {getRoleLabel(user.role)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Должность</Text>
          </View>
          {user.workshop_name && (
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text, fontSize: 14 }]}>
                {user.workshop_name}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Цех</Text>
            </View>
          )}
          {getRoleScope(user.role) === 'section' && user.section_name && (
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.text, fontSize: 14 }]}>
                {user.section_name}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Участок</Text>
            </View>
          )}
        </View>

        {isProductionRole(user.role) ? (
          <View style={styles.productionActionsRow}>
            <TouchableOpacity
              style={[styles.hierarchyBtn, { borderColor: colors.primary, borderWidth: 1 }]}
              onPress={() => navigation.navigate('UserHierarchy', { userId: user.id, userName: formatName(user) })}
            >
              <Icon name="git-network-outline" size={18} color={colors.primary} />
              <Text style={[styles.hierarchyBtnText, { color: colors.primary }]}>Сотрудники</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.hierarchyBtn, { borderColor: colors.primary, borderWidth: 1 }]}
              onPress={() => navigation.navigate('ActingAssignments')}
            >
              <Icon name="swap-horizontal-outline" size={18} color={colors.primary} />
              <Text style={[styles.hierarchyBtnText, { color: colors.primary }]}>И.о.</Text>
            </TouchableOpacity>
          </View>
        ) : null}
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
              <View style={[
                styles.modalContent,
                { backgroundColor: colors.surface, maxHeight: Dimensions.get('window').height - insets.top - 20 },
              ]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Настройки</Text>
                  <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                    <Icon name="close" size={24} color={colors.text} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>

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
                    В это время уведомления будут приходить без звука и вибрации.
                  </Text>
                </View>

                {Object.keys(notificationGroups.available).length > 0 && (
                  <View style={[styles.menuSection, { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 5 }]}>
                    <Text style={[styles.menuSectionTitle, { color: colors.textSecondary }]}>Группы оповещений</Text>
                    {Object.entries(notificationGroups.available).map(([code, label]) => (
                      <View key={code} style={styles.quietHoursHeader}>
                        <Text style={[styles.menuItemText, { color: colors.text, marginLeft: 0 }]}>{label}</Text>
                        <Switch
                          value={!notificationGroups.disabled.includes(code)}
                          onValueChange={() => toggleNotificationGroup(code)}
                          trackColor={{ false: colors.border, true: colors.primary + '80' }}
                          thumbColor={!notificationGroups.disabled.includes(code) ? colors.primary : '#f4f3f4'}
                        />
                      </View>
                    ))}
                    <Text style={[styles.menuHint, { color: colors.textSecondary }]}>
                      Отключённые группы не будут присылать push-уведомления.
                    </Text>
                  </View>
                )}

                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />

                <Text style={[styles.menuSectionTitle, { color: colors.textSecondary, marginTop: 5 }]}>Моя активность</Text>

                <TouchableOpacity 
                  style={styles.menuItem} 
                  onPress={() => {
                    setSettingsVisible(false);
                    navigation.navigate('MyLikes');
                  }}
                >
                  <Icon name="heart-outline" size={22} color={colors.error} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Понравилось</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.menuItem} 
                  onPress={() => {
                    setSettingsVisible(false);
                    navigation.navigate('MyReviews');
                  }}
                >
                  <Icon name="star-outline" size={22} color="#FFD700" />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Мои отзывы</Text>
                </TouchableOpacity>

                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />




                
                <Text style={[styles.menuSectionTitle, { color: colors.textSecondary, marginTop: 5 }]}>О приложении</Text>
                
                <TouchableOpacity 
                  style={styles.menuItem} 
                  onPress={() => {
                    setSettingsVisible(false);
                    navigation.navigate('WebView', { 
                      url: `${API_BASE_URL}/terms`, 
                      title: 'Правила использования' 
                    });
                  }}
                >
                  <Icon name="document-text-outline" size={22} color={colors.textSecondary} />
                  <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>Правила использования</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.menuItem} 
                  onPress={() => {
                    setSettingsVisible(false);
                    navigation.navigate('WebView', { 
                      url: `${API_BASE_URL}/privacy-policy`, 
                      title: 'Политика конфиденциальности' 
                    });
                  }}
                >
                  <Icon name="shield-outline" size={22} color={colors.textSecondary} />
                  <Text style={[styles.menuItemText, { color: colors.textSecondary }]}>Политика конфиденциальности</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.menuItem, { marginTop: 10 }]} 
                  onPress={handleLogout}
                >
                  <Icon name="log-out-outline" size={22} color={colors.error} />
                  <Text style={[styles.menuItemText, { color: colors.error }]}>Выйти из аккаунта</Text>
                </TouchableOpacity>
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

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
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Публикации</Text>
          <TouchableOpacity onPress={() => navigation.navigate('CreatePost')}>
            <Icon name="add-circle-outline" size={28} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {posts.length > 0 ? (
          posts.map((item) => renderPostItem(item))
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>У вас пока нет публикаций</Text>
        )}
      </View>

      {/* Модальное окно комментариев к публикации */}
      <Modal
        visible={commentsVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setCommentsVisible(false)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalOverlay}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.surface, maxHeight: '80%' }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Комментарии</Text>
              <TouchableOpacity onPress={() => setCommentsVisible(false)}>
                <Icon name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {loadingComments ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ margin: 30 }} />
            ) : (
              <ScrollView style={styles.commentsList}>
                {postComments.length === 0 ? (
                  <Text style={[styles.emptyCommentsText, { color: colors.textSecondary }]}>
                    Пока нет комментариев
                  </Text>
                ) : (
                  postComments.map((c) => {
                    const cAuthorName = c.user
                      ? `${c.user.first_name || ''} ${c.user.last_name || ''}`.trim() || 'Пользователь'
                      : 'Пользователь';
                    const canDelete =
                      currentUser &&
                      (currentUser.id === c.user_id ||
                        currentUser.id === activePostForComments?.user_id ||
                        ['admin', 'owner'].includes(currentUser.role));

                    return (
                      <View
                        key={c.id}
                        style={[styles.commentItem, { borderBottomColor: colors.border }]}
                      >
                        <Image
                          source={{
                            uri: getFullUrl(c.user?.avatar_url || c.avatar_url) || 'https://via.placeholder.com/32',
                          }}
                          style={styles.commentAvatar}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={styles.commentHeaderRow}>
                            <Text style={[styles.commentAuthorName, { color: colors.text }]}>
                              {cAuthorName}
                            </Text>
                            {canDelete && (
                              <TouchableOpacity onPress={() => handleDeleteComment(c.id)}>
                                <Icon name="trash-outline" size={14} color={colors.error || '#e53935'} />
                              </TouchableOpacity>
                            )}
                          </View>
                          <Text style={[styles.commentText, { color: colors.text }]}>{c.comment}</Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}

            <View style={[styles.commentInputRow, { borderTopColor: colors.border }]}>
              <TextInput
                style={[
                  styles.commentInput,
                  { backgroundColor: colors.background, color: colors.text, borderColor: colors.border },
                ]}
                placeholder="Написать комментарий..."
                placeholderTextColor={colors.textSecondary}
                value={newCommentText}
                onChangeText={setNewCommentText}
              />
              <TouchableOpacity
                style={[styles.sendCommentBtn, { backgroundColor: colors.primary }]}
                onPress={handleAddComment}
                disabled={submittingComment}
              >
                {submittingComment ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="send" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', padding: 25, borderBottomWidth: 1, borderColor: '#eee' },
  avatarContainer: { position: 'relative', marginBottom: 15 },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#fff', ...getShadow('#000', { width: 0, height: 4 }, 0.2, 5, 5) },
  roleBadge: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff' },
  name: { fontSize: 22, fontWeight: '800', marginBottom: 20 },
  statsContainer: { flexDirection: 'row', width: '100%', marginTop: 10, paddingHorizontal: 10 },
  statItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 5 },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 2 },
  role: { color: 'gray' },
  productionActionsRow: { flexDirection: 'row', marginTop: 15 },
  hierarchyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginLeft: 10,
  },
  hierarchyBtnText: { marginLeft: 8, fontWeight: '600' },
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
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#34C759',
    padding: 15,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  updateBannerTextContainer: {
    flex: 1,
    marginLeft: 15,
  },
  updateBannerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  updateBannerSubtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
  },
  updateBannerWrapper: {
    position: 'relative',
    marginHorizontal: 10,
    marginTop: 10,
  },
  closeBannerButton: {
    position: 'absolute',
    top: 5,
    right: 5,
    padding: 5,
    zIndex: 10,
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
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
  },
  postInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  privacySelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  privacyOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginHorizontal: 3,
  },
  privacyOptionText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  publishButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publishButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
  postMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  privacyText: {
    fontSize: 10,
    marginLeft: 3,
  },
  postContentText: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  postMedia: {
    width: '100%',
    height: 200,
    marginVertical: 4,
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
