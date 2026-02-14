import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator, Platform, Switch } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { usersApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function UploadPhotoScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { albumId } = route.params || {};
  const [image, setImage] = useState(null);
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Ошибка', 'Нужен доступ к галерее');
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled) {
        setImage(result.assets[0]);
      }
    } catch (e) {
      console.log(e);
      Alert.alert('Ошибка', 'Не удалось выбрать фото');
    }
  };

  const handleUpload = async () => {
    if (!image) {
      Alert.alert('Ошибка', 'Выберите изображение');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    
    // Формируем объект файла для FormData
    const uri = image.uri;
    const name = uri.split('/').pop();
    const match = /\.(\w+)$/.exec(name);
    const type = match ? `image/${match[1]}` : `image`;

    formData.append('file', {
      uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
      name,
      type,
    });
    
    if (description) {
      formData.append('description', description);
    }
    if (albumId) {
      formData.append('album_id', albumId.toString());
    }
    formData.append('is_private', isPrivate.toString());

    try {
      const res = await usersApi.uploadPhoto(formData);
      Alert.alert('Успех', 'Фотография загружена');
      navigation.goBack();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить фотографию. ' + (err.message || 'Попробуйте еще раз.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity 
        style={[styles.imagePicker, { backgroundColor: colors.surface, borderColor: colors.border }]} 
        onPress={pickImage}
      >
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="camera-outline" size={50} color={colors.textSecondary} />
            <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>Выбрать фото</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Описание:</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={description}
          onChangeText={setDescription}
          placeholder="О чем это фото?"
          placeholderTextColor={colors.textSecondary}
          multiline
        />

        <View style={[styles.switchContainer, { borderBottomColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>Приватная фотография</Text>
          <Switch
            value={isPrivate}
            onValueChange={setIsPrivate}
            trackColor={{ false: colors.border, true: colors.primary + '80' }}
            thumbColor={isPrivate ? colors.primary : '#f4f3f4'}
          />
        </View>

        <TouchableOpacity 
          style={[styles.uploadBtn, { backgroundColor: colors.primary }, (!image || uploading) && styles.disabledBtn]} 
          onPress={handleUpload}
          disabled={!image || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadBtnText}>Загрузить</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
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
  uploadBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});
