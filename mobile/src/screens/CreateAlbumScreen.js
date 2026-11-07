import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, Platform, ScrollView } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { PrimaryButton } from '../components/journal/common';

export default function CreateAlbumScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState('public');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите название альбома');
      return;
    }

    setLoading(true);
    try {
      await usersApi.createAlbum({ title, description, privacy });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось создать альбом');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={90}
    >
      <ScrollView 
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.label, { color: colors.text }]}>Название альбома</Text>
      <TextInput
        style={[styles.input, { backgroundColor: 'transparent', color: colors.text, borderColor: colors.border }]}
        value={title}
        onChangeText={setTitle}
        placeholder="Введите название"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={[styles.label, { color: colors.text }]}>Описание</Text>
      <TextInput
        style={[styles.input, styles.textArea, { backgroundColor: 'transparent', color: colors.text, borderColor: colors.border }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Введите описание (необязательно)"
        placeholderTextColor={colors.textSecondary}
        multiline
        numberOfLines={4}
      />

      <Text style={[styles.label, { color: colors.text }]}>Кто может видеть альбом?</Text>
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
              { backgroundColor: 'transparent' },
              privacy === item.value && { backgroundColor: `${colors.primary}22`, borderColor: colors.primary }
            ]}
            onPress={() => setPrivacy(item.value)}
          >
            <Text style={[
              styles.privacyText,
              { color: colors.text },
              privacy === item.value && { color: colors.primary }
            ]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      </ScrollView>

      <View style={[styles.stickyFooter, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 15) }]}>
        <PrimaryButton
          title={loading ? 'Создание...' : 'Создать альбом'}
          onPress={handleCreate}
          disabled={loading}
          style={styles.button}
        />
      </View>
    </KeyboardAvoidingView>
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
  stickyFooter: {
    padding: 20,
    borderTopWidth: 1,
  },
  privacyContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
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
  button: {
    marginHorizontal: 0,
    marginTop: 0,
  },
});
