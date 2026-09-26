import { initializeFirebase } from './src/utils/firebaseInit'; // Гарантированная инициализация
import React, { useEffect } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TabNavigator from './src/navigation/TabNavigator';
import { navigationRef } from './src/navigation/NavigationService';
import { requestUserPermission, setupCloudMessaging, updateServerFcmToken } from './src/utils/notifications';
import { NotificationProvider, useNotifications } from './src/context/NotificationContext.js';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.js';
import { theme as themeConstants } from './src/constants/theme';
import { storage } from './src/utils/storage';
import { setAuthToken, warmUpAppCheck } from './src/api';
import { setPlaybackAudioMode } from './src/utils/audioSettings';
import { cleanOldCache } from './src/utils/cacheCleanup';
import GlobalTransferIndicator from './src/components/GlobalTransferIndicator';

function AppContent() {
  const { connect, injectExternalNotification } = useNotifications();
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  // Передаём тему навигации, чтобы фон системных переходов между экранами совпадал
  // с фоном приложения и не "вспыхивал" белым при смене экрана в тёмной теме.
  const navigationTheme = {
    ...(theme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  const linking = {
    prefixes: [Linking.createURL('/'), 'fokinfun://', 'https://fokin.fun', 'https://fastapi-f628e.firebaseapp.com'],
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
            VerifyEmail: {
              path: 'verify-email',
              exact: false,
            },
            VerifyEmailBridge: {
              path: 'users/verify-email',
              exact: false,
            },
            FirebaseAction: {
              path: '__/auth/action',
              exact: false,
            }
          },
        },
      },
    },
    subscribe(listener) {
      const onReceiveURL = async ({ url }) => {
        console.log('[Linking] Received URL:', url);
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

    // Очищаем кэш старше 3 дней
    cleanOldCache();
    
    // Сначала инициализируем Firebase (теперь это async)
    initializeFirebase().then(() => {
      console.log('[App] Firebase initialized successfully (Junie Debug v1)');
      // Прогреваем App Check токен в фоне, чтобы первые запросы не ждали аттестацию
      warmUpAppCheck();
      requestUserPermission().then(granted => {
        if (granted) {
          // Если разрешение получено, пробуем получить и сохранить токен
          const { getFcmToken } = require('./src/utils/notifications');
          getFcmToken().catch(e => console.log('Initial getFcmToken failed', e));
        }
      });
      setupCloudMessaging(injectExternalNotification);
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
    <NavigationContainer linking={linking} ref={navigationRef} theme={navigationTheme}>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} backgroundColor={theme === 'dark' ? '#000000' : '#FFFFFF'} />
      <TabNavigator />
      {/* Глобальный индикатор фоновой загрузки/выгрузки медиафайлов, виден на любом экране */}
      <GlobalTransferIndicator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    // GestureHandlerRootView должен оборачивать всё дерево приложения, иначе жестовые
    // компоненты (например, Swipeable из react-native-gesture-handler) выбрасывают
    // "PanGestureHandler must be used as a descendant of GestureHandlerRootView".
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* KeyboardProvider из react-native-keyboard-controller обеспечивает надёжную работу
            KeyboardAvoidingView на Android при включённом edge-to-edge (SDK 54) — обычный
            KeyboardAvoidingView из react-native под edge-to-edge не отрабатывает надёжно. */}
        <KeyboardProvider>
          <ThemeProvider>
            <NotificationProvider>
              <AppContent />
            </NotificationProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
