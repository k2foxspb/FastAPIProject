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
import UserHierarchyScreen from '../screens/UserHierarchyScreen';
import ActingAssignmentsScreen from '../screens/ActingAssignmentsScreen';
import UserMediaScreen from '../screens/UserMediaScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/chat/ChatScreen';
import CreateGroupScreen from '../screens/chat/CreateGroupScreen';
import GroupChatScreen from '../screens/chat/GroupChatScreen';
import GroupInfoScreen from '../screens/chat/GroupInfoScreen';
import AddGroupMembersScreen from '../screens/chat/AddGroupMembersScreen';
import FeedScreen from '../screens/FeedScreen';
import AnnouncementsScreen from '../screens/AnnouncementsScreen';
import CreateAnnouncementScreen from '../screens/CreateAnnouncementScreen';
import CreatePostScreen from '../screens/CreatePostScreen';
import TabelScreen from '../screens/TabelScreen';
import TabelEmployeePickerScreen from '../screens/TabelEmployeePickerScreen';
import TabelSubordinatesTableScreen from '../screens/TabelSubordinatesTableScreen';
import ProductionEntryFormScreen from '../screens/ProductionEntryFormScreen';
import ProductionApprovalListScreen from '../screens/ProductionApprovalListScreen';
import ProductionEntryDetailScreen from '../screens/ProductionEntryDetailScreen';
import TimesheetApprovalListScreen from '../screens/TimesheetApprovalListScreen';
import StatementListScreen from '../screens/StatementListScreen';
import StatementFormScreen from '../screens/StatementFormScreen';
import AdminProductsScreen from '../screens/AdminProductsScreen';
import AdminStatementTemplatesScreen from '../screens/AdminStatementTemplatesScreen';
import NewsDetailScreen from '../screens/NewsDetailScreen';
import MyLikesScreen from '../screens/MyLikesScreen';
import MyReviewsScreen from '../screens/MyReviewsScreen';
import LoginScreen from '../screens/LoginScreen';
import WebViewScreen from '../screens/WebViewScreen';
import AdminScreen from '../screens/AdminScreen';
import AdminUsersScreen from '../screens/AdminUsersScreen';
import AdminWorkshopsScreen from '../screens/AdminWorkshopsScreen';
import AdminPositionsScreen from '../screens/AdminPositionsScreen';
import AdminSectionsScreen from '../screens/AdminSectionsScreen';
import AdminEmployeesScreen from '../screens/AdminEmployeesScreen';
import AdminModerationScreen from '../screens/AdminModerationScreen';
import AdminNewsScreen from '../screens/AdminNewsScreen';
import AdminChatsScreen from '../screens/AdminChatsScreen';
import AdminChatDetailScreen from '../screens/AdminChatDetailScreen';
import AdminAppUploadScreen from '../screens/AdminAppUploadScreen';
import AdminLogsScreen from '../screens/AdminLogsScreen';
import AiChatScreen from '../screens/aiChat/AiChatScreen';


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
        name="AiChat"
        component={AiChatScreen}
        options={{ headerShown: false }} // Экран сам рисует свой заголовок (см. AiChatScreen)
      />
      <Stack.Screen 
        name="Chat" 
        component={ChatScreen} 
        options={({ route }) => ({ 
          title: route.params.userName,
          headerShown: false // Скрываем стандартный заголовок, так как мы используем кастомный внутри ChatScreen
        })} 
      />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserHierarchy" component={UserHierarchyScreen} options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="ActingAssignments" component={ActingAssignmentsScreen} options={{ title: 'Исполняющие обязанности' }} />
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
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Новая публикация' }} />
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: 'Объявления' }} />
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
      <Stack.Screen name="AdminWorkshops" component={AdminWorkshopsScreen} options={{ title: 'Цеха' }} />
      <Stack.Screen name="AdminPositions" component={AdminPositionsScreen} options={{ title: 'Должности' }} />
      <Stack.Screen name="AdminSections" component={AdminSectionsScreen} options={{ title: 'Участки' }} />
      <Stack.Screen name="AdminEmployees" component={AdminEmployeesScreen} options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="AdminModeration" component={AdminModerationScreen} options={{ title: 'Модерация' }} />
      <Stack.Screen name="AdminNews" component={AdminNewsScreen} options={{ title: 'Новости' }} />
      <Stack.Screen name="AdminChats" component={AdminChatsScreen} options={{ title: 'Чаты пользователей' }} />
      <Stack.Screen name="AdminChatDetail" component={AdminChatDetailScreen} options={{ title: 'Чат' }} />
      <Stack.Screen name="EditNews" component={EditNewsScreen} options={{ title: 'Редактировать новость' }} />
      <Stack.Screen name="AdminAppUpload" component={AdminAppUploadScreen} options={{ title: 'Загрузить приложение' }} />
      <Stack.Screen name="AdminLogs" component={AdminLogsScreen} options={{ title: 'Логи системы' }} />
      <Stack.Screen name="AdminProducts" component={AdminProductsScreen} options={{ title: 'Продукция' }} />
      <Stack.Screen name="AdminStatementTemplates" component={AdminStatementTemplatesScreen} options={{ title: 'Шаблоны заявлений' }} />
      <Stack.Screen name="MyLikes" component={MyLikesScreen} options={{ title: 'Понравилось' }} />
      <Stack.Screen name="MyReviews" component={MyReviewsScreen} options={{ title: 'Мои отзывы' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserHierarchy" component={UserHierarchyScreen} options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="ActingAssignments" component={ActingAssignmentsScreen} options={{ title: 'Исполняющие обязанности' }} />
      <Stack.Screen name="WebView" component={WebViewScreen} />
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

function TabelStack() {
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
      <Stack.Screen name="TabelMain" component={TabelScreen} options={{ title: 'Табель' }} />
      <Stack.Screen name="TabelEmployeePicker" component={TabelEmployeePickerScreen} options={{ title: 'Выбор сотрудника' }} />
      <Stack.Screen name="TabelSubordinatesTable" component={TabelSubordinatesTableScreen} options={{ title: 'Таблица подчинённых' }} />
      <Stack.Screen name="ProductionEntryForm" component={ProductionEntryFormScreen} options={{ title: 'Сданная продукция' }} />
      <Stack.Screen name="ProductionApprovalList" component={ProductionApprovalListScreen} options={{ title: 'На согласовании' }} />
      <Stack.Screen name="ProductionEntryDetail" component={ProductionEntryDetailScreen} options={{ title: 'Согласование' }} />
      <Stack.Screen name="TimesheetApprovalList" component={TimesheetApprovalListScreen} options={{ title: 'Согласование часов' }} />
      <Stack.Screen name="StatementList" component={StatementListScreen} options={{ title: 'Заявления' }} />
      <Stack.Screen name="StatementForm" component={StatementFormScreen} options={{ title: 'Новое заявление' }} />
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
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Новая публикация' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserHierarchy" component={UserHierarchyScreen} options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="ActingAssignments" component={ActingAssignmentsScreen} options={{ title: 'Исполняющие обязанности' }} />
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
      <Stack.Screen name="FeedMain" component={FeedScreen} options={{ title: 'Новости' }} />
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Новая публикация' }} />
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ title: 'Объявления' }} />
      <Stack.Screen name="NewsDetail" component={NewsDetailScreen} options={{ title: 'Новость' }} />
      <Stack.Screen name="EditNews" component={EditNewsScreen} options={{ title: 'Редактировать новость' }} />
      <Stack.Screen name="CreateAnnouncement" component={CreateAnnouncementScreen} options={{ title: 'Новое объявление' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserHierarchy" component={UserHierarchyScreen} options={{ title: 'Сотрудники' }} />
      <Stack.Screen name="ActingAssignments" component={ActingAssignmentsScreen} options={{ title: 'Исполняющие обязанности' }} />
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
          } else if (route.name === 'Tabel') {
            iconName = focused ? 'document-text' : 'document-text-outline';
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
        name="Tabel"
        component={TabelStack}
        options={{
          title: 'Табель',
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
