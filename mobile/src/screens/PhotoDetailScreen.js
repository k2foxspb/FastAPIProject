import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Alert, TextInput, ScrollView, Picker } from 'react-native';
import { usersApi } from '../api';
import Icon from 'react-native-vector-icons/Ionicons';

export default function PhotoDetailScreen({ route, navigation }) {
  const { photoId } = route.params;
  const [photo, setPhoto] = useState(null);
  const [albums, setAlbums] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [albumId, setAlbumId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [photoId]);

  const fetchData = async () => {
    try {
      const [photoRes, albumsRes] = await Promise.all([
        usersApi.getPhoto(photoId),
        usersApi.getAlbums()
      ]);
      setPhoto(photoRes.data);
      setDescription(photoRes.data.description || '');
      setAlbumId(photoRes.data.album_id);
      setAlbums(albumsRes.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить данные фотографии');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    try {
      await usersApi.updatePhoto(photoId, { description, album_id: albumId });
      setIsEditing(false);
      fetchData();
      Alert.alert('Успех', 'Фотография обновлена');
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось обновить фотографию');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Удаление фотографии',
      'Вы уверены, что хотите удалить эту фотографию?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await usersApi.deletePhoto(photoId);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить фотографию');
            }
          }
        }
      ]
    );
  };

  if (loading || !photo) {
    return (
      <View style={styles.center}>
        <Text>Загрузка...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Image source={{ uri: photo.image_url }} style={styles.fullPhoto} resizeMode="contain" />
      
      <View style={styles.info}>
        {isEditing ? (
          <View style={styles.editForm}>
            <Text style={styles.label}>Описание:</Text>
            <TextInput
              style={styles.input}
              value={description}
              onChangeText={setDescription}
              placeholder="Введите описание"
              multiline
            />
            
            <Text style={styles.label}>Альбом:</Text>
            <View style={styles.pickerContainer}>
              {/* Используем простой текст, если нет Picker в стандартной поставке, но обычно он есть */}
              {albums.map(album => (
                <TouchableOpacity 
                  key={album.id} 
                  style={[styles.albumOption, albumId === album.id && styles.albumSelected]}
                  onPress={() => setAlbumId(album.id)}
                >
                  <Text style={albumId === album.id ? styles.albumTextSelected : null}>{album.title}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity 
                style={[styles.albumOption, albumId === null && styles.albumSelected]}
                onPress={() => setAlbumId(null)}
              >
                <Text style={albumId === null ? styles.albumTextSelected : null}>Без альбома</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.btn, styles.saveBtn]} onPress={handleUpdate}>
                <Text style={styles.btnText}>Сохранить</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.cancelBtn]} onPress={() => setIsEditing(false)}>
                <Text style={styles.btnText}>Отмена</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.description}>{photo.description || 'Нет описания'}</Text>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => setIsEditing(true)}>
                  <Icon name="create-outline" size={24} color="#007AFF" />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDelete} style={{ marginLeft: 15 }}>
                  <Icon name="trash-outline" size={24} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.date}>Добавлено: {new Date(photo.created_at).toLocaleDateString()}</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  fullPhoto: { width: '100%', height: 400 },
  info: { padding: 20, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, minHeight: 300 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  description: { fontSize: 18, flex: 1, marginRight: 10 },
  actions: { flexDirection: 'row' },
  date: { color: '#999', marginTop: 10 },
  editForm: { width: '100' },
  label: { fontWeight: 'bold', marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 10, marginBottom: 10 },
  pickerContainer: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 },
  albumOption: { padding: 8, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, marginRight: 10, marginBottom: 10 },
  albumSelected: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  albumTextSelected: { color: '#fff' },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  btn: { padding: 10, borderRadius: 5, marginLeft: 10, minWidth: 80, alignItems: 'center' },
  saveBtn: { backgroundColor: '#4CD964' },
  cancelBtn: { backgroundColor: '#8E8E93' },
  btnText: { color: '#fff', fontWeight: 'bold' },
});
