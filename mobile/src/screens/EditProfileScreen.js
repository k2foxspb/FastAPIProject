import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Image, Alert, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { usersApi } from '../api';
import { getFullUrl } from '../utils/urlHelper';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function EditProfileScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { user } = route.params;
  const [email, setEmail] = useState(user.email);
  const [firstName, setFirstName] = useState(user.first_name || '');
  const [lastName, setLastName] = useState(user.last_name || '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status || '');
  const [avatar, setAvatar] = useState(null);
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
    setLoading(true);
    try {
      const formData = new FormData();
      if (email !== user.email) formData.append('email', email);
      if (firstName !== (user.first_name || '')) formData.append('first_name', firstName);
      if (lastName !== (user.last_name || '')) formData.append('last_name', lastName);
      if (role !== user.role) formData.append('role', role);
      if (status !== user.status) formData.append('status', status);
      
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
      Alert.alert('Успех', 'Профиль обновлен');
      navigation.goBack();
    } catch (err) {
      console.error(err);
      Alert.alert('Ошибка', 'Не удалось обновить профиль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={pickImage}>
          <Image 
            source={{ uri: avatar ? avatar.uri : getFullUrl(user.avatar_url) || 'https://via.placeholder.com/150' }} 
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

        <Text style={[styles.label, { color: colors.textSecondary }]}>Статус</Text>
        <TextInput 
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          value={status}
          onChangeText={setStatus}
          placeholder="Статус"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Роль</Text>
        <View style={styles.roleContainer}>
          {['buyer', 'seller'].map(r => (
            <TouchableOpacity 
              key={r} 
              style={[
                styles.roleButton, 
                { borderColor: colors.border },
                role === r && { backgroundColor: colors.primary, borderColor: colors.primary }
              ]}
              onPress={() => setRole(r)}
            >
              <Text style={[
                styles.roleText, 
                { color: colors.textSecondary },
                role === r && { color: '#fff' }
              ]}>
                {r === 'buyer' ? 'Покупатель' : 'Продавец'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity 
          style={[styles.saveButton, { backgroundColor: colors.primary }, loading && styles.disabled]} 
          onPress={handleSave}
          disabled={loading}
        >
          <Text style={styles.saveButtonText}>{loading ? 'Сохранение...' : 'Сохранить изменения'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
  label: { fontSize: 14, marginBottom: 5, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 20
  },
  roleContainer: { flexDirection: 'row', marginBottom: 30 },
  roleButton: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
    marginRight: 10,
    alignItems: 'center'
  },
  roleText: { fontWeight: '500' },
  saveButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10
  },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  disabled: { opacity: 0.5 }
});
