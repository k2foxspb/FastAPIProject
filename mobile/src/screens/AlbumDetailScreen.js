import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, Alert, TextInput, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api';
import Icon from 'react-native-vector-icons/Ionicons';

export default function AlbumDetailScreen({ route, navigation }) {
  const { albumId } = route.params;
  const [album, setAlbum] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchAlbum = useCallback(async () => {
    try {
      const res = await usersApi.getAlbum(albumId);
      setAlbum(res.data);
      setTitle(res.data.title);
      setDescription(res.data.description || '');
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить данные альбома');
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  }, [albumId, navigation]);

  useFocusEffect(
    useCallback(() => {
      fetchAlbum();
    }, [fetchAlbum])
  );

  const handleUpdate = async () => {
    try {
      await usersApi.updateAlbum(albumId, { title, description });
      setIsEditing(false);
      fetchAlbum();
      Alert.alert('Успех', 'Альбом обновлен');
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось обновить альбом');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Удаление альбома',
      'Вы уверены, что хотите удалить этот альбом? Все фотографии в нем также будут удалены.',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            try {
              await usersApi.deleteAlbum(albumId);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить альбом');
            }
          }
        }
      ]
    );
  };

  if (loading || !album) {
    return (
      <View style={styles.center}>
        <Text>Загрузка...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        {isEditing ? (
          <View style={styles.editForm}>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Название альбома"
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Описание"
              multiline
            />
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
              <Text style={styles.title}>{album.title}</Text>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => setIsEditing(true)}>
                  <Icon name="create-outline" size={24} color="#007AFF" />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDelete} style={{ marginLeft: 15 }}>
                  <Icon name="trash-outline" size={24} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            </View>
            {album.description ? <Text style={styles.description}>{album.description}</Text> : null}
          </View>
        )}
      </View>

      <View style={styles.photoGrid}>
        <Text style={styles.sectionTitle}>Фотографии ({album.photos?.length || 0})</Text>
        <View style={styles.grid}>
          {album.photos?.map(photo => (
            <TouchableOpacity 
              key={photo.id} 
              onPress={() => navigation.navigate('PhotoDetail', { photoId: photo.id })}
            >
              <Image source={{ uri: photo.preview_url }} style={styles.photo} />
            </TouchableOpacity>
          ))}
          {/* Кнопка для добавления нового фото */}
          <TouchableOpacity 
            style={styles.addPhotoBtn}
            onPress={() => navigation.navigate('UploadPhoto', { albumId: album.id })}
          >
            <Icon name="add" size={40} color="#ccc" />
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, borderBottomWidth: 1, borderColor: '#eee' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold' },
  actions: { flexDirection: 'row' },
  description: { fontSize: 16, color: '#666', marginTop: 10 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, paddingHorizontal: 20, marginTop: 20 },
  editForm: { width: '100' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 10, marginBottom: 10 },
  textArea: { height: 80, textAlignVertical: 'top' },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  btn: { padding: 10, borderRadius: 5, marginLeft: 10, minWidth: 80, alignItems: 'center' },
  saveBtn: { backgroundColor: '#4CD964' },
  cancelBtn: { backgroundColor: '#8E8E93' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  photoGrid: { paddingBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15 },
  photo: { width: 110, height: 110, margin: 5, borderRadius: 5 },
  addPhotoBtn: { 
    width: 110, 
    height: 110, 
    margin: 5, 
    borderRadius: 5, 
    borderWidth: 1, 
    borderColor: '#ccc', 
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center'
  },
});
