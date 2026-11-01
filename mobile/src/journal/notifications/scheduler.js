// Планировщик точных напоминаний журнала: скользящее окно триггеров Notifee.
// Android - 14 дней, не больше 300 триггеров (лимит AlarmManager ~500 на приложение);
// iOS - ближайшие 60 (лимит системы 64). Триггеры сверяются с планом по
// детерминированным ID: лишние отменяются, недостающие и изменившиеся создаются.
import { AppState, Platform } from 'react-native';
import notifee, { AlarmType, TriggerType } from '@notifee/react-native';
import { getJournalDb, getJournalUserId, serializeWrite, subscribeJournalChanges } from '../db/database';
import { rowToObject } from '../sync/entities';
import { getMeta, setMeta } from '../sync/outbox';
import { addDays, deviceTimeZone } from '../utils/dates';
import { SNOOZE_SUFFIX, TRIGGER_PREFIX, dateKeyAt, planReminderTriggers } from './plan';
import {
  IOS_EVENT_CATEGORY, IOS_TRACKER_CATEGORY, JOURNAL_CHANNEL_ID, SNOOZE_MINUTES, androidActions,
  ensureJournalChannel, registerJournalIosCategories,
} from './channels';
import { canScheduleExact } from './permissions';

export const WINDOW_DAYS = 14;
export const MAX_TRIGGERS = Platform.OS === 'ios' ? 60 : 300;
export const TEST_TRIGGER_ID = `${TRIGGER_PREFIX}test`;
const RESCHEDULE_DELAY_MS = 1500;
// Изменения этих сущностей влияют на окно напоминаний
const RELEVANT = new Set([
  'event', 'event_occurrence', 'reminder', 'tracker', 'tracker_value', 'settings', 'meal_type', 'food_entry',
]);

const isJournalTrigger = (id) => typeof id === 'string' && id.startsWith(TRIGGER_PREFIX);
const isManagedTrigger = (id) => isJournalTrigger(id) && !id.endsWith(SNOOZE_SUFFIX) && id !== TEST_TRIGGER_ID;

// ---------------------------------------------------------------- уведомление и триггер

const stringData = (data) => {
  const out = {};
  Object.entries(data || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined) out[k] = String(v);
  });
  return out;
};

export const buildNotification = ({ id, title, body, targetType, data }) => ({
  id,
  title,
  body,
  data: stringData(data),
  android: {
    channelId: JOURNAL_CHANNEL_ID,
    smallIcon: 'notification_icon',
    color: '#023c69',
    pressAction: { id: 'default', launchActivity: 'default' },
    actions: androidActions(targetType),
    showTimestamp: true,
  },
  ios: {
    categoryId: targetType === 'event' ? IOS_EVENT_CATEGORY : IOS_TRACKER_CATEGORY,
    sound: 'default',
    interruptionLevel: 'timeSensitive',
  },
});

const createTrigger = async (notification, timestamp, exact) => {
  const trigger = { type: TriggerType.TIMESTAMP, timestamp };
  if (Platform.OS === 'android') {
    // Точный будильник срабатывает и в Doze; без разрешения - неточный (с задержкой)
    trigger.alarmManager = {
      type: exact ? AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE : AlarmType.SET_AND_ALLOW_WHILE_IDLE,
    };
  }
  await notifee.createTriggerNotification(notification, trigger);
};

// ---------------------------------------------------------------- данные для плана

