import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

const { width } = Dimensions.get('window');
const columnCount = 3;
const gap = 2;
const itemSize = (width - (columnCount - 1) * gap) / columnCount;

export default function UserMediaScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { userId, initialUser, isOwner } = route.params;
  const [user, setUser] = useState(initialUser || null);
  const [loading, setLoading] = useState(!initialUser);

  const fetchUser = useCallback(async () => {
    try {
      const res = await usersApi.getUser(userId);
      setUser(res.data);
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchUser();
    }, [fetchUser])
  );

  if (loading || !user) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Загрузка...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Альбомы</Text>
        {isOwner && (
          <TouchableOpacity 
            style={[styles.albumItem, { borderBottomColor: colors.border }]}
            onPress={() => navigation.navigate('CreateAlbum')}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.albumIconPlaceholder, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Icon name="add" size={24} color={colors.primary} />
              </View>
              <Text style={[styles.albumTitle, { color: colors.primary, marginLeft: 15 }]}>Создать альбом</Text>
            </View>
          </TouchableOpacity>
        )}
        {user.albums && user.albums.length > 0 ? (
          user.albums.map(album => (
            <TouchableOpacity 
              key={album.id} 
              style={[styles.albumItem, { borderBottomColor: colors.border }]}
              onPress={() => navigation.navigate('AlbumDetail', { albumId: album.id, isOwner })}
            >
              <View style={styles.albumInfo}>
                <Text style={[styles.albumTitle, { color: colors.text }]}>{album.title}</Text>
                <Text style={[styles.albumCount, { color: colors.textSecondary }]}>
                  {album.photos?.length || 0} фото
                </Text>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ))
        ) : (
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Нет альбомов</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Фотографии и видео</Text>
        <View style={styles.photoGrid}>
          {isOwner && (
            <TouchableOpacity 
              onPress={() => navigation.navigate('UploadPhoto')}
              style={[styles.gridPhoto, styles.addMediaBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Icon name="camera-outline" size={32} color={colors.primary} />
            </TouchableOpacity>
          )}
          {user.photos && user.photos.length > 0 ? (
            user.photos.map(photo => {
              const isVideo = photo.image_url && ['mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm'].includes(photo.image_url.split('.').pop().toLowerCase());
              return (
                <TouchableOpacity 
                  key={photo.id} 
                  onPress={() => navigation.navigate('PhotoDetail', { 
                    photoId: photo.id,
                    initialPhotos: user.photos,
                    isOwner: isOwner
                  })}
                  style={{ position: 'relative' }}
                >
                  <Image 
                    source={{ uri: getFullUrl(photo.preview_url || photo.image_url) }} 
                    style={styles.gridPhoto} 
                  />
                  {isVideo && (
                    <View style={styles.videoBadge}>
                      <Icon name="play" size={16} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          ) : (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Нет фотографий</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: { paddingVertical: 15 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginHorizontal: 15, marginBottom: 15 },
  albumItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 15, 
    borderBottomWidth: 1 
  },
  albumInfo: { flex: 1 },
  albumTitle: { fontSize: 16, fontWeight: '500' },
  albumCount: { fontSize: 14, marginTop: 4 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridPhoto: { width: itemSize, height: itemSize, margin: gap / 2 },
  videoBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12,
    padding: 4,
  },
  emptyText: { marginHorizontal: 15, fontStyle: 'italic' },
  addMediaBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
  },
  albumIconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
});
