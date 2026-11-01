// Краткие итоги дней для календаря - по одному GROUP BY на источник за весь
// диапазон (а не запрос на каждый день). Логика совпадает с summarize_range на сервере.
// Следующие фазы (диета, финансы) добавляют свои итоги в DAY_TOTAL_PROVIDERS:
// async (db, start, end) => ({ 'YYYY-MM-DD': { kcal: 1200, expense_kop: 35000 } })
import { getJournalDb } from './database';
import { eventsInRange } from './repos/events';
import { kcalByDay } from './repos/diet';
import { addDays, compareKeys } from '../utils/dates';

export const DAY_TOTAL_PROVIDERS = [
  kcalByDay, // фаза 2: ккал из записей о еде
];

const emptyDay = (date) => ({
  date, kcal: 0, expense_kop: 0, has_diary: false, tracker_count: 0, events_total: 0, events_done: 0,
});

export const summarizeRange = async (start, end) => {
  const db = getJournalDb();
  const days = {};
  for (let d = start; compareKeys(d, end) <= 0; d = addDays(d, 1)) days[d] = emptyDay(d);

  const diary = await db.getAllAsync(
    'SELECT entry_date AS d, COUNT(*) AS n FROM diary_entries WHERE entry_date BETWEEN ? AND ? GROUP BY entry_date',
    [start, end],
  );
  diary.forEach(({ d }) => {
    if (days[d]) days[d].has_diary = true;
  });

  const values = await db.getAllAsync(
    'SELECT value_date AS d, COUNT(*) AS n FROM tracker_values WHERE value_date BETWEEN ? AND ? GROUP BY value_date',
    [start, end],
  );
  values.forEach(({ d, n }) => {
    if (days[d]) days[d].tracker_count = n;
  });

  (await eventsInRange(start, end)).forEach((inst) => {
    const day = days[inst.date];
    if (!day) return;
    day.events_total += 1;
    if (inst.status === 'done') day.events_done += 1;
  });

  for (const provider of DAY_TOTAL_PROVIDERS) {
    const totals = await provider(db, start, end);
    Object.entries(totals || {}).forEach(([d, t]) => {
      if (!days[d]) return;
      Object.entries(t).forEach(([key, value]) => {
        days[d][key] = (days[d][key] || 0) + Math.trunc(Number(value) || 0);
      });
    });
  }
  return days;
};
