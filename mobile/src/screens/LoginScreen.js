import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { usersApi, setAuthToken } from '../api';
import { useNotifications } from '../context/NotificationContext';
import { storage } from '../utils/storage';

export default function LoginScreen({ navigation }) {
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
    <View style={styles.container}>
      <Text style={styles.title}>Вход</Text>
      <TextInput
        style={styles.input}
        placeholder="Логин или email"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Пароль"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={onLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Входим…' : 'Войти'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  input: { height: 48, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, marginBottom: 12 },
  button: { height: 48, backgroundColor: '#007AFF', borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
