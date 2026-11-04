// Каталог основных разделов приложения, по которым ИИ-ассистент может дать
// пользователю кликабельную ссылку прямо в чате (см. mobile/src/screens/aiChat).
// Ключи (`key`) должны СОВПАДАТЬ с теми, что перечислены в системном промпте
// ассистента на backend (см. app/api/routers/ai.py, APP_SECTIONS_PROMPT) -
// при добавлении нового раздела нужно обновить оба места.
//
// `tab` - имя вкладки нижней навигации (Tab.Navigator), `screen` - имя экрана
// внутри стека этой вкладки (Stack.Navigator), `params` - необязательные параметры экрана.
export const APP_SECTIONS = {
  profile: { tab: 'Profile', screen: 'ProfileMain', title: 'Профиль' },
  edit_profile: { tab: 'Profile', screen: 'EditProfile', title: 'Редактировать профиль' },
  feed: { tab: 'Feed', screen: 'FeedMain', title: 'Лента' },
  notifications: { tab: 'Feed', screen: 'Notifications', title: 'Уведомления' },
  chat_list: { tab: 'Messages', screen: 'ChatList', title: 'Сообщения' },
  users: { tab: 'Users', screen: 'UsersMain', title: 'Пользователи' },
  my_likes: { tab: 'Profile', screen: 'MyLikes', title: 'Понравилось' },
  my_reviews: { tab: 'Profile', screen: 'MyReviews', title: 'Мои отзывы' },
  admin: { tab: 'Profile', screen: 'Admin', title: 'Админка' },
  journal: { tab: 'Journal', screen: 'JournalCalendar', title: 'Журнал' },
  diary: { tab: 'Journal', screen: 'DiaryList', title: 'Дневник' },
  trackers: { tab: 'Journal', screen: 'Trackers', title: 'Трекеры' },
  finance: { tab: 'Journal', screen: 'FinanceHome', title: 'Финансы' },
  ai_analysis: { tab: 'Journal', screen: 'AiAnalysis', title: 'ИИ-аналитика' },
};

// Регулярное выражение для поиска ссылок вида [Текст](app://key) в ответе ассистента.
export const APP_LINK_PATTERN = /\[([^\]]+)]\(app:\/\/([a-zA-Z0-9_]+)\)/g;

// Выполняет переход на раздел приложения по ключу из APP_SECTIONS.
// Так как экран чата с ассистентом находится во вкладке "Messages", а нужный
// раздел может быть в другой вкладке, используется вложенная навигация
// navigate(tab, { screen, params }), поддерживаемая React Navigation.
export function navigateToAppSection(navigation, key) {
  const section = APP_SECTIONS[key];
  if (!section || !navigation) return false;
  navigation.navigate(section.tab, { screen: section.screen, params: section.params });
  return true;
}
