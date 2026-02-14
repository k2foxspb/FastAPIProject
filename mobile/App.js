import './src/utils/firebaseInit'; // Гарантированная инициализация первым делом
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import TabNavigator from './src/navigation/TabNavigator';
import { requestUserPermission, setupCloudMessaging } from './src/utils/notifications';
import { NotificationProvider, useNotifications } from './src/context/NotificationContext';
import { storage } from './src/utils/storage';
import { setAuthToken } from './src/api';

function AppContent() {
  const { connect } = useNotifications();

  useEffect(() => {
    requestUserPermission();
    setupCloudMessaging();

    // Проверка сохраненной сессии
    const checkSession = async () => {
      const token = await storage.getAccessToken();
      if (token) {
        setAuthToken(token);
        connect(token);
      }
    };
    checkSession();
  }, [connect]);

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <TabNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  );
}
