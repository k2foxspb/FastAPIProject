import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Image, Alert, ScrollView, Platform } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { usersApi } from '../api';
import { getFullUrl } from '../utils/formatters';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useNotifications } from '../context/NotificationContext';
import { theme as themeConstants } from '../constants/theme';

const toDisplayDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '';
};

const toIsoDate = (text) => {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

const formatDateInput = (text) => {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  let result = digits.slice(0, 2);
  if (digits.length > 2) result += `.${digits.slice(2, 4)}`;
  if (digits.length > 4) result += `.${digits.slice(4)}`;
  return result;
};

export default function EditProfileScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { loadUser } = useNotifications();
  const { user, isInitialSetup } = route.params;
  const [email, setEmail] = useState(user.email || '');
  const [phoneNumber, setPhoneNumber] = useState(user.phone_number || '');
  const [firstName, setFirstName] = useState(user.first_name || '');
  const [lastName, setLastName] = useState(user.last_name || '');
  const [gender, setGender] = useState(user.gender || null);
  const [birthDate, setBirthDate] = useState(toDisplayDate(user.birth_date));
  const [heightCm, setHeightCm] = useState(user.height_cm ? String(user.height_cm) : '');
  const [weightKg, setWeightKg] = useState(user.weight_kg != null ? String(user.weight_kg) : '');
  const [avatar, setAvatar] = useState(null);

  const DEFAULT_AVATARS = {
    male: '/static/avatars/male.jpg',
    female: '/static/avatars/female.jpg',
  };
  const isDefaultAvatar = !user.avatar_url || user.avatar_url.startsWith('/static/avatars/');
  const previewUri = avatar
    ? avatar.uri
    : getFullUrl((isDefaultAvatar && DEFAULT_AVATARS[gender]) || user.avatar_url) || 'https://via.placeholder.com/150';
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setAvatar(result.assets[0]);
    }
  };

  const handleSave = async () => {
    const birthIso = birthDate.trim() ? toIsoDate(birthDate) : null;
    if (birthDate.trim() && !birthIso) {
      Alert.alert('Проверьте дату рождения', 'Введите дату в формате ДД.ММ.ГГГГ');
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      if (email !== (user.email || '')) formData.append('email', email);
      if (phoneNumber !== (user.phone_number || '')) formData.append('phone_number', phoneNumber);
      if (firstName !== (user.first_name || '')) formData.append('first_name', firstName);
      if (lastName !== (user.last_name || '')) formData.append('last_name', lastName);
      if (gender && gender !== (user.gender || null)) formData.append('gender', gender);
      if (birthIso && birthIso !== (user.birth_date || '')) formData.append('birth_date', birthIso);
      const h = heightCm.trim() ? Number(heightCm.replace(',', '.')) : null;
      const w = weightKg.trim() ? Number(weightKg.replace(',', '.')) : null;
      if (h !== null && h !== user.height_cm) formData.append('height_cm', String(Math.round(h)));
      if (w !== null && w !== Number(user.weight_kg)) formData.append('weight_kg', String(w));
      
      // Если данных для обновления нет, просто выходим
      if (formData._parts && formData._parts.length === 0 && !avatar) {
        setLoading(false);
        navigation.goBack();
        return;
      }

      if (avatar) {
        const localUri = avatar.uri;
        const filename = localUri.split('/').pop();
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image`;
        
        formData.append('avatar', { uri: localUri, name: filename, type });
      }

      await usersApi.updateMe(formData);
      await loadUser();
      Alert.alert('Успех', 'Профиль обновлен');
      
      if (isInitialSetup) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'ProfileMain' }],
        });
      } else {
        navigation.goBack();
      }
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось обновить профиль');
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
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={pickImage}>
          <Image 
            source={{ uri: previewUri }} 
            style={styles.avatar} 
          />
          <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
            <Icon name="camera" size={20} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
        <TextInput 
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Телефон</Text>
        <TextInput 
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          placeholder="Телефон"
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Имя</Text>
        <TextInput 
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={firstName}
          onChangeText={setFirstName}
          placeholder="Имя"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Фамилия</Text>
        <TextInput 
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={lastName}
          onChangeText={setLastName}
          placeholder="Фамилия"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Пол</Text>
        <View style={styles.genderRow}>
          {[{ value: 'male', label: 'Мужской' }, { value: 'female', label: 'Женский' }].map((item) => {
            const selected = gender === item.value;
            return (
              <TouchableOpacity
                key={item.value}
                style={[
                  styles.genderOption,
                  { borderColor: colors.border, backgroundColor: selected ? colors.primary : colors.surface },
                ]}
                onPress={() => setGender(item.value)}
              >
                <Text style={{ color: selected ? '#fff' : colors.text, fontWeight: '500' }}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.label, { color: colors.textSecondary }]}>Дата рождения (ДД.ММ.ГГГГ)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={birthDate}
          onChangeText={(t) => setBirthDate(formatDateInput(t))}
          keyboardType="number-pad"
          placeholder="31.01.1990"
          maxLength={10}
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Рост, см (для анализа и рекомендаций ИИ по питанию)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={heightCm}
          onChangeText={(t) => setHeightCm(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder="175"
          placeholderTextColor={colors.textSecondary}
          maxLength={3}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Вес, кг (для анализа и рекомендаций ИИ по питанию)</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={weightKg}
          onChangeText={setWeightKg}
          keyboardType="decimal-pad"
          placeholder="70.5"
          placeholderTextColor={colors.textSecondary}
        />
      </View>
    </ScrollView>
    <View style={[styles.stickyFooter, { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
      <TouchableOpacity 
        style={[styles.saveButton, { backgroundColor: colors.primary }, loading && styles.disabled]} 
        onPress={handleSave}
        disabled={loading}
      >
        <Text style={styles.saveButtonText}>{loading ? 'Сохранение...' : 'Сохранить изменения'}</Text>
      </TouchableOpacity>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', padding: 30 },
  avatar: { width: 120, height: 120, borderRadius: 60 },
  editBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  form: { padding: 20 },
  stickyFooter: {
    padding: 20,
    borderTopWidth: 1,
  },
  label: { fontSize: 14, marginBottom: 5, fontWeight: '500' },
  genderRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  genderOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 20
  },
  saveButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  disabled: { opacity: 0.5 }
});
