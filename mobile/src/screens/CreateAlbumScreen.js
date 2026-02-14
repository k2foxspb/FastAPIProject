import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, Switch } from 'react-native';
import { usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function CreateAlbumScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите название альбома');
      return;
    }

    setLoading(true);
    try {
      await usersApi.createAlbum({ title, description, is_private: isPrivate });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось создать альбом');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.label, { color: colors.text }]}>Название альбома</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Введите название"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={[styles.label, { color: colors.text }]}>Описание</Text>
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Введите описание (необязательно)"
        placeholderTextColor={colors.textSecondary}
        multiline
        numberOfLines={4}
      />

      <View style={[styles.switchContainer, { borderBottomColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>Приватный альбом</Text>
        <Switch
          value={isPrivate}
          onValueChange={setIsPrivate}
          trackColor={{ false: colors.border, true: colors.primary + '80' }}
          thumbColor={isPrivate ? colors.primary : '#f4f3f4'}
        />
      </View>

      <TouchableOpacity 
        style={[styles.button, { backgroundColor: colors.primary }, loading && styles.disabled]} 
        onPress={handleCreate}
        disabled={loading}
      >
        <Text style={styles.buttonText}>{loading ? 'Создание...' : 'Создать альбом'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    fontSize: 16,
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  button: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  disabled: { opacity: 0.5 },
});
