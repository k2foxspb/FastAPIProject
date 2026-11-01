import { formatKop } from '../utils/money';
import { formatDateShort } from '../utils/dates';
import { formatTrackerValue, goalStatus } from '../db/repos/trackers';

const PERIOD_TITLES = { day: 'День', week: 'Неделя', month: 'Месяц' };

export const periodTitle = (period) => PERIOD_TITLES[period] || PERIOD_TITLES.day;

export const SHARE_SECTIONS = [
  { key: 'food', label: 'Питание' },
  { key: 'expenses', label: 'Расходы' },
  { key: 'charts', label: 'Трекеры и графики' },
];

export const SHARE_DAY_SECTIONS = [
  { key: 'plan', label: 'План' },
  { key: 'food', label: 'Питание' },
  { key: 'expenses', label: 'Расходы' },
  { key: 'trackers', label: 'Трекеры' },
];

export const buildDaySummaryText = (data, date, sections) => {
  const lines = [`Итоги за ${formatDateShort(date)}`];
  if (sections.includes('plan')) {
    lines.push(buildDayPlanText(data.events || [], date));
  }
  if (sections.includes('food') && data.diet) {
    const t = data.diet.totals || {};
    lines.push(`Питание: ${Math.round(t.kcal || 0)} ккал (Б ${Math.round(t.protein || 0)} г · Ж ${Math.round(t.fat || 0)} г · У ${Math.round(t.carbs || 0)} г)`);
  }
  if (sections.includes('expenses')) {
    lines.push(buildDayExpensesText(data.transactions || [], date));
  }
  if (sections.includes('trackers')) {
    lines.push(buildDayAchievementsText([], data.values || [], date).split('\n').slice(1).join('\n') || 'Трекеров нет');
  }
  return lines.join('\n\n');
};

export const buildPeriodText = (data, period, sections = SHARE_SECTIONS.map((s) => s.key)) => {
  const lines = [
    `${periodTitle(period)}: ${formatDateShort(data.start)}${data.start !== data.end ? ` - ${formatDateShort(data.end)}` : ''}`,
  ];

  const loggedDays = data.nutrition.filter((d) => d.kcal > 0).length;
  if (sections.includes('food') && loggedDays) {
    const avg = data.nutritionAverages;
    lines.push(`Питание: в среднем ${avg.kcal} ккал (Б ${avg.protein} г · Ж ${avg.fat} г · У ${avg.carbs} г), дней с записями: ${loggedDays}`);
  }

  if (sections.includes('expenses') && data.expenseTotalKop) {
    lines.push(`Расходы: ${formatKop(data.expenseTotalKop)}`);
  }

  if (sections.includes('charts')) {
    data.trackers.forEach((t) => {
      const unit = t.tracker?.unit ? ` ${t.tracker.unit}` : '';
      const goal = t.tracker ? goalStatus(t.tracker, t.last) : null;
      const goalText = goal ? ` (${goal.direction === 'not_exceed' ? 'не больше' : 'цель'} ${goal.goal}${unit}${goal.reached ? ', достигнута ✓' : ''})` : '';
      lines.push(`${t.name}: ${t.first} → ${t.last}${unit}${goalText}`);
    });
  }

  return lines.join('\n');
};

export const buildDayAchievementsText = (events, values, date) => {
  const lines = [`Достижения за ${formatDateShort(date)}`];
  const done = events.filter((e) => e.status === 'done');
  lines.push(done.length ? `Выполнено: ${done.length} из ${events.length}` : 'Выполненных событий нет');
  done.forEach((item) => lines.push(`✓ ${item.title}`));
  values.forEach((v) => lines.push(`${v.tracker_name}: ${formatTrackerValue(v, v)}`));
  return lines.join('\n');
};

export const buildDayExpensesText = (transactions, date) => {
  const expenses = transactions.filter((t) => t.direction === 'expense');
  const lines = [`Расходы за ${formatDateShort(date)}`];
  if (!expenses.length) {
    lines.push('Расходов нет');
    return lines.join('\n');
  }
  const total = expenses.reduce((sum, t) => sum + (t.amount_kop || 0), 0);
  lines.push(`Итого: ${formatKop(total)}`);
  expenses.forEach((t) => {
    const category = t.category_name ? ` (${t.category_name})` : '';
    lines.push(`${t.description}${category}: ${formatKop(t.amount_kop)}`);
  });
  return lines.join('\n');
};

export const buildMonthCalendarText = (totals, title) => {
  const lines = [`${title}`];
  lines.push(`События: ${totals.done} из ${totals.total}`);
  lines.push(`Дней с записями в дневнике: ${totals.diary}`);
  if (totals.kcal > 0) lines.push(`Калории: ${totals.kcal} ккал`);
  if (totals.expense > 0) lines.push(`Расходы: ${formatKop(totals.expense)}`);
  return lines.join('\n');
};

export const buildDayPlanText = (instances, date) => {
  const lines = [`План на ${formatDateShort(date)}`];
  if (!instances.length) {
    lines.push('Событий нет');
    return lines.join('\n');
  }
  [...instances]
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .forEach((item) => {
      const time = item.time ? `${item.time} ` : '';
      const mark = item.status === 'done' ? ' ✓' : '';
      lines.push(`${time}${item.title}${mark}`);
    });
  return lines.join('\n');
};