const loadPlanInput = async (now) => {
  const db = getJournalDb();
  const settingsRow = await db.getFirstAsync('SELECT timezone FROM settings ORDER BY server_rev DESC LIMIT 1');
  const timezone = settingsRow?.timezone || deviceTimeZone();
  const today = dateKeyAt(now, timezone);
  const from = addDays(today, -1);
  const to = addDays(today, WINDOW_DAYS + 8);

  const reminders = (await db.getAllAsync('SELECT * FROM reminders WHERE enabled = 1'))
    .map((r) => rowToObject('reminder', r));
  const eventUuids = [...new Set(reminders.filter((r) => r.target_type === 'event').map((r) => r.target_uuid))];
  const trackerUuids = [...new Set(reminders.filter((r) => r.target_type === 'tracker').map((r) => r.target_uuid))];

  let events = [];
  const overrides = {};
  if (eventUuids.length) {
    const ph = eventUuids.map(() => '?').join(', ');
    events = (await db.getAllAsync(`SELECT * FROM events WHERE uuid IN (${ph})`, eventUuids))
      .map((r) => rowToObject('event', r));
    const occ = await db.getAllAsync(
      `SELECT * FROM event_occurrences WHERE event_uuid IN (${ph})
         AND (occurrence_date BETWEEN ? AND ? OR moved_date BETWEEN ? AND ?)`,
      [...eventUuids, from, to, from, to],
    );
    occ.forEach((o) => {
      if (!overrides[o.event_uuid]) overrides[o.event_uuid] = {};
      overrides[o.event_uuid][o.occurrence_date] = o;
    });
  }

  const trackers = {};
  const trackerValueKeys = new Set();
  if (trackerUuids.length) {
    const ph = trackerUuids.map(() => '?').join(', ');
    (await db.getAllAsync(`SELECT * FROM trackers WHERE uuid IN (${ph})`, trackerUuids))
      .forEach((r) => { trackers[r.uuid] = rowToObject('tracker', r); });
    (await db.getAllAsync(
      `SELECT DISTINCT tracker_uuid, value_date FROM tracker_values
       WHERE tracker_uuid IN (${ph}) AND value_date BETWEEN ? AND ?`,
      [...trackerUuids, from, addDays(today, 1)],
    )).forEach((v) => trackerValueKeys.add(`${v.tracker_uuid}:${v.value_date}`));
  }

  // Приёмы пищи с напоминанием и дни, когда за них уже есть записи о еде
  const mealTypes = (await db.getAllAsync('SELECT * FROM meal_types WHERE reminder_enabled = 1'))
    .map((r) => rowToObject('meal_type', r));
  const mealEntryKeys = new Set();
  if (mealTypes.length) {
    (await db.getAllAsync(
      `SELECT DISTINCT meal_type_uuid, entry_date FROM food_entries
       WHERE meal_type_uuid IS NOT NULL AND entry_date BETWEEN ? AND ?`,
      [from, addDays(today, 1)],
    )).forEach((e) => mealEntryKeys.add(`${e.meal_type_uuid}:${e.entry_date}`));
  }

  return { reminders, events, overrides, trackers, trackerValueKeys, mealTypes, mealEntryKeys, timezone };
};

// ---------------------------------------------------------------- пересчёт окна

let running = null;
let rerun = false;

const runReschedule = async () => {
  const userId = getJournalUserId();
  if (!userId) return { scheduled: 0 };
  await ensureJournalChannel();
  const now = Date.now();
  const input = await loadPlanInput(now);
  const existingIds = (await notifee.getTriggerNotificationIds()).filter(isJournalTrigger);
  const snoozeCount = existingIds.filter((id) => id.endsWith(SNOOZE_SUFFIX)).length;
  const plan = planReminderTriggers({
    ...input,
    now,
    windowDays: WINDOW_DAYS,
    maxCount: Math.max(0, MAX_TRIGGERS - snoozeCount - (existingIds.includes(TEST_TRIGGER_ID) ? 1 : 0)),
  });

  const db = getJournalDb();
  const stored = new Map((await db.getAllAsync('SELECT * FROM scheduled_triggers')).map((r) => [r.id, r]));
  const existing = new Set(existingIds);
  const planned = new Set(plan.map((t) => t.id));

  // Отмена лишних (удалённые напоминания, выполненные/пропущенные экземпляры, вышедшие за окно)
  const toCancel = existingIds.filter((id) => isManagedTrigger(id) && !planned.has(id));
  if (toCancel.length) await notifee.cancelTriggerNotifications(toCancel);

  const exact = await canScheduleExact();
  // Разрешение на точные будильники изменилось - пересоздаём все триггеры с новым типом
  const exactChanged = (await getMeta('reminders_exact')) !== (exact ? '1' : '0');
  let created = 0;
  for (const t of plan) {
    const prev = stored.get(t.id);
    const same = !exactChanged && existing.has(t.id) && prev
      && prev.fire_at === t.fireAt && prev.title === t.title && prev.body === t.body;
    if (same) continue;
    try {
      await createTrigger(buildNotification({ ...t, data: { ...t.data, user_id: userId } }), t.fireAt, exact);
      created += 1;
    } catch (e) {
      console.log('[JournalReminders] trigger error', e?.message);
      planned.delete(t.id);
    }
  }

  await serializeWrite(() => db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM scheduled_triggers');
    for (const t of plan) {
      if (!planned.has(t.id)) continue;
      await db.runAsync(
        'INSERT INTO scheduled_triggers (id, reminder_uuid, fire_at, title, body) VALUES (?, ?, ?, ?, ?)',
        [t.id, t.reminderUuid, t.fireAt, t.title, t.body],
      );
    }
    await setMeta('reminders_device_tz', deviceTimeZone());
    await setMeta('reminders_last_run', new Date(now).toISOString());
    await setMeta('reminders_exact', exact ? '1' : '0');
  }));
  return { scheduled: planned.size, created, cancelled: toCancel.length };
};

