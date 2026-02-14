import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api, { usersApi } from '../api';
import Icon from 'react-native-vector-icons/Ionicons';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);

  useFocusEffect(
    useCallback(() => {
      // Если токена нет в заголовках axios, сразу редиректим
      if (!api.defaults.headers.common['Authorization']) {
        navigation.replace('Login');
        return;
      }

      usersApi
        .getMe()
        .then(res => setUser(res.data))
        .catch(err => {
          const status = err?.response?.status;
          if (status === 401) {
            // Не авторизован — отправляем на экран входа
            navigation.replace('Login');
          } else {
            setError('Не удалось загрузить профиль');
            console.log(err);
          }
        });
    }, [navigation])
  );

  if (!user) return (
    <View style={styles.center}>
      <Text>{error || 'Загрузка...'}</Text>
    </View>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Image 
          source={{ uri: user.avatar_url || 'https://via.placeholder.com/150' }} 
          style={styles.avatar} 
        />
        <Text style={styles.name}>{user.email}</Text>
        <Text style={styles.role}>{user.role}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Альбомы</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => navigation.navigate('UploadPhoto')} style={{ marginRight: 15 }}>
              <Icon name="camera-outline" size={28} color="#007AFF" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('CreateAlbum')}>
              <Icon name="add-circle-outline" size={28} color="#007AFF" />
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
              <Text style={styles.albumTitle}>{album.title}</Text>
              <Icon name="chevron-forward" size={20} color="#ccc" />
            </View>
            <FlatList
              horizontal
              data={album.photos}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => navigation.navigate('PhotoDetail', { photoId: item.id })}>
                  <Image source={{ uri: item.preview_url || item.image_url }} style={styles.photo} />
                </TouchableOpacity>
              )}
              showsHorizontalScrollIndicator={false}
            />
          </TouchableOpacity>
        ))}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Все фотографии</Text>
        <View style={styles.photoGrid}>
          {user.photos && user.photos.map(photo => (
            <TouchableOpacity 
              key={photo.id} 
              onPress={() => navigation.navigate('PhotoDetail', { photoId: photo.id })}
            >
              <Image source={{ uri: photo.preview_url || photo.image_url }} style={styles.gridPhoto} />
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
});
