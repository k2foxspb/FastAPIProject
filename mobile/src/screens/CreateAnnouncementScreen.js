import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  Alert, Platform, Image,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { RichEditor, RichToolbar, actions } from 'react-native-pell-rich-editor';
import { announcementsApi, orgApi, newsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { getRoleScope } from '../constants/roles';

// Экран создания объявления. По умолчанию объявление уходит всем подчинённым
// автора по иерархии, но автор может сузить группу получателей до
// конкретного цеха/участка в пределах своей зоны ответственности
export default function CreateAnnouncementScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState('normal'); // 'normal' | 'important' | 'urgent'
  const [images, setImages] = useState([]);
  const [workshops, setWorkshops] = useState([]);
  const [sections, setSections] = useState([]);
  const [targetWorkshopId, setTargetWorkshopId] = useState(null);
  const [targetSectionId, setTargetSectionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const richText = useRef(null);

  const scope = currentUser ? getRoleScope(currentUser.role) : 'self';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (scope === 'global') {
        const res = await orgApi.getWorkshops();
        setWorkshops(res.data || []);
      } else if (scope === 'workshop' && currentUser?.workshop_id) {
        const res = await orgApi.getSections(currentUser.workshop_id);
        setSections(res.data || []);
      }
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить список цехов/участков');
    } finally {
      setLoading(false);
    }
  }, [scope, currentUser]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const selectWorkshop = async (workshopId) => {
    setTargetWorkshopId(workshopId);
    setTargetSectionId(null);
    setSections([]);
    if (workshopId == null) return;
    try {
      const res = await orgApi.getSections(workshopId);
      setSections(res.data || []);
    } catch (err) {
      // Список участков необязателен - объявление всё равно можно отправить на весь цех
    }
  };

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
      setSaving(true);
      try {
        const img = result.assets[0];
        const formData = new FormData();
        const uri = img.uri;
        const uriParts = uri.split('.');
        const fileType = uriParts[uriParts.length - 1];
        const fileName = uri.split('/').pop();

        formData.append('file', {
          uri: uri,
          name: fileName || `announcement_media_${Date.now()}.${fileType || 'jpg'}`,
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
        setSaving(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите заголовок объявления');
      return;
    }
    if (!content.trim()) {
      Alert.alert('Ошибка', 'Введите текст объявления');
      return;
    }

    setSaving(true);
    try {
      let finalContent = content.trim();

      // Если есть прикреплённые изображения обложки, которые ещё не вставлены в текст, добавляем их
      if (images.length > 0) {
        for (const img of images) {
          const formData = new FormData();
          const uri = img.uri;
          const uriParts = uri.split('.');
          const fileType = uriParts[uriParts.length - 1];
          const fileName = uri.split('/').pop();

          formData.append('file', {
            uri: uri,
            name: fileName || `announcement_img_${Date.now()}.${fileType || 'jpg'}`,
            type: `image/${fileType || 'jpeg'}`,
          });

          const uploadRes = await newsApi.uploadMedia(formData);
          const imgUrl = uploadRes.data?.url || uploadRes.data?.location;
          if (imgUrl && !finalContent.includes(imgUrl)) {
            finalContent = `<p><img src="${imgUrl}" style="max-width:100%; border-radius:8px;" /></p>` + finalContent;
          }
        }
      }

      const payload = {
        title: title.trim(),
        content: finalContent,
        priority: priority,
      };
      if (targetWorkshopId != null) payload.target_workshop_id = targetWorkshopId;
      if (targetSectionId != null) payload.target_section_id = targetSectionId;

      await announcementsApi.createAnnouncement(payload);
      Alert.alert('Готово', 'Объявление опубликовано', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      console.error('Create announcement error:', err);
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось опубликовать объявление');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {/* Медиафайлы */}
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

        {/* Приоритет */}
        <Text style={[styles.label, { color: colors.text }]}>Приоритет</Text>
        <View style={styles.priorityRow}>
          <TouchableOpacity
            style={[
              styles.priorityChip,
              {
                borderColor: colors.border,
                backgroundColor: priority === 'normal' ? colors.primary : colors.surface,
              },
            ]}
            onPress={() => setPriority('normal')}
          >
            <Text style={[styles.priorityChipText, { color: priority === 'normal' ? '#fff' : colors.text }]}>
              Обычный
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.priorityChip,
              {
                borderColor: colors.border,
                backgroundColor: priority === 'important' ? '#f59e0b' : colors.surface,
              },
            ]}
            onPress={() => setPriority('important')}
          >
            <Text style={[styles.priorityChipText, { color: priority === 'important' ? '#fff' : colors.text }]}>
              Важный
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.priorityChip,
              {
                borderColor: colors.border,
                backgroundColor: priority === 'urgent' ? (colors.error || '#e53935') : colors.surface,
              },
            ]}
            onPress={() => setPriority('urgent')}
          >
            <Text style={[styles.priorityChipText, { color: priority === 'urgent' ? '#fff' : colors.text }]}>
              Срочный
            </Text>
          </TouchableOpacity>
        </View>

        {/* Заголовок */}
        <Text style={[styles.label, { color: colors.text }]}>Заголовок</Text>
        <TextInput
          style={[styles.titleInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Короткий заголовок объявления"
          placeholderTextColor={colors.textSecondary}
        />

        {/* Текст объявления с RichEditor */}
        <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Текст объявления</Text>
        <View style={[styles.editorContainer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
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
            placeholder="Введите текст объявления..."
            editorStyle={{
              backgroundColor: colors.surface,
              color: colors.text,
              placeholderColor: colors.textSecondary,
              contentCSSText: 'font-size: 15px;',
            }}
            style={styles.richEditor}
          />
        </View>

        {/* Адресация */}
        {scope === 'global' && (
          <>
            <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Кого оповестить</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, { borderColor: colors.border, backgroundColor: targetWorkshopId == null ? colors.primary : colors.surface }]}
                onPress={() => selectWorkshop(null)}
              >
                <Text style={[styles.chipText, { color: targetWorkshopId == null ? '#fff' : colors.text }]}>Все цеха</Text>
              </TouchableOpacity>
              {workshops.map(w => (
                <TouchableOpacity
                  key={w.id}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: targetWorkshopId === w.id ? colors.primary : colors.surface }]}
                  onPress={() => selectWorkshop(w.id)}
                >
                  <Text style={[styles.chipText, { color: targetWorkshopId === w.id ? '#fff' : colors.text }]}>{w.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {(scope === 'global' || scope === 'workshop') && sections.length > 0 && (targetWorkshopId != null || scope === 'workshop') && (
          <>
            <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Участок (необязательно)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, { borderColor: colors.border, backgroundColor: targetSectionId == null ? colors.primary : colors.surface }]}
                onPress={() => setTargetSectionId(null)}
              >
                <Text style={[styles.chipText, { color: targetSectionId == null ? '#fff' : colors.text }]}>Весь цех</Text>
              </TouchableOpacity>
              {sections.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: targetSectionId === s.id ? colors.primary : colors.surface }]}
                  onPress={() => setTargetSectionId(s.id)}
                >
                  <Text style={[styles.chipText, { color: targetSectionId === s.id ? '#fff' : colors.text }]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {scope === 'section' && (
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Объявление будет отправлено всем сотрудникам вашего участка
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Прилипающий футер */}
      <View
        style={[
          styles.footer,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.surface,
            paddingBottom: Math.max(insets.bottom, 15),
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary }]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitBtnText}>Опубликовать</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 15, paddingBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 10 },
  titleInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  imagesScroll: { marginBottom: 10 },
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
  priorityRow: { flexDirection: 'row', marginBottom: 10 },
  priorityChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  priorityChipText: { fontSize: 13, fontWeight: '600' },
  editorContainer: {
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
    minHeight: 260,
  },
  richEditor: { flex: 1, minHeight: 200 },
  chipRow: { flexDirection: 'row', marginBottom: 5 },
  chip: { borderWidth: 1, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  chipText: { fontSize: 13, fontWeight: '600' },
  infoBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 15 },
  infoText: { fontSize: 13, marginLeft: 8, flex: 1 },
  footer: { padding: 15, borderTopWidth: 1 },
  submitBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
