import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
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
  const inputRef = useRef(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });

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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

  const applyFormatting = (tag) => {
    const { start, end } = selection;
    const selectedText = content.substring(start, end);
    let newText;
    if (tag === 'bold') {
      newText = content.substring(0, start) + `**${selectedText}**` + content.substring(end);
    } else if (tag === 'italic') {
      newText = content.substring(0, start) + `*${selectedText}*` + content.substring(end);
    }
    setContent(newText);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Фотографии</Text>
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

        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: colors.text }]}>Текст новости</Text>
          <View style={styles.formattingButtons}>
            <TouchableOpacity onPress={() => applyFormatting('bold')} style={styles.formatBtn}>
              <Icon name="text" size={20} color={colors.primary} />
              <Text style={{ fontWeight: 'bold', color: colors.primary }}> B </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => applyFormatting('italic')} style={styles.formatBtn}>
              <Icon name="text" size={20} color={colors.primary} />
              <Text style={{ fontStyle: 'italic', color: colors.primary }}> I </Text>
            </TouchableOpacity>
          </View>
        </View>
        <TextInput
          ref={inputRef}
          style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={content}
          onChangeText={setContent}
          onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
          placeholder="Введите текст новости"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={10}
          textAlignVertical="top"
        />

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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 16 },
  textArea: { height: 250 },
  imagesScroll: { marginBottom: 20 },
  imageWrapper: { marginRight: 15, position: 'relative' },
  imageThumb: { width: 80, height: 80, borderRadius: 8 },
  removeImageBtn: { position: 'absolute', top: -10, right: -10, backgroundColor: '#fff', borderRadius: 12 },
  addImageBtn: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  formattingButtons: { flexDirection: 'row' },
  formatBtn: { flexDirection: 'row', alignItems: 'center', marginLeft: 15, padding: 5, borderWidth: 1, borderRadius: 4, borderColor: '#eee' },
  saveButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  deleteButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, borderWidth: 1 },
  deleteButtonText: { fontSize: 16, fontWeight: 'bold' },
});
