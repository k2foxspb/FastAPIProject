import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, Modal, TouchableWithoutFeedback } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { usersApi, setAuthToken } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useNotifications } from '../context/NotificationContext';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { storage } from '../utils/storage';
import { getFullUrl } from '../utils/urlHelper';
import { formatName } from '../utils/formatters';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const [isSettingsVisible, setSettingsVisible] = useState(false);
  const { disconnect } = useNotifications();
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

  useFocusEffect(
    useCallback(() => {
      // Если токена нет в заголовках axios, сразу редиректим
      if (!api.defaults.headers.common['Authorization']) {
        handleLogout();
        return;
      }

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

      usersApi
        .getMe()
        .then(res => setUser(res.data))
        .catch(err => {
          const status = err?.response?.status;
          if (status === 401) {
            // Не авторизован — отправляем на экран входа
            handleLogout();
          } else {
            setError('Не удалось загрузить профиль');
            console.log(err);
          }
        });
    }, [navigation, colors.text])
  );

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
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Альбомы</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => navigation.navigate('UploadPhoto')} style={{ marginRight: 15 }}>
              <Icon name="camera-outline" size={28} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('CreateAlbum')}>
              <Icon name="add-circle-outline" size={28} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {user.albums && user.albums.map(album => (
          <TouchableOpacity 
            key={album.id} 
            style={styles.album}
            onPress={() => navigation.navigate('AlbumDetail', { albumId: album.id })}
          >
            <View style={styles.albumTitleRow}>
              <Text style={[styles.albumTitle, { color: colors.text }]}>{album.title}</Text>
              <Icon name="chevron-forward" size={20} color={colors.border} />
            </View>
            <FlatList
              horizontal
              data={album.photos}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => navigation.navigate('PhotoDetail', { 
                  photoId: item.id,
                  initialPhotos: album.photos,
                  albumId: album.id,
                  isOwner: true
                })}>
                  <Image source={{ uri: getFullUrl(item.preview_url || item.image_url) }} style={styles.photo} />
                </TouchableOpacity>
              )}
              showsHorizontalScrollIndicator={false}
            />
          </TouchableOpacity>
        ))}

        <Text style={[styles.sectionTitle, { marginTop: 20, color: colors.text }]}>Все фотографии</Text>
        <View style={styles.photoGrid}>
          {user.photos && user.photos.map(photo => (
            <TouchableOpacity 
              key={photo.id} 
              onPress={() => navigation.navigate('PhotoDetail', { 
                photoId: photo.id,
                initialPhotos: user.photos,
                isOwner: true
              })}
            >
              <Image source={{ uri: getFullUrl(photo.preview_url || photo.image_url) }} style={styles.gridPhoto} />
            </TouchableOpacity>
          ))}
        </View>
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
});
