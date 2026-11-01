import { formatKop } from '../utils/money';
import { formatDateShort } from '../utils/dates';
import { formatTrackerValue } from '../db/repos/trackers';

const PERIOD_TITLES = { day: 'День', week: 'Неделя', month: 'Месяц' };

export const periodTitle = (period) => PERIOD_TITLES[period] || PERIOD_TITLES.day;

export const buildPeriodText = (data, period) => {
  const lines = [
    `${periodTitle(period)}: ${formatDateShort(data.start)}${data.start !== data.end ? ` - ${formatDateShort(data.end)}` : ''}`,
  ];

  const loggedDays = data.nutrition.filter((d) => d.kcal > 0).length;
  if (loggedDays) {
    const avg = data.nutritionAverages;
    lines.push(`Питание: в среднем ${avg.kcal} ккал (Б ${avg.protein} г · Ж ${avg.fat} г · У ${avg.carbs} г), дней с записями: ${loggedDays}`);
  }

  if (data.expenseTotalKop) {
    lines.push(`Расходы: ${formatKop(data.expenseTotalKop)}`);
  }

  data.trackers.forEach((t) => {
    const unit = t.tracker?.unit ? ` ${t.tracker.unit}` : '';
    lines.push(`${t.name}: ${t.first} → ${t.last}${unit}`);
  });

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
