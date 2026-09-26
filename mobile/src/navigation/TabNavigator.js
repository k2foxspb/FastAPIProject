import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';

import ProfileScreen from '../screens/ProfileScreen';
import CreateAlbumScreen from '../screens/CreateAlbumScreen';
import AlbumDetailScreen from '../screens/AlbumDetailScreen';
import PhotoDetailScreen from '../screens/PhotoDetailScreen';
import UploadPhotoScreen from '../screens/UploadPhotoScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import UsersScreen from '../screens/UsersScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import UserMediaScreen from '../screens/UserMediaScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import CreateGroupScreen from '../screens/chat/CreateGroupScreen';
import GroupChatScreen from '../screens/chat/GroupChatScreen';
import GroupInfoScreen from '../screens/chat/GroupInfoScreen';
import AddGroupMembersScreen from '../screens/chat/AddGroupMembersScreen';
import FeedScreen from '../screens/FeedScreen';
import CartScreen from '../screens/CartScreen';
import OrdersScreen from '../screens/OrdersScreen';
import NewsDetailScreen from '../screens/NewsDetailScreen';
import MyLikesScreen from '../screens/MyLikesScreen';
import MyReviewsScreen from '../screens/MyReviewsScreen';
import EditProductScreen from '../screens/EditProductScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import LoginScreen from '../screens/LoginScreen';
import WebViewScreen from '../screens/WebViewScreen';
import AdminScreen from '../screens/AdminScreen';
import AdminUsersScreen from '../screens/AdminUsersScreen';
import AdminModerationScreen from '../screens/AdminModerationScreen';
import AdminNewsScreen from '../screens/AdminNewsScreen';
import AdminChatsScreen from '../screens/AdminChatsScreen';
import AdminChatDetailScreen from '../screens/AdminChatDetailScreen';
import AdminCategoriesScreen from '../screens/AdminCategoriesScreen';
import AdminProductsScreen from '../screens/AdminProductsScreen';
import AdminOrdersScreen from '../screens/AdminOrdersScreen';
import AdminReviewsScreen from '../screens/AdminReviewsScreen';
import AdminAppUploadScreen from '../screens/AdminAppUploadScreen';
import AdminLogsScreen from '../screens/AdminLogsScreen';


const Tab = createBottomTabNavigator();
// createNativeStackNavigator использует нативные переходы ОС (UINavigationController/Fragment)
// вместо JS-анимаций, поэтому переходы между экранами не мерцают и не дёргаются.
const Stack = createNativeStackNavigator();

import { useNotifications } from '../context/NotificationContext.js';
import { useTheme } from '../context/ThemeContext.js';
import { theme as themeConstants } from '../constants/theme';

import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import EditNewsScreen from "../screens/EditNewsScreen";

function ChatStack() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ChatList" component= {ChatListScreen} options={{ title: 'Сообщения' }} />
      <Stack.Screen 
        name="Chat" 
        component={ChatScreen} 
        options={({ route }) => ({ 
          title: route.params.userName,
          headerShown: false // Скрываем стандартный заголовок, так как мы используем кастомный внутри ChatScreen
        })} 
      />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserMedia" component={UserMediaScreen} options={{ title: 'Медиафайлы' }} />
      <Stack.Screen 
        name="PhotoDetail" 
        component={PhotoDetailScreen} 
        options={{ 
          title: 'Фотография',
          headerShown: false // Скрываем стандартный заголовок, экран сам рисует свой оверлей на весь экран
        }} 
      />
      <Stack.Screen
        name="CreateGroup"
        component={CreateGroupScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GroupChat"
        component={GroupChatScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="GroupInfo"
        component={GroupInfoScreen}
        options={{ title: 'Информация о группе' }}
      />
      <Stack.Screen
        name="AddGroupMembers"
        component={AddGroupMembersScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade_from_bottom',
      }}
    >
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Профиль' }} />
      <Stack.Screen name="Orders" component={OrdersScreen} options={{ title: 'Мои заказы' }} />
      <Stack.Screen name="CreateAlbum" component={CreateAlbumScreen} options={{ title: 'Новый альбом' }} />
      <Stack.Screen name="AlbumDetail" component={AlbumDetailScreen} options={{ title: 'Альбом' }} />
      <Stack.Screen name="UserMedia" component={UserMediaScreen} options={{ title: 'Медиафайлы' }} />
      <Stack.Screen 
        name="PhotoDetail" 
        component={PhotoDetailScreen} 
        options={{ 
          title: 'Фотография',
          headerShown: false // Скрываем стандартный заголовок, экран сам рисует свой оверлей на весь экран
        }} 
      />
      <Stack.Screen name="UploadPhoto" component={UploadPhotoScreen} options={{ title: 'Загрузить фото' }} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Редактировать профиль' }} />
      <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'Админка' }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Пользователи' }} />
      <Stack.Screen name="AdminModeration" component={AdminModerationScreen} options={{ title: 'Модерация' }} />
      <Stack.Screen name="AdminNews" component={AdminNewsScreen} options={{ title: 'Новости' }} />
      <Stack.Screen name="AdminCategories" component={AdminCategoriesScreen} options={{ title: 'Категории' }} />
      <Stack.Screen name="AdminProducts" component={AdminProductsScreen} options={{ title: 'Товары' }} />
      <Stack.Screen name="AdminOrders" component={AdminOrdersScreen} options={{ title: 'Заказы' }} />
      <Stack.Screen name="AdminReviews" component={AdminReviewsScreen} options={{ title: 'Отзывы' }} />
      <Stack.Screen name="AdminChats" component={AdminChatsScreen} options={{ title: 'Чаты пользователей' }} />
      <Stack.Screen name="AdminChatDetail" component={AdminChatDetailScreen} options={{ title: 'Чат' }} />
      <Stack.Screen name="EditNews" component={EditNewsScreen} options={{ title: 'Редактировать новость' }} />
      <Stack.Screen name="AdminAppUpload" component={AdminAppUploadScreen} options={{ title: 'Загрузить приложение' }} />
      <Stack.Screen name="AdminLogs" component={AdminLogsScreen} options={{ title: 'Логи системы' }} />
      <Stack.Screen name="MyLikes" component={MyLikesScreen} options={{ title: 'Понравилось' }} />
      <Stack.Screen name="MyReviews" component={MyReviewsScreen} options={{ title: 'Мои отзывы' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="WebView" component={WebViewScreen} />
      <Stack.Screen name="VerifyEmail" component={LoginScreen} options={{ title: 'Подтверждение' }} />
      <Stack.Screen name="VerifyEmailBridge" component={LoginScreen} options={{ title: 'Подтверждение' }} />
      <Stack.Screen name="FirebaseVerify" component={LoginScreen} options={{ title: 'Подтверждение' }} />
      <Stack.Screen name="FirebaseAction" component={LoginScreen} options={{ title: 'Подтверждение' }} />
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
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade_from_bottom',
      }}
    >
      <Stack.Screen name="UsersMain" component={UsersScreen} options={{ title: 'Пользователи' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserMedia" component={UserMediaScreen} options={{ title: 'Медиафайлы' }} />
      <Stack.Screen 
        name="PhotoDetail" 
        component={PhotoDetailScreen} 
        options={{ 
          title: 'Фотография',
          headerShown: false // Скрываем стандартный заголовок, экран сам рисует свой оверлей на весь экран
        }} 
      />
    </Stack.Navigator>
  );
}

