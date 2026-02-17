import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { newsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function EditNewsScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const newsItem = route.params?.newsItem;
  const isEditing = !!newsItem;

  const [title, setTitle] = useState(newsItem?.title || '');
  const [content, setContent] = useState(newsItem?.content || '');
  const [loading, setLoading] = useState(false);

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
      if (isEditing) {
        await newsApi.updateNews(newsItem.id, { title, content });
        Alert.alert('Успех', 'Новость обновлена');
      } else {
        await newsApi.createNews({ title, content });
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

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Заголовок</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Введите заголовок"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>Текст новости</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={content}
          onChangeText={setContent}
          placeholder="Введите текст новости"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={6}
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
  textArea: { height: 150 },
  saveButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  deleteButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, borderWidth: 1 },
  deleteButtonText: { fontSize: 16, fontWeight: 'bold' },
});
