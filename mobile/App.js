import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import TabNavigator from './src/navigation/TabNavigator';
import { requestUserPermission, setupCloudMessaging } from './src/utils/notifications';

export default function App() {
  useEffect(() => {
    requestUserPermission();
    setupCloudMessaging();
  }, []);

  return (
    <NavigationContainer>
      <StatusBar style="auto" />
      <TabNavigator />
    </NavigationContainer>
  );
}
