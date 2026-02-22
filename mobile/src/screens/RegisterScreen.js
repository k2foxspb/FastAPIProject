import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons as Icon } from '@expo/vector-icons';
import { usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function RegisterScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Ошибка', 'Нужен доступ к галерее для выбора аватарки');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setAvatar(result.assets[0]);
    }
  };

  const onRegister = async () => {
    if (!email || !password || !firstName || !lastName) {
      Alert.alert('Ошибка', 'Заполните все обязательные поля');
      return;
    }
    
    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('email', email);
      formData.append('password', password);
      formData.append('first_name', firstName);
      formData.append('last_name', lastName);
      formData.append('role', 'buyer');

      if (avatar) {
        const uri = avatar.uri;
        const filename = uri.split('/').pop() || 'avatar.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image/jpeg`;
        
        formData.append('avatar', {
          uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
          name: filename,
          type,
        });
      }

      await usersApi.register(formData);
      
      Alert.alert(
        'Успех',
        'Регистрация прошла успешно! Пожалуйста, проверьте свою электронную почту для подтверждения аккаунта.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
      );
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Не удалось зарегистрироваться';
      Alert.alert('Ошибка регистрации', String(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.inner}>
          <Text style={[styles.title, { color: colors.text }]}>Регистрация</Text>
          
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            placeholder="Email"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            placeholder="Пароль"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            placeholder="Имя"
            placeholderTextColor={colors.textSecondary}
            value={firstName}
            onChangeText={setFirstName}
          />

          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
            placeholder="Фамилия"
            placeholderTextColor={colors.textSecondary}
            value={lastName}
            onChangeText={setLastName}
          />

          <View style={styles.avatarContainer}>
            <Text style={[styles.label, { color: colors.text }]}>Аватарка</Text>
            <TouchableOpacity 
              style={[styles.avatarPicker, { backgroundColor: colors.surface, borderColor: colors.border }]} 
              onPress={pickImage}
            >
              {avatar ? (
                <Image source={{ uri: avatar.uri }} style={styles.avatarPreview} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Icon name="camera-outline" size={40} color={colors.textSecondary} />
                  <Text style={{ color: colors.textSecondary, marginTop: 8 }}>Выбрать фото</Text>
                </View>
              )}
              {avatar && (
                <TouchableOpacity style={styles.removeAvatar} onPress={() => setAvatar(null)}>
                  <Icon name="close-circle" size={24} color={colors.error} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={[styles.button, { backgroundColor: colors.primary }, loading && styles.buttonDisabled]} 
            onPress={onRegister} 
            disabled={loading}
          >
            <Text style={styles.buttonText}>{loading ? 'Регистрация...' : 'Зарегистрироваться'}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>Уже есть аккаунт? Войти</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 32, textAlign: 'center' },
  input: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, fontSize: 16 },
  avatarContainer: { marginBottom: 24, alignItems: 'center' },
  avatarPicker: { width: 120, height: 120, borderRadius: 60, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', position: 'relative' },
  avatarPreview: { width: '100%', height: '100%' },
  avatarPlaceholder: { alignItems: 'center' },
  removeAvatar: { position: 'absolute', top: 0, right: 0, backgroundColor: '#fff', borderRadius: 12 },
  label: { fontSize: 16, marginBottom: 12, fontWeight: '500', alignSelf: 'flex-start' },
  button: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { fontSize: 16, fontWeight: '600' },
});