function FeedStack() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
        animation: 'fade_from_bottom',
      }}
    >
      <Stack.Screen name="FeedMain" component={FeedScreen} options={{ title: 'Новости и Товары' }} />
      <Stack.Screen name="Cart" component={CartScreen} options={{ title: 'Корзина' }} />
      <Stack.Screen name="NewsDetail" component={NewsDetailScreen} options={{ title: 'Новость' }} />
      <Stack.Screen name="EditNews" component={EditNewsScreen} options={{ title: 'Редактировать новость' }} />
      <Stack.Screen name="EditProduct" component={EditProductScreen} options={{ title: 'Товар' }} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: 'О товаре' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserMedia" component={UserMediaScreen} options={{ title: 'Медиафайлы' }} />
    </Stack.Navigator>
  );
}

export default function TabNavigator() {
  const { unreadTotal, friendRequestsCount } = useNotifications();
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarHideOnKeyboard: false,
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
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          display: 'flex',
        },
        headerStyle: {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        },
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
      })}
    >
      <Tab.Screen 
        name="Feed" 
        component={FeedStack} 
        options={{ 
          title: 'Лента',
          headerShown: false,
        }} 
      />
      <Tab.Screen 
        name="Users" 
        component={UsersStack} 
        options={{ 
          title: 'Пользователи', 
          headerShown: false,
          tabBarBadge: friendRequestsCount > 0 ? friendRequestsCount : null,
        }} 
      />
      <Tab.Screen 
        name="Messages" 
        component={ChatStack} 
        options={({ route }) => {
          // Скрываем нижнюю панель навигации, когда открыт конкретный чат,
          // чтобы освободить место под поле ввода сообщения.
          const routeName = getFocusedRouteNameFromRoute(route) ?? 'ChatList';
          const hideTabBar = routeName !== 'ChatList';
          return {
            title: 'Чат', 
            headerShown: false,
            tabBarBadge: unreadTotal > 0 ? unreadTotal : null,
            // Панель вкладки "Чат" всегда position:'absolute' — то есть НЕ резервирует место во
            // flex-раскладке ни на ChatList (где видима), ни на Chat (где скрыта). Раньше панель была
            // обычной (не absolute) и только скрывалась через display:'none' на экране Chat — из-за
            // этого при переключении она могла оставлять "фантомный" отступ внизу (известная особенность
            // React Navigation при динамическом переключении tabBarStyle: мейнтейнеры сами рекомендуют
            // position:'absolute', чтобы избежать "прыжка" раскладки), и поле ввода сообщения прилипало
            // не к реальному низу экрана, а к границе этого невидимого отступа. Так как панель теперь
            // всегда absolute, ChatListScreen сам добавляет отступ под неё через useBottomTabBarHeight().
            // backgroundColor/borderTopColor повторены явно, так как заданный здесь tabBarStyle перестаёт
            // наследовать тему из screenOptions родительского навигатора.
            tabBarStyle: {
              backgroundColor: colors.background,
              borderTopColor: colors.border,
              position: 'absolute',
              ...(hideTabBar && { display: 'none' }),
            },
          };
        }} 
      />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ title: 'Профиль', headerShown: false }} />
    </Tab.Navigator>
  );
}
