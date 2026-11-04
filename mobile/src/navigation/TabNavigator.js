import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import CreatePostScreen from '../screens/CreatePostScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import NewsDetailScreen from '../screens/NewsDetailScreen';
import PostDetailScreen from '../screens/PostDetailScreen';
import MyLikesScreen from '../screens/MyLikesScreen';
import MyReviewsScreen from '../screens/MyReviewsScreen';
import LoginScreen from '../screens/LoginScreen';
import WebViewScreen from '../screens/WebViewScreen';
import AdminScreen from '../screens/AdminScreen';
import AdminUsersScreen from '../screens/AdminUsersScreen';
import AdminModerationScreen from '../screens/AdminModerationScreen';
import AdminNewsScreen from '../screens/AdminNewsScreen';
import AdminChatsScreen from '../screens/AdminChatsScreen';
import AdminChatDetailScreen from '../screens/AdminChatDetailScreen';
import AdminAppUploadScreen from '../screens/AdminAppUploadScreen';
import AdminLogsScreen from '../screens/AdminLogsScreen';
import AiChatScreen from '../screens/aiChat/AiChatScreen';
import EditNewsScreen from '../screens/EditNewsScreen';
import JournalCalendarScreen from '../screens/journal/JournalCalendarScreen';
import JournalDayScreen from '../screens/journal/JournalDayScreen';
import MonthEventsScreen from '../screens/journal/MonthEventsScreen';
import MonthKcalScreen from '../screens/journal/MonthKcalScreen';
import EventEditScreen from '../screens/journal/EventEditScreen';
import DiaryListScreen from '../screens/journal/DiaryListScreen';
import DiaryEditScreen from '../screens/journal/DiaryEditScreen';
import TrackersScreen from '../screens/journal/TrackersScreen';
import TrackerDetailScreen from '../screens/journal/TrackerDetailScreen';
import JournalSettingsScreen from '../screens/journal/JournalSettingsScreen';
import HealthImportScreen from '../screens/journal/HealthImportScreen';
import ShareSummaryScreen from '../screens/journal/ShareSummaryScreen';
import ReminderDiagnosticsScreen from '../screens/journal/ReminderDiagnosticsScreen';
import BatteryHelpScreen from '../screens/journal/BatteryHelpScreen';
import DietDayScreen from '../screens/journal/DietDayScreen';
import FoodSearchScreen from '../screens/journal/FoodSearchScreen';
import FoodEntryEditScreen from '../screens/journal/FoodEntryEditScreen';
import FoodEditScreen from '../screens/journal/FoodEditScreen';
import RecipeEditScreen from '../screens/journal/RecipeEditScreen';
import MealTypesScreen from '../screens/journal/MealTypesScreen';
import NutritionGoalsScreen from '../screens/journal/NutritionGoalsScreen';
import FinanceHomeScreen from '../screens/journal/FinanceHomeScreen';
import TransactionEditScreen from '../screens/journal/TransactionEditScreen';
import AccountsScreen from '../screens/journal/AccountsScreen';
import FinanceCategoriesScreen from '../screens/journal/FinanceCategoriesScreen';
import BudgetsScreen from '../screens/journal/BudgetsScreen';
import ImportPickScreen from '../screens/journal/ImportPickScreen';
import ImportMappingScreen from '../screens/journal/ImportMappingScreen';
import ImportPreviewScreen from '../screens/journal/ImportPreviewScreen';
import ImportBatchesScreen from '../screens/journal/ImportBatchesScreen';
import ReviewQueueScreen from '../screens/journal/ReviewQueueScreen';
import ImportRulesScreen from '../screens/journal/ImportRulesScreen';
import ExpenseAnalyticsScreen from '../screens/journal/ExpenseAnalyticsScreen';
import TransferPairsScreen from '../screens/journal/TransferPairsScreen';
import GoalsScreen from '../screens/journal/GoalsScreen';
import GoalEditScreen from '../screens/journal/GoalEditScreen';
import AnalyticsScreen from '../screens/journal/AnalyticsScreen';
import AiAnalysisScreen from '../screens/journal/AiAnalysisScreen';
import ExportScreen from '../screens/journal/ExportScreen';
import BarcodeScanScreen from '../screens/journal/BarcodeScanScreen';
import WeeklySummaryScreen from '../screens/journal/WeeklySummaryScreen';
import { JournalProvider } from '../context/JournalContext';


