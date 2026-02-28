import React, { useState, useEffect } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { usersApi, setAuthToken } from '../api';
import { useNotifications } from '../context/NotificationContext';
import { updateServerFcmToken } from '../utils/notifications';
import { storage } from '../utils/storage';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [loading, setLoading] = useState(false);
  const { connect, loadUser } = useNotifications();

  useEffect(() => {
    GoogleSignin.configure({
      // На Android clientID берется из google-services.json автоматически
      offlineAccess: true,
    });
  }, []);

  const onGoogleLogin = async () => {
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.idToken;
      
      if (!idToken) {
        throw new Error('Не удалось получить ID токен Google');
      }

      const fcmToken = await storage.getItem('fcm_token');
      const res = await usersApi.googleAuth(idToken, fcmToken);
      
      const { access_token, refresh_token } = res.data;
      
      if (!access_token) {
        throw new Error('Токен не получен от сервера');
      }

      await storage.saveTokens(access_token, refresh_token);
      setAuthToken(access_token);
      
      await loadUser();
      connect(access_token);
      updateServerFcmToken();
      
      navigation.replace('ProfileMain');
    } catch (error) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log('User cancelled login');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        console.log('Signin in progress');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Ошибка', 'Google Play Services не доступны');
      } else {
        console.error('Google Auth Error:', error);
        Alert.alert('Ошибка входа', error.message || 'Не удалось войти через Google');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.inner}>
        <Ionicons name="logo-google" size={80} color={colors.primary} style={{ alignSelf: 'center', marginBottom: 24 }} />
        <Text style={[styles.title, { color: colors.text }]}>Добро пожаловать</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Для доступа к приложению используйте ваш аккаунт Google. Регистрация и вход стали проще!
        </Text>

        <TouchableOpacity 
          style={[styles.button, loading && styles.buttonDisabled]} 
          onPress={onGoogleLogin} 
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.buttonContent}>
              <Ionicons name="logo-google" size={24} color="#4285F4" style={{ marginRight: 12 }} />
              <Text style={styles.buttonText}>Войти через Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Верификация по email полностью удалена. Теперь всё работает через Google.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 40, lineHeight: 22 },
  button: { 
    height: 56, 
    borderRadius: 12, 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dadce0',
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 2) 
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#3c4043', fontWeight: '500', fontSize: 16 },
  footer: { marginTop: 40, paddingHorizontal: 20 },
  footerText: { fontSize: 14, textAlign: 'center', opacity: 0.8, fontStyle: 'italic' },
});
