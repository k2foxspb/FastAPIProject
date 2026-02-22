import React, { useState } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { usersApi, setAuthToken } from '../api';
import { useNotifications } from '../context/NotificationContext';
import { updateServerFcmToken } from '../utils/notifications';
import { storage } from '../utils/storage';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function LoginScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { connect } = useNotifications();

  const onLogin = async () => {
    if (!username || !password) {
      Alert.alert('Ошибка', 'Введите логин и пароль');
      return;
    }
    try {
      setLoading(true);
      const res = await usersApi.login(username, password);
      const token = res.data?.access_token;
      const refreshToken = res.data?.refresh_token;
      if (!token) {
        throw new Error('Токен не получен');
      }
      
      // Сохраняем токены для будущих сессий
      await storage.saveTokens(token, refreshToken);
      
      setAuthToken(token);
      // Подключаемся к WebSocket уведомлениям
      connect(token);
      // Обновляем FCM токен на сервере сразу после входа
      updateServerFcmToken();
      // После успешного входа заменяем экран на профиль
      navigation.replace('ProfileMain');
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Не удалось выполнить вход';
      Alert.alert('Ошибка входа', String(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>Вход</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          placeholder="Логин или email"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          placeholder="Пароль"
          placeholderTextColor={colors.textSecondary}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }, loading && styles.buttonDisabled]} 
          onPress={onLogin} 
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Входим…' : 'Войти'}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.linkButton} 
          onPress={() => navigation.navigate('Register')}
        >
          <Text style={[styles.linkText, { color: colors.primary }]}>Нет аккаунта? Зарегистрироваться</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 32, textAlign: 'center' },
  input: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, fontSize: 16 },
  button: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 2) },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { fontSize: 16, fontWeight: '600' },
});
