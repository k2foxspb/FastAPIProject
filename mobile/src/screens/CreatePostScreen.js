import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import { Ionicons as Icon } from '@expo/vector-icons';
import { usersApi, newsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function CreatePostScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [content, setContent] = useState('');
  const [privacy, setPrivacy] = useState('public'); // 'public' | 'friends' | 'private'
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const richText = useRef(null);

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets) {
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
          name: fileName || `post_media_${Date.now()}.${fileType || 'jpg'}`,
          type: `image/${fileType || 'jpeg'}`,
        });

        const response = await newsApi.uploadMedia(formData);
        const imageUrl = response.data?.url || response.data?.location;
        if (imageUrl) {
          richText.current?.insertImage(imageUrl);
        }
      } catch (err) {
        console.error('Insert image error:', err);
        Alert.alert('Ошибка', 'Не удалось загрузить изображение');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSave = async () => {
    const trimmedContent = content.trim();
    if (!trimmedContent && images.length === 0) {
      Alert.alert('Ошибка', 'Введите текст публикации или прикрепите изображение');
      return;
    }

    setLoading(true);
    try {
      let mediaUrl = null;
      let mediaType = null;

      // Если есть прикреплённые изображения, загружаем первое как обложку/основное медиа
      if (images.length > 0) {
        const firstImg = images[0];
        const formData = new FormData();
        const uri = firstImg.uri;
        const uriParts = uri.split('.');
        const fileType = uriParts[uriParts.length - 1];
        const fileName = uri.split('/').pop();

        formData.append('file', {
          uri: uri,
          name: fileName || `post_cover_${Date.now()}.${fileType || 'jpg'}`,
          type: `image/${fileType || 'jpeg'}`,
        });

        const uploadRes = await newsApi.uploadMedia(formData);
        mediaUrl = uploadRes.data?.url || uploadRes.data?.location;
        mediaType = 'image';
      }

      await usersApi.createProfilePost({
        content: trimmedContent,
        media_url: mediaUrl,
        media_type: mediaType,
        privacy: privacy,
      });

      Alert.alert('Успех', 'Публикация создана', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      console.error('Create profile post error:', err);
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось создать публикацию');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.form}>
          {/* Изображения / медиафайлы */}
          <Text style={[styles.label, { color: colors.text }]}>Медиафайлы</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesScroll}>
            {images.map((img, index) => (
              <View key={index} style={styles.imageWrapper}>
                <Image source={{ uri: img.uri }} style={styles.imageThumb} />
                <TouchableOpacity
                  style={[styles.removeImageBtn, { backgroundColor: colors.surface }]}
                  onPress={() => removeImage(index)}
                >
                  <Icon name="close-circle" size={24} color={colors.error || '#e53935'} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.addImageBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={pickImages}
            >
              <Icon name="camera-outline" size={28} color={colors.primary} />
              <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>Добавить</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Приватность */}
          <Text style={[styles.label, { color: colors.text }]}>Кто может видеть</Text>
          <View style={styles.privacyRow}>
            <TouchableOpacity
              style={[
                styles.privacyChip,
                { borderColor: colors.border, backgroundColor: privacy === 'public' ? colors.primary : colors.surface },
              ]}
              onPress={() => setPrivacy('public')}
            >
              <Icon name="globe-outline" size={16} color={privacy === 'public' ? '#fff' : colors.text} />
              <Text style={[styles.privacyChipText, { color: privacy === 'public' ? '#fff' : colors.text }]}>
                Все
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.privacyChip,
                { borderColor: colors.border, backgroundColor: privacy === 'friends' ? colors.primary : colors.surface },
              ]}
              onPress={() => setPrivacy('friends')}
            >
              <Icon name="people-outline" size={16} color={privacy === 'friends' ? '#fff' : colors.text} />
              <Text style={[styles.privacyChipText, { color: privacy === 'friends' ? '#fff' : colors.text }]}>
                Друзья
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.privacyChip,
                { borderColor: colors.border, backgroundColor: privacy === 'private' ? colors.primary : colors.surface },
              ]}
              onPress={() => setPrivacy('private')}
            >
              <Icon name="lock-closed-outline" size={16} color={privacy === 'private' ? '#fff' : colors.text} />
              <Text style={[styles.privacyChipText, { color: privacy === 'private' ? '#fff' : colors.text }]}>
                Только я
              </Text>
            </TouchableOpacity>
          </View>

          {/* Текст публикации с редактором */}
          <Text style={[styles.label, { color: colors.text }]}>Текст публикации</Text>
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
              style={{
                backgroundColor: colors.background,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            />
            <RichEditor
              ref={richText}
              initialContentHTML={content}
              onChange={setContent}
              placeholder="Что у вас нового?..."
              editorStyle={{
                backgroundColor: colors.card,
                color: colors.text,
                placeholderColor: colors.textSecondary,
                contentCSSText: 'font-size: 16px;',
              }}
              style={styles.richEditor}
            />
          </View>
        </View>
      </ScrollView>

      {/* Прилипающий футер с кнопкой сохранения над клавиатурой */}
      <View
        style={[
          styles.stickyFooter,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 15),
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Опубликовать</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 20 },
  label: { fontSize: 15, fontWeight: 'bold', marginBottom: 8, marginTop: 10 },
  imagesScroll: { marginBottom: 15 },
  imageWrapper: { marginRight: 12, position: 'relative' },
  imageThumb: { width: 80, height: 80, borderRadius: 8 },
  removeImageBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    borderRadius: 12,
  },
  addImageBtn: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  privacyRow: { flexDirection: 'row', marginBottom: 15 },
  privacyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 10,
  },
  privacyChipText: { fontSize: 13, fontWeight: '600', marginLeft: 6 },
  editorContainer: {
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 20,
    overflow: 'hidden',
    minHeight: 280,
  },
  richEditor: { flex: 1, minHeight: 220 },
  stickyFooter: {
    padding: 15,
    borderTopWidth: 1,
  },
  saveButton: { padding: 15, borderRadius: 8, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
