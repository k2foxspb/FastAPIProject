import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator, Platform, Switch, ScrollView } from 'react-native';
import { getShadow } from '../utils/shadowStyles';
import * as ImagePicker from 'expo-image-picker';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function UploadPhotoScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { albumId } = route.params || {};
  const [images, setImages] = useState([]); // Изменено: теперь массив
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Ошибка', 'Нужен доступ к галерее');
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true, // Разрешаем выбор нескольких фото/видео
        quality: 0.8,
      });

      if (!result.canceled) {
        setImages(result.assets); // Сохраняем все выбранные ассеты
      }
    } catch (e) {
      console.log(e);
      Alert.alert('Ошибка', 'Не удалось выбрать фото');
    }
  };

  const handleUpload = async () => {
    if (images.length === 0) {
      Alert.alert('Ошибка', 'Выберите изображение');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    
    images.forEach((image, index) => {
      const uri = image.uri;
      const isVideo = image.type === 'video';
      const defaultExt = isVideo ? 'mp4' : 'jpg';
      const name = uri.split('/').pop() || `media_${index}.${defaultExt}`;
      const match = /\.(\w+)$/.exec(name);
      const ext = match ? match[1] : defaultExt;
      const type = isVideo ? `video/${ext}` : `image/${ext}`;

      formData.append('files', {
        uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
        name,
        type,
      });
    });
    
    if (description) {
      formData.append('description', description);
    }
    if (albumId) {
      formData.append('album_id', albumId.toString());
    }
    formData.append('privacy', privacy);

    try {
      await usersApi.bulkUploadPhotos(formData);
      
      Alert.alert('Успех', `${images.length} медиа загружено`);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить фотографии. ' + (err.message || 'Попробуйте еще раз.'));
    } finally {
      setUploading(false);
    }
  };

  const removeImage = (index) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    setImages(newImages);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.imagePickerContainer}>
        {images.length > 0 ? (
          <View style={styles.imageListContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
              {images.map((img, index) => (
                <View key={index} style={styles.previewWrapper}>
                  <Image source={{ uri: img.uri }} style={styles.previewThumbnail} />
                  {img.type === 'video' && (
                    <View style={styles.videoIndicator}>
                      <Icon name="play" size={20} color="#fff" />
                    </View>
                  )}
                  <TouchableOpacity 
                    style={[styles.removeBadge, { backgroundColor: colors.error }]} 
                    onPress={() => removeImage(index)}
                  >
                    <Icon name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity 
                style={[styles.addMoreBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} 
                onPress={pickImage}
              >
                <Icon name="add" size={30} color={colors.textSecondary} />
              </TouchableOpacity>
            </ScrollView>
          </View>
        ) : (
          <TouchableOpacity 
            style={[styles.imagePicker, { backgroundColor: colors.surface, borderColor: colors.border }]} 
            onPress={pickImage}
          >
            <View style={styles.placeholder}>
              <Icon name="camera-outline" size={50} color={colors.textSecondary} />
              <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>Выбрать фото</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Описание (для всех фото):</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={description}
          onChangeText={setDescription}
          placeholder="О чем эти фото?"
          placeholderTextColor={colors.textSecondary}
          multiline
        />

        <Text style={[styles.label, { color: colors.text }]}>Кто может видеть фото?</Text>
        <View style={styles.privacyContainer}>
          {[
            { label: 'Всем', value: 'public' },
            { label: 'Друзьям', value: 'friends' },
            { label: 'Только мне', value: 'private' },
          ].map((item) => (
            <TouchableOpacity
              key={item.value}
              style={[
                styles.privacyOption,
                { borderColor: colors.border },
                privacy === item.value && { backgroundColor: colors.primary, borderColor: colors.primary }
              ]}
              onPress={() => setPrivacy(item.value)}
            >
              <Text style={[
                styles.privacyText,
                { color: colors.text },
                privacy === item.value && { color: '#fff' }
              ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity 
          style={[styles.uploadBtn, { backgroundColor: colors.primary }, (images.length === 0 || uploading) && styles.disabledBtn]} 
          onPress={handleUpload}
          disabled={images.length === 0 || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadBtnText}>
              {images.length > 1 ? `Загрузить (${images.length})` : 'Загрузить'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  imagePickerContainer: {
    marginBottom: 20,
  },
  imageListContainer: {
    height: 150,
    marginBottom: 20,
  },
  horizontalScroll: {
    flexDirection: 'row',
  },
  previewWrapper: {
    width: 120,
    height: 120,
    marginRight: 10,
    position: 'relative',
  },
  previewThumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  videoIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -15 }, { translateY: -15 }],
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  removeBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    ...getShadow('#000', { width: 0, height: 1 }, 0.2, 1, 2),
  },
  addMoreBtn: {
    width: 120,
    height: 120,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePicker: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 20,
    overflow: 'hidden'
  },
  preview: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center' },
  placeholderText: { marginTop: 10 },
  form: { flex: 1 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    height: 100,
    textAlignVertical: 'top',
    marginBottom: 20,
    fontSize: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  uploadBtn: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  },
  disabledBtn: { opacity: 0.5 },
  uploadBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  privacyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  privacyOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  privacyText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
