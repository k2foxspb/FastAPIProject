import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
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
  const [role, setRole] = useState('buyer'); // 'buyer' or 'seller'
  const [loading, setLoading] = useState(false);

  const onRegister = async () => {
    if (!email || !password || !firstName || !lastName) {
      Alert.alert('Ошибка', 'Заполните все обязательные поля');
      return;
    }
    
    try {
      setLoading(true);
      await usersApi.register({
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        role
      });
      
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

          <View style={styles.roleContainer}>
            <Text style={[styles.label, { color: colors.text }]}>Я хочу быть:</Text>
            <View style={styles.roleButtons}>
              <TouchableOpacity 
                style={[
                  styles.roleButton, 
                  role === 'buyer' ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
                ]}
                onPress={() => setRole('buyer')}
              >
                <Text style={[styles.roleButtonText, role === 'buyer' ? { color: '#fff' } : { color: colors.text }]}>Покупателем</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[
                  styles.roleButton, 
                  role === 'seller' ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }
                ]}
                onPress={() => setRole('seller')}
              >
                <Text style={[styles.roleButtonText, role === 'seller' ? { color: '#fff' } : { color: colors.text }]}>Продавцом</Text>
              </TouchableOpacity>
            </View>
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
  roleContainer: { marginBottom: 24 },
  label: { fontSize: 16, marginBottom: 12, fontWeight: '500' },
  roleButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  roleButton: { flex: 0.48, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  roleButtonText: { fontWeight: '600' },
  button: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { fontSize: 16, fontWeight: '600' },
});
