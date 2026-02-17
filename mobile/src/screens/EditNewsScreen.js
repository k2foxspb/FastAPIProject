import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { newsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function EditNewsScreen({ route, navigation }) {
  const existingNews = route.params?.news;
  const [title, setTitle] = useState(existingNews?.title || '');
  const [content, setContent] = useState(existingNews?.content || '');
  const [loading, setLoading] = useState(false);
  
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const handleSave = async () => {
    if (!title || !content) {
      Alert.alert('Ошибка', 'Заполните заголовок и содержание');
      return;
    }

    try {
      setLoading(true);
      const data = { title, content };
      if (existingNews) {
        await newsApi.updateNews(existingNews.id, data);
      } else {
        await newsApi.createNews(data);
      }
      Alert.alert('Успех', 'Новость сохранена. Она появится в ленте после модерации.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось сохранить новость');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Заголовок</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Введите заголовок"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>Содержание</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={content}
          onChangeText={setContent}
          placeholder="Введите текст новости..."
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={10}
        />

        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }, loading && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Сохранение...' : 'Сохранить'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  textArea: {
    height: 200,
    textAlignVertical: 'top',
  },
  button: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
