import { initializeFirebase } from './src/utils/firebaseInit'; // Гарантированная инициализация
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TabNavigator from './src/navigation/TabNavigator';
import { navigationRef } from './src/navigation/NavigationService';
import { requestUserPermission, setupCloudMessaging, updateServerFcmToken } from './src/utils/notifications';
import { NotificationProvider, useNotifications } from './src/context/NotificationContext.js';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.js';
import { storage } from './src/utils/storage';
import { setAuthToken, usersApi } from './src/api';
import { setPlaybackAudioMode } from './src/utils/audioSettings';

function AppContent() {
  const { connect } = useNotifications();
  const { theme } = useTheme();

  const linking = {
    prefixes: [Linking.createURL('/'), 'fokinfun://'],
    config: {
      screens: {
        Feed: {
          screens: {
            NewsDetail: 'news/:newsId',
            ProductDetail: 'product/:productId',
          },
        },
        Messages: {
          screens: {
            Chat: 'chat/:userId/:userName',
          },
        },
        Users: {
          screens: {
            UserProfile: 'user/:userId',
          },
        },
        Profile: {
          screens: {
            Login: 'login',
            Register: 'register',
          },
        },
      },
    },
    subscribe(listener) {
      const onReceiveURL = async ({ url }) => {
        console.log('[Linking] Received URL:', url);
        const { queryParams } = Linking.parse(url);
        
        // 1. Обработка прямого токена верификации (Universal Link)
        if (queryParams?.token && !url.includes('status=')) {
          try {
            console.log('[Linking] Verifying email directly via app...');
            await usersApi.verifyEmail(queryParams.token);
            Alert.alert('Успех', 'Email успешно подтвержден! Теперь вы можете войти.');
          } catch (e) {
            console.error('[Linking] Email verification error:', e);
            const reason = e.response?.data?.detail || 'unknown';
            Alert.alert('Ошибка', `Не удалось подтвердить email: ${reason}`);
          }
        }
        
        // 2. Обработка редиректа с бэкенда (deeplink)
        if (url.includes('status=success')) {
          Alert.alert('Успех', 'Email успешно подтвержден! Теперь вы можете войти.');
        } else if (url.includes('status=error')) {
          const reason = queryParams?.reason || 'unknown';
          Alert.alert('Ошибка', `Не удалось подтвердить email. Причина: ${reason}`);
        }
        listener(url);
      };

      const subscription = Linking.addEventListener('url', onReceiveURL);

      return () => {
        subscription.remove();
      };
    },
  };

  useEffect(() => {
    // Устанавливаем режим аудио для всего приложения
    setPlaybackAudioMode();
    
    // Сначала инициализируем Firebase (теперь это async)
    initializeFirebase().then(() => {
      console.log('[App] Firebase initialized successfully (Junie Debug v1)');
      requestUserPermission().then(granted => {
        if (granted) {
          // Если разрешение получено, пробуем получить и сохранить токен
          const { getFcmToken } = require('./src/utils/notifications');
          getFcmToken().catch(e => console.log('Initial getFcmToken failed', e));
        }
      });
      setupCloudMessaging();
    });

    // Проверка сохраненной сессии
    const checkSession = async () => {
      try {
        const token = await storage.getAccessToken();
        if (token) {
          setAuthToken(token);
          connect(token);
          // Обновляем FCM токен на сервере после авторизации
          updateServerFcmToken().catch(e => console.log('FCM Update failed', e));
        }
      } catch (err) {
        console.log('checkSession failed', err);
      }
    };
    checkSession();
  }, [connect]);

  return (
    <NavigationContainer linking={linking} ref={navigationRef}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} backgroundColor={theme === 'dark' ? '#000000' : '#FFFFFF'} />
      <TabNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <AppContent />
      </NotificationProvider>
    </ThemeProvider>
  );
}