const Tab = createBottomTabNavigator();
// createNativeStackNavigator использует нативные переходы ОС (UINavigationController/Fragment)
// вместо JS-анимаций, поэтому переходы между экранами не мерцают и не дёргаются.
const Stack = createNativeStackNavigator();

import { useNotifications } from '../context/NotificationContext.js';
import { useTheme } from '../context/ThemeContext.js';
import { theme as themeConstants } from '../constants/theme';

import { getFocusedRouteNameFromRoute } from '@react-navigation/native';

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
      <Stack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{ headerShown: false }} // Скрываем стандартный заголовок - экран сам рисует свой внутри KeyboardAvoidingView, как в ChatScreen, чтобы поле ввода комментария прилипало к клавиатуре
      />
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
      <Stack.Screen name="AdminChats" component={AdminChatsScreen} options={{ title: 'Чаты пользователей' }} />
      <Stack.Screen name="AdminChatDetail" component={AdminChatDetailScreen} options={{ title: 'Чат' }} />
      <Stack.Screen name="EditNews" component={EditNewsScreen} options={{ title: 'Редактировать новость' }} />
      <Stack.Screen name="AdminAppUpload" component={AdminAppUploadScreen} options={{ title: 'Загрузить приложение' }} />
      <Stack.Screen name="AdminLogs" component={AdminLogsScreen} options={{ title: 'Логи системы' }} />
      <Stack.Screen name="MyLikes" component={MyLikesScreen} options={{ title: 'Понравилось' }} />
      <Stack.Screen name="MyReviews" component={MyReviewsScreen} options={{ title: 'Мои отзывы' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{ headerShown: false }} // Скрываем стандартный заголовок - экран сам рисует свой внутри KeyboardAvoidingView, как в ChatScreen, чтобы поле ввода комментария прилипало к клавиатуре
      />
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
      <Stack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{ headerShown: false }} // Скрываем стандартный заголовок - экран сам рисует свой внутри KeyboardAvoidingView, как в ChatScreen, чтобы поле ввода комментария прилипало к клавиатуре
      />
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
      <Stack.Screen name="FeedMain" component={FeedScreen} options={{ title: 'Лента' }} />
      <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Новая публикация' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Уведомления', presentation: 'modal' }} />
      <Stack.Screen name="NewsDetail" component={NewsDetailScreen} options={{ title: 'Новость' }} />
      <Stack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{ headerShown: false }} // Скрываем стандартный заголовок - экран сам рисует свой внутри KeyboardAvoidingView, как в ChatScreen, чтобы поле ввода комментария прилипало к клавиатуре
      />
      <Stack.Screen name="EditNews" component={EditNewsScreen} options={{ title: 'Редактировать новость' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Профиль пользователя' }} />
      <Stack.Screen name="UserMedia" component={UserMediaScreen} options={{ title: 'Медиафайлы' }} />
      <Stack.Screen name="AlbumDetail" component={AlbumDetailScreen} options={{ title: 'Альбом' }} />
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

// Журнал жизни. JournalProvider оборачивает весь TabNavigator: локальная БД, синхронизация
// и пересчёт точных напоминаний работают со старта приложения, а не только на вкладке.
function JournalStack() {
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
        <Stack.Screen name="JournalCalendar" component={JournalCalendarScreen} options={{ title: 'Журнал' }} />
        <Stack.Screen name="JournalDay" component={JournalDayScreen} options={{ title: 'День' }} />
        <Stack.Screen name="MonthEvents" component={MonthEventsScreen} options={{ title: 'События за месяц' }} />
        <Stack.Screen name="MonthKcal" component={MonthKcalScreen} options={{ title: 'Калории по дням' }} />
        <Stack.Screen name="EventEdit" component={EventEditScreen} options={{ title: 'Событие' }} />
        <Stack.Screen name="DiaryList" component={DiaryListScreen} options={{ title: 'Дневник' }} />
        <Stack.Screen name="DiaryEdit" component={DiaryEditScreen} options={{ title: 'Запись' }} />
        <Stack.Screen name="Trackers" component={TrackersScreen} options={{ title: 'Трекеры' }} />
        <Stack.Screen name="TrackerDetail" component={TrackerDetailScreen} options={{ title: 'Трекер' }} />
        <Stack.Screen name="JournalSettings" component={JournalSettingsScreen} options={{ title: 'Настройки журнала' }} />
        <Stack.Screen name="HealthImport" component={HealthImportScreen} options={{ title: 'Здоровье' }} />
        <Stack.Screen name="AiAnalysis" component={AiAnalysisScreen} options={{ title: 'ИИ-аналитика' }} />
        <Stack.Screen name="ReminderDiagnostics" component={ReminderDiagnosticsScreen} options={{ title: 'Проверка напоминаний' }} />
        <Stack.Screen name="BatteryHelp" component={BatteryHelpScreen} options={{ title: 'Экономия батареи' }} />
        <Stack.Screen name="DietDay" component={DietDayScreen} options={{ title: 'Питание' }} />
        <Stack.Screen name="FoodSearch" component={FoodSearchScreen} options={{ title: 'Добавить еду' }} />
        <Stack.Screen name="FoodEntryEdit" component={FoodEntryEditScreen} options={{ title: 'Запись о еде' }} />
        <Stack.Screen name="FoodEdit" component={FoodEditScreen} options={{ title: 'Продукт' }} />
        <Stack.Screen name="RecipeEdit" component={RecipeEditScreen} options={{ title: 'Рецепт' }} />
        <Stack.Screen name="MealTypes" component={MealTypesScreen} options={{ title: 'Приёмы пищи' }} />
        <Stack.Screen name="NutritionGoals" component={NutritionGoalsScreen} options={{ title: 'Цели питания' }} />
        <Stack.Screen name="FinanceHome" component={FinanceHomeScreen} options={{ title: 'Финансы' }} />
        <Stack.Screen name="TransactionEdit" component={TransactionEditScreen} options={{ title: 'Операция' }} />
        <Stack.Screen name="Accounts" component={AccountsScreen} options={{ title: 'Счета' }} />
        <Stack.Screen name="FinanceCategories" component={FinanceCategoriesScreen} options={{ title: 'Категории' }} />
        <Stack.Screen name="Budgets" component={BudgetsScreen} options={{ title: 'Бюджеты' }} />
        <Stack.Screen name="ImportPick" component={ImportPickScreen} options={{ title: 'Импорт выписки' }} />
        <Stack.Screen name="ImportMapping" component={ImportMappingScreen} options={{ title: 'Сопоставление колонок' }} />
        <Stack.Screen name="ImportPreview" component={ImportPreviewScreen} options={{ title: 'Проверка импорта' }} />
        <Stack.Screen name="ImportBatches" component={ImportBatchesScreen} options={{ title: 'История импорта' }} />
        <Stack.Screen name="ReviewQueue" component={ReviewQueueScreen} options={{ title: 'Разобрать операции' }} />
        <Stack.Screen name="ImportRules" component={ImportRulesScreen} options={{ title: 'Правила импорта' }} />
        <Stack.Screen name="ExpenseAnalytics" component={ExpenseAnalyticsScreen} options={{ title: 'Расходы' }} />
        <Stack.Screen name="TransferPairs" component={TransferPairsScreen} options={{ title: 'Найденные переводы' }} />
        <Stack.Screen name="Goals" component={GoalsScreen} options={{ title: 'Цели' }} />
        <Stack.Screen name="GoalEdit" component={GoalEditScreen} options={{ title: 'Цель' }} />
        <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ title: 'Аналитика' }} />
        <Stack.Screen name="Export" component={ExportScreen} options={{ title: 'Экспорт' }} />
        <Stack.Screen name="BarcodeScan" component={BarcodeScanScreen} options={{ title: 'Сканировать штрихкод' }} />
        <Stack.Screen name="WeeklySummary" component={WeeklySummaryScreen} options={{ title: 'Сводка за неделю' }} />
        <Stack.Screen name="ShareSummary" component={ShareSummaryScreen} options={{ title: 'Отправить' }} />
        <Stack.Screen name="CreatePost" component={CreatePostScreen} options={{ title: 'Новая публикация' }} />
      </Stack.Navigator>
  );
}

export default function TabNavigator() {
  const { unreadTotal, friendRequestsCount } = useNotifications();
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  return (
    <JournalProvider>
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
          } else if (route.name === 'Journal') {
            iconName = focused ? 'calendar' : 'calendar-outline';
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
      <Tab.Screen name="Journal" component={JournalStack} options={{ title: 'Журнал', headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ title: 'Профиль', headerShown: false }} />
    </Tab.Navigator>
    </JournalProvider>
  );
}
