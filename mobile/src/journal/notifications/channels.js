// Канал Android и категории iOS для точных напоминаний журнала.
import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';

export const JOURNAL_CHANNEL_ID = 'journal_reminders';
export const IOS_EVENT_CATEGORY = 'journal_reminder';
export const IOS_TRACKER_CATEGORY = 'journal_tracker_reminder';

// ID действий в уведомлении
export const ACTION_DONE = 'jr_done';
export const ACTION_SNOOZE = 'jr_snooze';
export const ACTION_SKIP = 'jr_skip';
export const SNOOZE_MINUTES = 10;

// Категории iOS журнала. setNotificationCategories заменяет весь набор, поэтому
// они регистрируются вместе с категориями чата (utils/notifications.js).
export const JOURNAL_IOS_CATEGORIES = [
  {
    id: IOS_EVENT_CATEGORY,
    actions: [
      { id: ACTION_DONE, title: 'Выполнено' },
      { id: ACTION_SNOOZE, title: `Отложить на ${SNOOZE_MINUTES} мин` },
      { id: ACTION_SKIP, title: 'Пропустить', destructive: true },
    ],
  },
  {
    id: IOS_TRACKER_CATEGORY,
    actions: [
      { id: ACTION_SNOOZE, title: `Отложить на ${SNOOZE_MINUTES} мин` },
    ],
  },
];

// Кнопки Android (действия выполняются в фоне, без открытия приложения)
export const androidActions = (targetType) => {
  const snooze = { title: `Отложить ${SNOOZE_MINUTES} мин`, pressAction: { id: ACTION_SNOOZE } };
  if (targetType !== 'event') return [snooze];
  return [
    { title: 'Выполнено', pressAction: { id: ACTION_DONE } },
    snooze,
    { title: 'Пропустить', pressAction: { id: ACTION_SKIP } },
  ];
};

// Добавляет категории журнала к уже зарегистрированным (категории чата не теряются).
export const registerJournalIosCategories = async () => {
  if (Platform.OS !== 'ios') return;
  try {
    const ids = JOURNAL_IOS_CATEGORIES.map((c) => c.id);
    const existing = (await notifee.getNotificationCategories()) || [];
    await notifee.setNotificationCategories([
      ...existing.filter((c) => !ids.includes(c.id)),
      ...JOURNAL_IOS_CATEGORIES,
    ]);
  } catch (e) {
    console.log('[JournalReminders] categories error', e?.message);
  }
};

export const ensureJournalChannel = async () => {
  if (Platform.OS !== 'android') return JOURNAL_CHANNEL_ID;
  try {
    return await notifee.createChannel({
      id: JOURNAL_CHANNEL_ID,
      name: 'Напоминания журнала',
      description: 'Точные напоминания о событиях, приёмах пищи и трекерах',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PRIVATE,
      sound: 'default',
      vibration: true,
    });
  } catch (e) {
    console.log('[JournalReminders] channel error', e?.message);
    return JOURNAL_CHANNEL_ID;
  }
};
