import './src/utils/firebaseInit'; // Гарантированная инициализация первым делом
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
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
    <NavigationContainer>
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
