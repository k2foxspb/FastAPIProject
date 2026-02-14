import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image, FlatList, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api';
import Icon from 'react-native-vector-icons/Ionicons';

export default function UserProfileScreen({ route, navigation }) {
  const { userId } = route.params;
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const res = await usersApi.getUser(userId);
      setUser(res.data);
      setError(null);
    } catch (err) {
      setError('Не удалось загрузить профиль пользователя');
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

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );

  if (error || !user) return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{error || 'Пользователь не найден'}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={fetchUser}>
        <Text style={styles.retryText}>Повторить</Text>
      </TouchableOpacity>
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
        
        <TouchableOpacity 
          style={styles.messageBtn}
          onPress={() => navigation.navigate('Messages', { 
            screen: 'Chat', 
            params: { userId: user.id, userName: user.email } 
          })}
        >
          <Icon name="chatbubble-ellipses-outline" size={20} color="#fff" />
          <Text style={styles.messageBtnText}>Написать сообщение</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Альбомы ({user.albums?.length || 0})</Text>
        {user.albums && user.albums.map(album => (
          <View key={album.id} style={styles.album}>
            <Text style={styles.albumTitle}>{album.title}</Text>
            <FlatList
              horizontal
              data={album.photos}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <Image source={{ uri: item.preview_url || item.image_url }} style={styles.photo} />
              )}
              showsHorizontalScrollIndicator={false}
            />
          </View>
        ))}

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Все фотографии ({user.photos?.length || 0})</Text>
        <View style={styles.photoGrid}>
          {user.photos && user.photos.map(photo => (
            <Image 
              key={photo.id} 
              source={{ uri: photo.preview_url || photo.image_url }} 
              style={styles.gridPhoto} 
            />
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
  role: { color: 'gray', marginBottom: 15 },
  messageBtn: { 
    flexDirection: 'row', 
    backgroundColor: '#007AFF', 
    paddingHorizontal: 20, 
    paddingVertical: 10, 
    borderRadius: 20,
    alignItems: 'center'
  },
  messageBtnText: { color: '#fff', marginLeft: 8, fontWeight: '600' },
  section: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  album: { marginBottom: 20 },
  albumTitle: { fontSize: 16, fontWeight: '500', marginBottom: 8 },
  photo: { width: 100, height: 100, marginRight: 10, borderRadius: 5 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridPhoto: { width: 100, height: 100, margin: 5, borderRadius: 5 },
  errorText: { color: 'red', marginBottom: 10 },
  retryBtn: { padding: 10, backgroundColor: '#007AFF', borderRadius: 5 },
  retryText: { color: '#fff' }
});
