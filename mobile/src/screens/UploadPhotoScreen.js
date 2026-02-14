import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, TextInput, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { usersApi } from '../api';
import Icon from 'react-native-vector-icons/Ionicons';

export default function UploadPhotoScreen({ route, navigation }) {
  const { albumId } = route.params || {};
  const [image, setImage] = useState(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Ошибка', 'Нужен доступ к галерее');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      setImage(result.assets[0]);
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
      uri,
      name,
      type,
    });
    
    if (description) {
      formData.append('description', description);
    }
    if (albumId) {
      formData.append('album_id', albumId.toString());
    }

    try {
      await usersApi.uploadPhoto(formData);
      Alert.alert('Успех', 'Фотография загружена');
      navigation.goBack();
    } catch (err) {
      console.log(err);
      Alert.alert('Ошибка', 'Не удалось загрузить фотографию');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
        {image ? (
          <Image source={{ uri: image.uri }} style={styles.preview} />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="camera-outline" size={50} color="#ccc" />
            <Text style={styles.placeholderText}>Выбрать фото</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.form}>
        <Text style={styles.label}>Описание:</Text>
        <TextInput
          style={styles.input}
          value={description}
          onChangeText={setDescription}
          placeholder="О чем это фото?"
          multiline
        />

        <TouchableOpacity 
          style={[styles.uploadBtn, (!image || uploading) && styles.disabledBtn]} 
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
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  imagePicker: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    backgroundColor: '#f8f8f8',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    marginBottom: 20,
    overflow: 'hidden'
  },
  preview: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center' },
  placeholderText: { color: '#999', marginTop: 10 },
  form: { flex: 1 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    height: 100,
    textAlignVertical: 'top',
    marginBottom: 20
  },
  uploadBtn: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center'
  },
  disabledBtn: { backgroundColor: '#ccc' },
  uploadBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});
