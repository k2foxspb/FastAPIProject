// Обработка событий уведомлений-напоминаний журнала (передний план и фон/Headless JS).
// «Выполнено»/«Пропустить» пишут отметку экземпляра в локальную SQLite и ставят её
// в outbox (sync отправит при появлении сети); «Отложить» создаёт разовый триггер
// через 10 минут; нажатие на уведомление открывает день или трекер.
// Если БД открыть не удалось (некоторые прошивки в фоне), действие сохраняется в
// AsyncStorage (journal_pending_actions) и применяется при следующем запуске.
import notifee, { EventType } from '@notifee/react-native';
import { storage } from '../../utils/storage';
import { getJournalUserId, openJournalDb } from '../db/database';
import { setInstanceStatus } from '../db/repos/events';
import { ACTION_DONE, ACTION_SKIP, ACTION_SNOOZE } from './channels';
import { scheduleSnooze } from './scheduler';

const PENDING_KEY = 'journal_pending_actions';
const MAX_PENDING = 100;

export const isJournalNotification = (notification) => notification?.data?.kind === 'journal_reminder';

const applyStatus = async (data, status) => {
  if (data.target_type !== 'event' || !data.event_uuid || !data.original_date) return;
  await setInstanceStatus({
    event_uuid: data.event_uuid,
    original_date: data.original_date,
    recurring: data.recurring === '1',
    occurrence_uuid: null,
  }, status);
};

// БД пользователя, которому принадлежит напоминание (в фоне она может быть ещё закрыта)
const ensureDb = async (userId) => {
  const current = getJournalUserId();
  if (current && String(current) === String(userId)) return true;
  if (current) return false; // открыт другой аккаунт - не трогаем
  const stored = await storage.getUserId();
  if (!stored || String(stored) !== String(userId)) return false; // пользователь вышел/сменился
  await openJournalDb(stored);
  return true;
};

const queuePending = async (action) => {
  try {
    const raw = await storage.getItem(PENDING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(action);
    await storage.saveItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch (e) {
    console.log('[JournalReminders] pending queue error', e?.message);
  }
};

const runStatusAction = async (data, status) => {
  try {
    if (await ensureDb(data.user_id)) {
      await applyStatus(data, status);
      return;
    }
  } catch (e) {
    console.log('[JournalReminders] action error', e?.message);
  }
  await queuePending({ data, status, at: new Date().toISOString() });
};

// Применение действий, сохранённых в фоне (вызывается, когда журнал открыт).
export const applyPendingActions = async (userId) => {
  let list = [];
  try {
    const raw = await storage.getItem(PENDING_KEY);
    list = raw ? JSON.parse(raw) : [];
  } catch {
    list = [];
  }
  if (!list.length) return 0;
  const rest = [];
  let applied = 0;
  for (const item of list) {
    if (String(item?.data?.user_id) !== String(userId)) {
      rest.push(item);
      continue;
    }
    try {
      await applyStatus(item.data, item.status);
      applied += 1;
    } catch (e) {
      console.log('[JournalReminders] pending apply error', e?.message);
      rest.push(item);
    }
  }
  await storage.saveItem(PENDING_KEY, rest.length ? JSON.stringify(rest) : null);
  return applied;
};

const waitForNavigation = async (timeoutMs = 10000) => {
  const { navigationRef } = require('../../navigation/NavigationService');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (navigationRef.isReady()) return navigationRef;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
};

// Переход по нажатию на напоминание (используется и для getInitialNotification).
export const openJournalReminder = (navigationRef, data) => {
  if (!navigationRef || !data) return;
  if (data.target_type === 'tracker' && data.tracker_uuid) {
    navigationRef.navigate('Journal', { screen: 'TrackerDetail', params: { uuid: data.tracker_uuid }, initial: false });
  } else if (data.target_type === 'test') {
    navigationRef.navigate('Journal', { screen: 'ReminderDiagnostics', initial: false });
  } else if (data.date) {
    navigationRef.navigate('Journal', { screen: 'JournalDay', params: { date: data.date }, initial: false });
  } else {
    navigationRef.navigate('Journal');
  }
};

/**
 * Обрабатывает событие Notifee, если оно относится к журналу.
 * @returns {Promise<boolean>} true - событие журнала (обработано здесь)
 */
export const handleJournalNotificationEvent = async ({ type, detail }) => {
  const notification = detail?.notification;
  if (!isJournalNotification(notification)) return false;
  if (type === EventType.DELIVERED || type === EventType.DISMISSED) return true;
  const data = notification.data || {};
  const actionId = detail.pressAction?.id;

  const dismiss = async () => {
    try {
      if (notification.id) await notifee.cancelDisplayedNotification(notification.id);
    } catch {
      // уже скрыто
    }
  };

  if (type === EventType.ACTION_PRESS && actionId === ACTION_DONE) {
    await runStatusAction(data, 'done');
    await dismiss();
    return true;
  }
  if (type === EventType.ACTION_PRESS && actionId === ACTION_SKIP) {
    await runStatusAction(data, 'skipped');
    await dismiss();
    return true;
  }
  if (type === EventType.ACTION_PRESS && actionId === ACTION_SNOOZE) {
    try {
      await scheduleSnooze(notification);
    } catch (e) {
      console.log('[JournalReminders] snooze error', e?.message);
    }
    await dismiss();
    return true;
  }
  if (type === EventType.PRESS || (type === EventType.ACTION_PRESS && actionId === 'default')) {
    const nav = await waitForNavigation();
    if (nav) openJournalReminder(nav, data);
    return true;
  }
  return true;
};
