import './src/utils/firebaseInit'; // Гарантированная инициализация первым делом
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
// import * as Linking from 'expo-linking';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TabNavigator from './src/navigation/TabNavigator';
import { requestUserPermission, setupCloudMessaging, updateServerFcmToken } from './src/utils/notifications';
import { NotificationProvider, useNotifications } from './src/context/NotificationContext.js';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.js';
import { storage } from './src/utils/storage';
import { setAuthToken } from './src/api';

function AppContent() {
  const { connect } = useNotifications();
  const { theme } = useTheme();

/*
  const linking = {
    prefixes: [Linking.createURL('/'), 'fokinfun://'],
    config: {
      screens: {
        Main: {
          screens: {
            Profile: {
              screens: {
                Login: 'verify-email',
              },
            },
          },
        },
      },
    },
    async subscribe(listener) {
      const onReceiveURL = ({ url }) => {
        console.log('[Linking] Received URL:', url);
        const { queryParams } = Linking.parse(url);
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
*/

  useEffect(() => {
    requestUserPermission();
    setupCloudMessaging();

    // Проверка сохраненной сессии
    const checkSession = async () => {
      const token = await storage.getAccessToken();
      if (token) {
        setAuthToken(token);
        connect(token);
        // Обновляем FCM токен на сервере после авторизации
        updateServerFcmToken();
      }
    };
    checkSession();
  }, [connect]);

  return (
    <NavigationContainer /* linking={linking} */>
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
