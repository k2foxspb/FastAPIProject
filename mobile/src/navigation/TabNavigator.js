import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';

import ProfileScreen from '../screens/ProfileScreen';
import CreateAlbumScreen from '../screens/CreateAlbumScreen';
import AlbumDetailScreen from '../screens/AlbumDetailScreen';
import PhotoDetailScreen from '../screens/PhotoDetailScreen';
import UploadPhotoScreen from '../screens/UploadPhotoScreen';
import UsersScreen from '../screens/UsersScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';
import FeedScreen from '../screens/FeedScreen';
import LoginScreen from '../screens/LoginScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function ChatStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ChatList" component= {ChatListScreen} options={{ title: 'Сообщения' }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.userName })} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Профиль' }} />
      <Stack.Screen name="CreateAlbum" component={CreateAlbumScreen} options={{ title: 'Новый альбом' }} />
      <Stack.Screen name="AlbumDetail" component={AlbumDetailScreen} options={{ title: 'Альбом' }} />
      <Stack.Screen name="PhotoDetail" component={PhotoDetailScreen} options={{ title: 'Фотография' }} />
      <Stack.Screen name="UploadPhoto" component={UploadPhotoScreen} options={{ title: 'Загрузить фото' }} />
      <Stack.Screen 
        name="Login" 
        component={LoginScreen} 
        options={{ 
          title: 'Вход',
          headerLeft: () => null, // Отключаем кнопку назад на экране логина
          gestureEnabled: false,   // Отключаем жесты назад
        }} 
      />
    </Stack.Navigator>
  );
}

function UsersStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="UsersMain" component={UsersScreen} options={{ title: 'Пользователи' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
    </Stack.Navigator>
  );
}

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Feed') {
            iconName = focused ? 'newspaper' : 'newspaper-outline';
          } else if (route.name === 'Users') {
            iconName = focused ? 'people' : 'people-outline';
          } else if (route.name === 'Messages') {
            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          }
          return <Icon name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ title: 'Новости' }} />
      <Tab.Screen name="Users" component={UsersStack} options={{ title: 'Пользователи', headerShown: false }} />
      <Tab.Screen name="Messages" component={ChatStack} options={{ title: 'Чат', headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ title: 'Профиль', headerShown: false }} />
    </Tab.Navigator>
  );
}