// Пересчёт окна напоминаний (параллельные вызовы объединяются).
export const rescheduleAll = () => {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    let result = null;
    try {
      do {
        rerun = false;
        result = await runReschedule();
      } while (rerun);
    } catch (e) {
      console.log('[JournalReminders] reschedule error', e?.message);
    } finally {
      running = null;
    }
    return result;
  })();
  return running;
};

// Отмена всех напоминаний журнала (выход из аккаунта, смена пользователя).
export const cancelAllJournalTriggers = async () => {
  try {
    const ids = (await notifee.getTriggerNotificationIds()).filter(isJournalTrigger);
    if (ids.length) await notifee.cancelTriggerNotifications(ids);
  } catch (e) {
    console.log('[JournalReminders] cancel error', e?.message);
  }
};

// «Отложить на 10 минут»: разовый триггер с тем же содержимым.
export const scheduleSnooze = async (notification) => {
  if (!notification) return;
  await ensureJournalChannel();
  const baseId = String(notification.id || `${TRIGGER_PREFIX}x`).replace(SNOOZE_SUFFIX, '');
  const data = notification.data || {};
  await createTrigger(
    buildNotification({
      id: `${baseId}${SNOOZE_SUFFIX}`,
      title: notification.title,
      body: notification.body,
      targetType: data.target_type,
      data,
    }),
    Date.now() + SNOOZE_MINUTES * 60000,
    await canScheduleExact(),
  );
};

// Тестовое уведомление через минуту (экран диагностики).
export const scheduleTestNotification = async () => {
  await ensureJournalChannel();
  await registerJournalIosCategories();
  const fireAt = Date.now() + 60000;
  await createTrigger(
    buildNotification({
      id: TEST_TRIGGER_ID,
      title: 'Проверка напоминаний',
      body: 'Если вы видите это уведомление ровно через минуту - напоминания работают',
      targetType: 'test',
      data: { kind: 'journal_reminder', target_type: 'test' },
    }),
    fireAt,
    await canScheduleExact(),
  );
  return fireAt;
};

// Состояние для экрана диагностики.
export const getSchedulerInfo = async () => {
  const triggers = (await notifee.getTriggerNotifications())
    .filter((t) => isJournalTrigger(t.notification?.id))
    .map((t) => ({
      id: t.notification.id,
      title: t.notification.title,
      body: t.notification.body,
      fireAt: t.trigger?.timestamp || null,
      snooze: t.notification.id.endsWith(SNOOZE_SUFFIX),
      test: t.notification.id === TEST_TRIGGER_ID,
    }))
    .sort((a, b) => (a.fireAt || 0) - (b.fireAt || 0));
  let lastRun = null;
  try {
    lastRun = await getMeta('reminders_last_run');
  } catch {
    lastRun = null;
  }
  return { total: triggers.length, upcoming: triggers.slice(0, 10), lastRun, max: MAX_TRIGGERS, windowDays: WINDOW_DAYS };
};

// ---------------------------------------------------------------- автоматический пересчёт

let timer = null;
let unsubscribers = [];

const scheduleReschedule = (delay = RESCHEDULE_DELAY_MS) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    rescheduleAll();
  }, delay);
};

// При возврате в приложение пересчитываем окно (сдвиг дней, смена часового пояса/DST).
const onAppActive = async () => {
  let tzChanged = false;
  try {
    tzChanged = (await getMeta('reminders_device_tz')) !== deviceTimeZone();
  } catch {
    tzChanged = true;
  }
  scheduleReschedule(tzChanged ? 0 : 500);
};

export const startReminderScheduler = () => {
  stopReminderScheduler();
  registerJournalIosCategories();
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') onAppActive();
  });
  unsubscribers = [
    () => appStateSub.remove(),
    subscribeJournalChanges((change) => {
      // Локальные правки и изменения, пришедшие при sync pull
      if (!change || change.remote || RELEVANT.has(change.entity)) scheduleReschedule();
    }),
  ];
  scheduleReschedule(0);
};

export const stopReminderScheduler = () => {
  if (timer) clearTimeout(timer);
  timer = null;
  unsubscribers.forEach((u) => {
    try {
      u();
    } catch {
      // уже отписаны
    }
  });
  unsubscribers = [];
};
