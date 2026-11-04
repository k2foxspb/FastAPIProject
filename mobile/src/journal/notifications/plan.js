// Расчёт окна точных напоминаний (чистая функция, без Notifee и SQLite - проверяется
// node-скриптом scripts/check-journal-reminders.mjs).
// Напоминание события срабатывает за offset_min до каждого экземпляра события
// (для событий «весь день» - от time_of_day напоминания, по умолчанию 09:00).
// Напоминание трекера - в time_of_day по своему правилу (по умолчанию каждый день).
// Напоминание приёма пищи - каждый день через MEAL_REMINDER_DELAY_MIN минут после default_time
// типа приёма пищи (reminder_enabled), если за этот приём в этот день ещё нет записей о еде.
// ID триггера детерминированный: jr:<reminderUuid>:<YYYYMMDDHHmm исходного экземпляра>,
// поэтому пересчёт окна не создаёт дублей.
import { expandEvent, iterDates } from '../utils/recurrence';
import { localToUtc } from '../utils/tz';
import { addDays, compareKeys, formatDateRu, normalizeTime } from '../utils/dates';

export const TRIGGER_PREFIX = 'jr:';
// Ключ напоминания приёма пищи в ID триггера (отдельной сущности reminder у него нет)
export const mealReminderKey = (mealTypeUuid) => `meal-${mealTypeUuid}`;
export const SNOOZE_SUFFIX = ':snooze';
export const DEFAULT_ALL_DAY_TIME = '09:00';
export const MEAL_REMINDER_DELAY_MIN = 30;
const MINUTE = 60000;

// Дата 'YYYY-MM-DD' момента ms в часовом поясе timeZone
export const dateKeyAt = (ms, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
};

export const triggerId = (reminderUuid, dateKey, time) => (
  `${TRIGGER_PREFIX}${reminderUuid}:${dateKey.replace(/-/g, '')}${(time || '0000').replace(':', '')}`
);

const eventBody = (date, time, todayKey) => {
  const day = date === todayKey ? 'Сегодня' : date === addDays(todayKey, 1) ? 'Завтра' : formatDateRu(date, { withYear: false });
  return time ? `${day} в ${time}` : `${day}, весь день`;
};

const offsetText = (min) => {
  if (!min) return '';
  if (min % 1440 === 0) return `через ${min / 1440} дн.`;
  if (min % 60 === 0) return `через ${min / 60} ч`;
  return `через ${min} мин`;
};

/**
 * @param {object} p
 * @param {Array} p.reminders - напоминания (enabled, target_type, target_uuid, offset_min, time_of_day, rrule, created_at)
 * @param {Array} p.events - события-цели напоминаний
 * @param {object} p.overrides - { event_uuid: { 'YYYY-MM-DD': occurrence } }
 * @param {object} p.trackers - { uuid: tracker }
 * @param {Set} p.trackerValueKeys - 'tracker_uuid:YYYY-MM-DD' дней, где значение уже записано
 * @param {Array} p.mealTypes - типы приёмов пищи (uuid, name, default_time, reminder_enabled)
 * @param {Set} p.mealEntryKeys - 'meal_type_uuid:YYYY-MM-DD' дней, где еда уже записана
 * @param {string} p.timezone - часовой пояс журнала (IANA)
 * @param {number} p.now - текущий момент (ms)
 * @param {number} p.windowDays - размер окна в днях
 * @param {number} p.maxCount - максимум триггеров
 * @returns {Array<{id, fireAt, reminderUuid, title, body, targetType, data}>}
 */
