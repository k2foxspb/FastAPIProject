import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getShadow } from '../utils/shadowStyles';

export default function VerificationScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { email: initialEmail } = route.params || {};
  
  const [email, setEmail] = useState(initialEmail || '');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const onVerify = async () => {
    if (!email || !code) {
      Alert.alert('Ошибка', 'Введите email и код подтверждения');
      return;
    }

    if (code.length !== 6) {
      Alert.alert('Ошибка', 'Код должен состоять из 6 цифр');
      return;
    }

    try {
      setLoading(true);
      await usersApi.verifyCode(email, code);
      Alert.alert(
        'Успех',
        'Email успешно подтвержден! Теперь вы можете войти.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
      );
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Не удалось подтвердить код';
      Alert.alert('Ошибка', String(msg));
    } finally {
      setLoading(false);
    }
  };

  const onResendCode = async () => {
    if (!email) {
      Alert.alert('Ошибка', 'Введите email для повторной отправки кода');
      return;
    }

    try {
      setResending(true);
      await usersApi.resendCode(email);
      Alert.alert('Успех', 'Новый код подтверждения отправлен на вашу почту');
    } catch (e) {
      const msg = e?.response?.data?.detail || e.message || 'Не удалось отправить код';
      Alert.alert('Ошибка', String(msg));
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.text }]}>Подтверждение</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Мы отправили код подтверждения на ваш email. Введите его ниже.
        </Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!initialEmail}
        />

        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border, fontSize: 24, textAlign: 'center', letterSpacing: 8 }]}
          placeholder="000000"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
        />

        <TouchableOpacity 
          style={[styles.button, { backgroundColor: colors.primary }, loading && styles.buttonDisabled]} 
          onPress={onVerify} 
          disabled={loading || resending}
        >
          <Text style={styles.buttonText}>{loading ? 'Проверка...' : 'Подтвердить'}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.resendButton, resending && styles.buttonDisabled]} 
          onPress={onResendCode} 
          disabled={loading || resending}
        >
          <Text style={[styles.resendText, { color: colors.textSecondary }]}>
            {resending ? 'Отправка...' : 'Отправить код повторно'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.linkButton} 
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={[styles.linkText, { color: colors.primary }]}>Вернуться ко входу</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 32 },
  input: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, fontSize: 16 },
  button: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 2) },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  resendButton: { marginTop: 16, alignItems: 'center', padding: 10 },
  resendText: { fontSize: 14, fontWeight: '500' },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { fontSize: 16, fontWeight: '600' },
});
