import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, Alert, TextInput, ScrollView, Switch } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getFullUrl } from '../utils/urlHelper';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function AlbumDetailScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { albumId } = route.params;
  const [album, setAlbum] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAlbum = useCallback(async () => {
    try {
      const res = await usersApi.getAlbum(albumId);
      setAlbum(res.data);
      setTitle(res.data.title);
      setDescription(res.data.description || '');
      setIsPrivate(res.data.is_private || false);
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
      await usersApi.updateAlbum(albumId, { title, description, is_private: isPrivate });
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
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Загрузка...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {isEditing ? (
          <View style={styles.editForm}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={title}
              onChangeText={setTitle}
              placeholder="Название альбома"
              placeholderTextColor={colors.textSecondary}
            />
            <TextInput
              style={[styles.input, styles.textArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Описание"
              placeholderTextColor={colors.textSecondary}
              multiline
            />
            <View style={styles.switchContainer}>
              <Text style={[styles.labelSmall, { color: colors.text }]}>Приватный альбом</Text>
              <Switch
                value={isPrivate}
                onValueChange={setIsPrivate}
                trackColor={{ false: colors.border, true: colors.primary + '80' }}
                thumbColor={isPrivate ? colors.primary : '#f4f3f4'}
              />
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={handleUpdate}>
                <Text style={styles.btnText}>Сохранить</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: colors.textSecondary }]} onPress={() => setIsEditing(false)}>
                <Text style={styles.btnText}>Отмена</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.text }]}>{album.title}</Text>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => setIsEditing(true)}>
                  <Icon name="create-outline" size={24} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleDelete} style={{ marginLeft: 15 }}>
                  <Icon name="trash-outline" size={24} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
            {album.description ? <Text style={[styles.description, { color: colors.textSecondary }]}>{album.description}</Text> : null}
            {album.is_private ? (
              <View style={styles.privateBadge}>
                <Icon name="lock-closed" size={14} color={colors.textSecondary} />
                <Text style={[styles.privateText, { color: colors.textSecondary }]}>Приватный</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.photoGrid}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Фотографии ({album.photos?.length || 0})</Text>
        <View style={styles.grid}>
          {album.photos?.map(photo => (
            <TouchableOpacity 
              key={photo.id} 
              onPress={() => {
                navigation.navigate('PhotoDetail', { 
                  photoId: photo.id,
                  initialPhotos: album.photos,
                  albumId: album.id,
                  isOwner: true
                });
              }}
            >
              <Image source={{ uri: getFullUrl(photo.preview_url) }} style={styles.photo} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity 
            style={[styles.addPhotoBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => navigation.navigate('UploadPhoto', { albumId: album.id })}
          >
            <Icon name="add" size={40} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 20, borderBottomWidth: 1 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold' },
  actions: { flexDirection: 'row' },
  description: { fontSize: 16, marginTop: 10 },
  privateBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  privateText: { fontSize: 14, marginLeft: 4 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, paddingHorizontal: 20, marginTop: 20 },
  editForm: { width: '100%' },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 16 },
  textArea: { height: 80, textAlignVertical: 'top' },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  labelSmall: { fontSize: 16 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  btn: { padding: 10, borderRadius: 8, marginLeft: 10, minWidth: 80, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  photoGrid: { paddingBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 15 },
  photo: { width: 110, height: 110, margin: 5, borderRadius: 8 },
  addPhotoBtn: { 
    width: 110, 
    height: 110, 
    margin: 5, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderStyle: 'dashed', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
});