export const planReminderTriggers = ({
  reminders, events, overrides = {}, trackers = {}, trackerValueKeys = new Set(),
  mealTypes = [], mealEntryKeys = new Set(),
  timezone, now, windowDays, maxCount,
}) => {
  const today = dateKeyAt(now, timezone);
  const windowEnd = now + windowDays * 1440 * MINUTE;
  const eventsByUuid = {};
  (events || []).forEach((e) => { eventsByUuid[e.uuid] = e; });
  const result = [];

  const push = (item) => {
    if (item.fireAt > now && item.fireAt <= windowEnd) result.push(item);
  };

  (reminders || []).forEach((rem) => {
    if (!rem || !rem.enabled) return;
    if (rem.target_type === 'event') {
      const event = eventsByUuid[rem.target_uuid];
      if (!event) return;
      const offset = Math.max(0, Number(rem.offset_min) || 0);
      const tz = event.timezone || timezone;
      // Экземпляры, у которых момент напоминания может попасть в окно
      const end = addDays(today, windowDays + Math.ceil(offset / 1440) + 1);
      const instances = expandEvent(event, overrides[event.uuid] || {}, addDays(today, -1), end);
      instances.forEach((inst) => {
        if (inst.status !== 'planned') return;
        const time = normalizeTime(inst.time) || normalizeTime(rem.time_of_day) || DEFAULT_ALL_DAY_TIME;
        const fireAt = localToUtc(inst.date, time, tz).getTime() - offset * MINUTE;
        const shownTime = normalizeTime(inst.time);
        push({
          id: triggerId(rem.uuid, inst.original_date, normalizeTime(event.start_time) || time),
          fireAt,
          reminderUuid: rem.uuid,
          targetType: 'event',
          title: event.title,
          body: [eventBody(inst.date, shownTime, dateKeyAt(fireAt, tz)), offsetText(offset)].filter(Boolean).join(' · '),
          data: {
            kind: 'journal_reminder',
            reminder_uuid: rem.uuid,
            target_type: 'event',
            event_uuid: event.uuid,
            original_date: inst.original_date,
            date: inst.date,
            recurring: inst.recurring ? '1' : '0',
          },
        });
      });
      return;
    }
    if (rem.target_type === 'tracker') {
      const tracker = trackers[rem.target_uuid];
      const time = normalizeTime(rem.time_of_day);
      if (!tracker || tracker.archived || !time) return;
      const rule = rem.rrule || 'FREQ=DAILY';
      const created = rem.created_at ? dateKeyAt(Date.parse(rem.created_at) || now, timezone) : today;
      const dtstart = compareKeys(created, today) < 0 ? created : today;
      let dates;
      try {
        dates = iterDates(rule, dtstart, addDays(today, -1), addDays(today, windowDays + 1));
      } catch {
        return;
      }
      dates.forEach((date) => {
        // Значение за день уже записано - напоминать не нужно
        if (trackerValueKeys.has(`${tracker.uuid}:${date}`)) return;
        push({
          id: triggerId(rem.uuid, date, time),
          fireAt: localToUtc(date, time, timezone).getTime(),
          reminderUuid: rem.uuid,
          targetType: 'tracker',
          title: tracker.name,
          body: 'Пора записать значение',
          data: {
            kind: 'journal_reminder',
            reminder_uuid: rem.uuid,
            target_type: 'tracker',
            tracker_uuid: tracker.uuid,
            date,
          },
        });
      });
    }
  });

  (mealTypes || []).forEach((meal) => {
    const time = normalizeTime(meal?.default_time);
    if (!meal || !meal.reminder_enabled || !time) return;
    const key = mealReminderKey(meal.uuid);
    for (let i = -1; i <= windowDays + 1; i += 1) {
      const date = addDays(today, i);
      // За этот приём пищи уже есть запись - напоминать не нужно
      if (mealEntryKeys.has(`${meal.uuid}:${date}`)) continue;
      push({
        id: triggerId(key, date, time),
        fireAt: localToUtc(date, time, timezone).getTime() + MEAL_REMINDER_DELAY_MIN * MINUTE,
        reminderUuid: key,
        targetType: 'meal',
        title: meal.name,
        body: `Что вы ели на ${meal.name.toLowerCase()}? Нажмите, чтобы записать в журнал`,
        data: {
          kind: 'journal_reminder',
          reminder_uuid: key,
          target_type: 'meal',
          meal_type_uuid: meal.uuid,
          meal_name: meal.name,
          date,
        },
      });
    }
  });

  result.sort((a, b) => a.fireAt - b.fireAt || (a.id < b.id ? -1 : 1));
  // Одинаковые ID (например, экземпляр перенесён) - оставляем первый
  const seen = new Set();
  const unique = result.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
  return unique.slice(0, maxCount);
};
