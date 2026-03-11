import React, { useState, useEffect, useRef } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Animated, Dimensions, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import { usersApi, setAuthToken } from '../api';
import { API_BASE_URL } from '../constants';
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
  const [phoneNumber, setPhoneNumber] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState(null);
  const { connect, loadUser } = useNotifications();

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
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

  const signInWithPhoneNumber = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      Alert.alert('Ошибка', 'Пожалуйста, введите корректный номер телефона');
      return;
    }

    try {
      setLoading(true);
      // Форматируем номер телефона (должен быть в формате +79991234567)
      let formattedPhone = phoneNumber;
      if (!formattedPhone.startsWith('+')) {
        if (formattedPhone.startsWith('8')) {
          formattedPhone = '+7' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('7')) {
          formattedPhone = '+' + formattedPhone;
        } else {
          formattedPhone = '+7' + formattedPhone;
        }
      }

      const confirmation = await auth().signInWithPhoneNumber(formattedPhone);
      setConfirm(confirmation);
      console.log(confirmation);
    } catch (error) {
      console.error('Phone Auth Error:', error);
      Alert.alert('Ошибка', error.message || 'Не удалось отправить SMS');
    } finally {
      setLoading(false);
    }
  };

  const confirmCode = async () => {
    if (!code || code.length < 6) {
      Alert.alert('Ошибка', 'Введите 6-значный код из SMS');
      return;
    }

    try {
      setLoading(true);
      const result = await confirm.confirm(code);
      const user = result.user;
      
      if (user) {
        const idToken = await user.getIdToken();
        const fcmToken = await storage.getItem('fcm_token');
        const res = await usersApi.firebaseAuth(idToken, fcmToken);
        
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
      }
    } catch (error) {
      console.error('Confirm Code Error:', error);
      Alert.alert('Ошибка', 'Неверный код подтверждения');
    } finally {
      setLoading(false);
    }
  };

  const onPrivacyPolicy = () => {
    navigation.navigate('WebView', { 
      url: `${API_BASE_URL}/privacy-policy`, 
      title: 'Политика конфиденциальности' 
    });
  };

  const onTermsOfUse = () => {
    navigation.navigate('WebView', { 
      url: `${API_BASE_URL}/terms`, 
      title: 'Правила использования' 
    });
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Animated.View 
        style={[
          styles.inner, 
          { 
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }]
          }
        ]}
      >
        <Animated.View style={{ transform: [{ scale: logoScale }], alignSelf: 'center', marginBottom: 24 }}>
          <View style={[styles.logoContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Ionicons name="cart" size={60} color={colors.primary} />
          </View>
        </Animated.View>

        <Text style={[styles.title, { color: colors.text }]}>FokinShop</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Вход по номеру телефона
        </Text>

        {!confirm ? (
          <>
            <View style={[styles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="call-outline" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Номер телефона (+7...)"
                placeholderTextColor={colors.textSecondary + '80'}
                keyboardType="phone-pad"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                disabled={loading}
              />
            </View>

            <TouchableOpacity 
              style={[
                styles.primaryButton, 
                { backgroundColor: colors.primary },
                loading && styles.buttonDisabled
              ]} 
              onPress={signInWithPhoneNumber} 
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Получить код</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={[styles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="keypad-outline" size={20} color={colors.textSecondary} style={{ marginRight: 12 }} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                placeholder="Код из SMS"
                placeholderTextColor={colors.textSecondary + '80'}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
                maxLength={6}
                disabled={loading}
              />
            </View>

            <TouchableOpacity 
              style={[
                styles.primaryButton, 
                { backgroundColor: colors.primary },
                loading && styles.buttonDisabled
              ]} 
              onPress={confirmCode} 
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Войти</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={() => setConfirm(null)}
              style={{ marginTop: 16, alignItems: 'center' }}
            >
              <Text style={{ color: colors.primary }}>Изменить номер</Text>
            </TouchableOpacity>
          </>
        )}

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
            Используя приложение, вы соглашаетесь с{' '}
            <Text 
              style={{ textDecorationLine: 'underline', color: colors.primary }} 
              onPress={onTermsOfUse}
            >
              правилами использования
            </Text>
            {' '}и{' '}
            <Text 
              style={{ textDecorationLine: 'underline', color: colors.primary }} 
              onPress={onPrivacyPolicy}
            >
              политикой конфиденциальности
            </Text>
          </Text>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
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
  inputContainer: {
    height: 60,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
    ...getShadow('#000', { width: 0, height: 2 }, 0.05, 5, 1),
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  primaryButton: {
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    ...getShadow('#000', { width: 0, height: 4 }, 0.1, 10, 2),
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
