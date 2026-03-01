import React, { useState, useEffect, useRef } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Animated, Dimensions } from 'react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { usersApi, setAuthToken } from '../api';
import { useNotifications } from '../context/NotificationContext';
import { updateServerFcmToken } from '../utils/notifications';
import { storage } from '../utils/storage';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function LoginScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [loading, setLoading] = useState(false);
  const { connect, loadUser } = useNotifications();

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    GoogleSignin.configure({
      webClientId: '176773891332-vl9om7pugk8voh0mtnkbk2crqd9gtk1m.apps.googleusercontent.com',
      androidClientId: '176773891332-b6msjuc4rf3fhmd99uq1q4lo1ao5v5e4.apps.googleusercontent.com',
      offlineAccess: true,
      forceCodeForRefreshToken: true,
    });

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  const onGoogleLogin = async () => {
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.idToken || userInfo.data?.idToken;
      
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
      <Animated.View 
        style={[
          styles.inner, 
          { 
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }]
          }
        ]}
      >
        <Animated.View style={{ transform: [{ scale: logoScale }], alignSelf: 'center', marginBottom: 32 }}>
          <View style={[styles.logoContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="cart" size={60} color={colors.primary} />
          </View>
        </Animated.View>

        <Text style={[styles.title, { color: colors.text }]}>FokinShop</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Твой путь в мир покупок и общения. Заходи и будь как дома.
        </Text>

        <TouchableOpacity 
          style={[
            styles.googleButton, 
            { backgroundColor: colors.surface, borderColor: colors.border },
            loading && styles.buttonDisabled
          ]} 
          onPress={onGoogleLogin} 
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.buttonContent}>
              <Ionicons name="logo-google" size={22} color="#4285F4" style={{ marginRight: 12 }} />
              <Text style={[styles.buttonText, { color: colors.text }]}>Войти через Google</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.features}>
          <View style={styles.featureItem}>
            <Ionicons name="flash-outline" size={20} color={colors.primary} />
            <Text style={[styles.featureText, { color: colors.textSecondary }]}>Быстрый вход</Text>
          </View>
          <View style={styles.featureItem}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
            <Text style={[styles.featureText, { color: colors.textSecondary }]}>Безопасно</Text>
          </View>
          <View style={styles.featureItem}>
            <Ionicons name="sync-outline" size={20} color={colors.primary} />
            <Text style={[styles.featureText, { color: colors.textSecondary }]}>Синхронизация</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Используя приложение, вы соглашаетесь с условиями использования
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 32 },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    ...getShadow('#000', { width: 0, height: 10 }, 0.1, 15, 5),
  },
  title: { fontSize: 36, fontWeight: '900', marginBottom: 12, textAlign: 'center', letterSpacing: -1.5 },
  subtitle: { fontSize: 17, textAlign: 'center', marginBottom: 56, lineHeight: 26, paddingHorizontal: 30, opacity: 0.8 },
  googleButton: { 
    height: 60, 
    borderRadius: 18, 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderWidth: 1,
    ...getShadow('#000', { width: 0, height: 4 }, 0.05, 10, 2) 
  },
  buttonContent: { flexDirection: 'row', alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontWeight: '600', fontSize: 17 },
  features: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    marginTop: 60,
    paddingHorizontal: 10
  },
  featureItem: { alignItems: 'center' },
  featureText: { fontSize: 12, marginTop: 8, fontWeight: '500' },
  footer: { position: 'absolute', bottom: 40, left: 0, right: 0, paddingHorizontal: 40 },
  footerText: { fontSize: 12, textAlign: 'center', opacity: 0.6 },
});
