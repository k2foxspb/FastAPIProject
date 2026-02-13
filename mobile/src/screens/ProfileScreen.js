import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, FlatList, ScrollView } from 'react-native';
import { usersApi } from '../api';

export default function ProfileScreen() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    usersApi.getMe().then(res => setUser(res.data)).catch(err => console.log(err));
  }, []);

  if (!user) return <View style={styles.center}><Text>Загрузка...</Text></View>;

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
        <Text style={styles.sectionTitle}>Альбомы</Text>
        {user.albums && user.albums.map(album => (
          <View key={album.id} style={styles.album}>
            <Text style={styles.albumTitle}>{album.title}</Text>
            <FlatList
              horizontal
              data={album.photos}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <Image source={{ uri: item.image_url }} style={styles.photo} />
              )}
            />
          </View>
        ))}
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
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  album: { marginBottom: 20 },
  albumTitle: { fontSize: 16, marginBottom: 5 },
  photo: { width: 100, height: 100, marginRight: 10, borderRadius: 5 },
});
