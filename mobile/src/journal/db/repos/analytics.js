// Аналитика журнала за период: вес и трекеры, КБЖУ, расходы. Все суммы - в копейках и граммах.
import { getJournalDb } from '../database';
import { addDays, compareKeys } from '../../utils/dates';
import { listTrackers, listTrackerValues } from './trackers';
import { getSettings } from './settings';

const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Math.round((Number(n) || 0) * f) / f;
};

const daysBetween = (start, end) => {
  const days = [];
  for (let d = start; compareKeys(d, end) <= 0; d = addDays(d, 1)) days.push(d);
  return days;
};

// КБЖУ по дням периода: сумма записей о еде, даже если в дне нет записей (нули).
export const nutritionByDay = async (start, end) => {
  const db = getJournalDb();
  const rows = await db.getAllAsync(
    `SELECT entry_date AS d, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(fat) AS fat, SUM(carbs) AS carbs
     FROM food_entries WHERE entry_date BETWEEN ? AND ? GROUP BY entry_date`,
    [start, end],
  );
  const byDay = Object.fromEntries(rows.map((r) => [r.d, {
    kcal: round(r.kcal, 0), protein: round(r.protein), fat: round(r.fat), carbs: round(r.carbs),
  }]));
  return daysBetween(start, end).map((date) => ({
    date, kcal: 0, protein: 0, fat: 0, carbs: 0, ...(byDay[date] || {}),
  }));
};

// Средние значения по дням, в которых есть хотя бы одна запись (пустые дни не занижают среднее)
export const nutritionAverages = (days) => {
  const logged = days.filter((d) => d.kcal > 0 || d.protein > 0 || d.fat > 0 || d.carbs > 0);
  const avg = (key) => (logged.length ? round(logged.reduce((s, d) => s + d[key], 0) / logged.length, key === 'kcal' ? 0 : 1) : 0);
  const periodKcal = days.length ? Math.round(days.reduce((s, d) => s + d.kcal, 0) / days.length) : 0;
  return {
    loggedDays: logged.length, kcal: avg('kcal'), protein: avg('protein'), fat: avg('fat'), carbs: avg('carbs'),
    periodDays: days.length, periodKcal,
  };
};

// Расходы по дням (без переводов): direction = 'expense'
export const expensesByDay = async (start, end) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT transaction_date AS d, SUM(amount_kop) AS amount FROM transactions
     WHERE direction = 'expense' AND transaction_date BETWEEN ? AND ? GROUP BY transaction_date`,
    [start, end],
  );
  const byDay = Object.fromEntries(rows.map((r) => [r.d, Math.trunc(Number(r.amount) || 0)]));
  return daysBetween(start, end).map((date) => ({ date, expense_kop: byDay[date] || 0 }));
};

export const financeByCategory = async (start, end, direction) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT COALESCE(c.name, 'Без категории') AS name, SUM(t.amount_kop) AS amount
     FROM transactions t LEFT JOIN finance_categories c ON c.uuid = t.category_uuid
     WHERE t.direction = ? AND t.transaction_date BETWEEN ? AND ?
     GROUP BY name ORDER BY amount DESC`,
    [direction, start, end],
  );
  return rows.map((r) => ({ name: r.name, amount_kop: Math.trunc(Number(r.amount) || 0) }));
};

// Значения трекеров за период, по каждому трекеру: первое/последнее/среднее и история по дням
export const trackerSeries = async (start, end) => {
  const trackers = await listTrackers();
  const result = [];
  for (const t of trackers) {
    const values = (await listTrackerValues(t.uuid, { from: start, to: end, limit: 1000 }))
      .filter((v) => v.num_value !== null && v.num_value !== undefined)
      .sort((a, b) => (a.value_date < b.value_date ? -1 : a.value_date > b.value_date ? 1 : 0));
    if (!values.length) continue;
    const nums = values.map((v) => Number(v.num_value));
    result.push({
      uuid: t.uuid,
      name: t.name,
      value_type: t.value_type,
      unit: t.unit,
      tracker: t,
      first: nums[0],
      last: nums[nums.length - 1],
      min: Math.min(...nums),
      max: Math.max(...nums),
      avg: round(nums.reduce((s, n) => s + n, 0) / nums.length, 2),
      count: nums.length,
      points: values.map((v) => ({ date: v.value_date, value: Number(v.num_value) })),
    });
  }
  return result;
};

export const getAnalyticsGoals = async () => {
  const settings = await getSettings();
  const trackers = (await listTrackers()).filter((t) => t.goal_value !== null && t.goal_value !== undefined);
  return {
    nutrition: {
      kcal: settings?.kcal_goal || null,
      protein: settings?.protein_g_goal || null,
      fat: settings?.fat_g_goal || null,
      carbs: settings?.carbs_g_goal || null,
    },
    trackers: trackers.map((t) => ({ uuid: t.uuid, name: t.name, goal_value: t.goal_value, goal_direction: t.goal_direction })),
  };
};

export const buildPeriodAnalytics = async (start, end) => {
  const [nutrition, expenses, expenseCategories, incomeCategories, trackers, goals] = await Promise.all([
    nutritionByDay(start, end),
    expensesByDay(start, end),
    financeByCategory(start, end, 'expense'),
    financeByCategory(start, end, 'income'),
    trackerSeries(start, end),
    getAnalyticsGoals(),
  ]);
  return {
    start,
    end,
    nutrition,
    nutritionAverages: nutritionAverages(nutrition),
    expenses,
    expenseTotalKop: expenses.reduce((s, d) => s + d.expense_kop, 0),
    expenseCategories,
    incomeTotalKop: incomeCategories.reduce((s, c) => s + c.amount_kop, 0),
    incomeCategories,
    trackers,
    goals,
  };
};
