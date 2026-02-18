import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Image, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import { newsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons as Icon } from '@expo/vector-icons';

export default function EditNewsScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const newsItem = route.params?.newsItem;
  const isEditing = !!newsItem;

  const [title, setTitle] = useState(newsItem?.title || '');
  const [content, setContent] = useState(newsItem?.content || '');
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const richText = useRef(null);

  useEffect(() => {
    navigation.setOptions({
      title: isEditing ? 'Редактировать новость' : 'Создать новость'
    });
  }, [isEditing, navigation]);

  const handleSave = async () => {
    if (!title || !content) {
      Alert.alert('Ошибка', 'Заполните все поля');
      return;
    }

    if (title.length < 3) {
      Alert.alert('Ошибка', 'Заголовок должен содержать минимум 3 символа');
      return;
    }

    if (content.length < 10) {
      Alert.alert('Ошибка', 'Текст новости должен содержать минимум 10 символов');
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('content', content);
      
      if (images.length > 0) {
        images.forEach((img, index) => {
          const uri = img.uri;
          const uriParts = uri.split('.');
          const fileType = uriParts[uriParts.length - 1];
          const fileName = uri.split('/').pop();
          formData.append('images', {
            uri: uri,
            name: fileName || `news_${index}.${fileType}`,
            type: `image/${fileType}`,
          });
        });
      }

      if (isEditing) {
        // NewsUpdate в схеме ожидает JSON, а мы шлем FormData. 
        // Если бэкенд update_news не переделан под FormData, это может не сработать.
        // Но обычно PUT/PATCH с файлами это сложно. Пока оставим как есть или переделаем только создание.
        // В текущем бэкенде update_news принимает NewsUpdate (BaseModel).
        await newsApi.updateNews(newsItem.id, { title, content });
        Alert.alert('Успех', 'Новость обновлена');
      } else {
        await newsApi.createNews(formData);
        Alert.alert('Успех', 'Новость создана и отправлена на модерацию');
      }
      navigation.goBack();
    } catch (err) {
      console.error(err);
      let errorMessage = 'Не удалось сохранить новость';
      if (err.response?.status === 422) {
        const details = err.response.data?.detail;
        if (Array.isArray(details)) {
          errorMessage = details.map(d => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join('\n');
        }
      }
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить эту новость?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await newsApi.deleteNews(newsItem.id);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить новость');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      setImages([...images, ...result.assets]);
    }
  };

  const removeImage = (index) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    setImages(newImages);
  };

  const handleInsertImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setLoading(true);
      try {
        const img = result.assets[0];
        const formData = new FormData();
        const uri = img.uri;
        const uriParts = uri.split('.');
        const fileType = uriParts[uriParts.length - 1];
        const fileName = uri.split('/').pop();
        
        formData.append('file', {
          uri: uri,
          name: fileName || `news_media_${Date.now()}.${fileType}`,
          type: `image/${fileType}`,
        });

        const response = await newsApi.uploadMedia(formData);
        const imageUrl = response.data.url;
        richText.current?.insertImage(imageUrl);
      } catch (err) {
        console.error(err);
        Alert.alert('Ошибка', 'Не удалось загрузить изображение');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={{ flex: 1 }}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Обложка новости (миниатюры)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesScroll}>
          {images.map((img, index) => (
            <View key={index} style={styles.imageWrapper}>
              <Image source={{ uri: img.uri }} style={styles.imageThumb} />
              <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeImage(index)}>
                <Icon name="close-circle" size={24} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={[styles.addImageBtn, { borderColor: colors.border }]} onPress={pickImages}>
            <Icon name="camera-outline" size={30} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 10 }}>Добавить</Text>
          </TouchableOpacity>
        </ScrollView>

        <Text style={[styles.label, { color: colors.text }]}>Заголовок</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Введите заголовок"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>Текст новости</Text>
        <View style={[styles.editorContainer, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <RichToolbar
            editor={richText}
            actions={[
              actions.setBold,
              actions.setItalic,
              actions.insertBulletsList,
              actions.insertOrderedList,
              actions.insertLink,
              actions.insertImage,
              actions.undo,
              actions.redo,
            ]}
            onPressAddImage={handleInsertImage}
            iconTint={colors.text}
            selectedIconTint={colors.primary}
            style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border }}
          />
          <RichEditor
            ref={richText}
            initialContentHTML={content}
            onChange={setContent}
            placeholder="Введите текст новости..."
            editorStyle={{
              backgroundColor: colors.card,
              color: colors.text,
              placeholderColor: colors.textSecondary,
              contentCSSText: 'font-size: 16px;',
            }}
            style={styles.richEditor}
          />
        </View>

        <TouchableOpacity 
          style={[styles.saveButton, { backgroundColor: colors.primary }]} 
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
        </TouchableOpacity>

        {isEditing && (
          <TouchableOpacity 
            style={[styles.deleteButton, { borderColor: colors.error }]} 
            onPress={handleDelete}
            disabled={loading}
          >
            <Text style={[styles.deleteButtonText, { color: colors.error }]}>Удалить</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 16 },
  imagesScroll: { marginBottom: 20 },
  imageWrapper: { marginRight: 15, position: 'relative' },
  imageThumb: { width: 80, height: 80, borderRadius: 8 },
  removeImageBtn: { position: 'absolute', top: -10, right: -10, backgroundColor: '#fff', borderRadius: 12 },
  addImageBtn: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  editorContainer: { borderWidth: 1, borderRadius: 8, marginBottom: 20, overflow: 'hidden', minHeight: 300 },
  richEditor: { flex: 1, minHeight: 250 },
  saveButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  deleteButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, borderWidth: 1 },
  deleteButtonText: { fontSize: 16, fontWeight: 'bold' },
});
