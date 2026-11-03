// Проверка расчёта окна точных напоминаний (src/journal/notifications/plan.js).
// Запуск из каталога mobile: node scripts/check-journal-reminders.mjs
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const rruleEsm = pathToFileURL(path.join(here, '..', 'node_modules', 'rrule', 'dist', 'esm', 'index.js')).href;

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'rrule') return next(${JSON.stringify(rruleEsm)}, context);
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\\.[cm]?js$/.test(specifier)) {
    try {
      return await next(specifier + '.js', context);
    } catch {
      return next(specifier + '/index.js', context);
    }
  }
  return next(specifier, context);
}`));
const { planReminderTriggers } = await import(
  pathToFileURL(path.join(here, '..', 'src', 'journal', 'notifications', 'plan.js')).href
);

const MSK = 'Europe/Moscow';
const event = (over = {}) => ({
  uuid: 'E1', title: 'Обед', kind: 'meal', start_date: '2025-03-01', start_time: '13:00',
  timezone: MSK, rrule: 'FREQ=DAILY', until_date: null, status: 'planned', color: null, ...over,
});
const reminder = (over = {}) => ({
  uuid: 'R1', enabled: true, target_type: 'event', target_uuid: 'E1', offset_min: 0, time_of_day: null, rrule: null, ...over,
});
const plan = (over = {}) => planReminderTriggers({
  reminders: [reminder()], events: [event()], timezone: MSK,
  now: Date.parse('2025-03-01T08:00:00Z'), windowDays: 14, maxCount: 300, ...over,
});
const iso = (t) => new Date(t.fireAt).toISOString();

let failed = 0;
const check = (name, got, expected) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)} != ${JSON.stringify(expected)}`}`);
};

const base = plan();
check('daily_count_in_window', base.length, 14);
check('daily_first_fire_exact_minute', iso(base[0]), '2025-03-01T10:00:00.000Z');
check('deterministic_id', base[0].id, 'jr:R1:202503011300');
check('ids_unique', new Set(base.map((t) => t.id)).size, base.length);
check('idempotent_ids', plan().map((t) => t.id), base.map((t) => t.id));
check('action_data', [base[0].data.event_uuid, base[0].data.original_date, base[0].data.recurring], ['E1', '2025-03-01', '1']);

const done = plan({ overrides: { E1: { '2025-03-02': { uuid: 'O1', status: 'done' } } } });
check('done_instance_skipped', done.some((t) => t.data.original_date === '2025-03-02'), false);
check('done_instance_count', done.length, 13);

const moved = plan({ overrides: { E1: { '2025-03-02': { uuid: 'O2', status: 'planned', moved_date: '2025-03-02', moved_time: '15:30' } } } });
check('moved_time_fire', iso(moved.find((t) => t.data.original_date === '2025-03-02')), '2025-03-02T12:30:00.000Z');

check('offset_15', iso(plan({ reminders: [reminder({ offset_min: 15 })] })[0]), '2025-03-01T09:45:00.000Z');
check('past_instance_not_planned', plan({ now: Date.parse('2025-03-01T10:30:00Z') })[0].data.original_date, '2025-03-02');

const berlin = plan({
  events: [event({ start_time: '09:00', timezone: 'Europe/Berlin', start_date: '2025-03-28' })],
  timezone: 'Europe/Berlin', now: Date.parse('2025-03-29T00:00:00Z'),
});
check('dst_before', iso(berlin[0]), '2025-03-29T08:00:00.000Z');
check('dst_after', iso(berlin[1]), '2025-03-30T07:00:00.000Z');

check('max_count', plan({ maxCount: 5 }).length, 5);
check('disabled_reminder', plan({ reminders: [reminder({ enabled: false })] }).length, 0);
check('one_time_event', plan({ events: [event({ rrule: null, start_date: '2025-03-05' })] }).map(iso), ['2025-03-05T10:00:00.000Z']);
check('one_time_done', plan({ events: [event({ rrule: null, start_date: '2025-03-05', status: 'done' })] }).length, 0);

const allDay = plan({ events: [event({ start_time: null })], reminders: [reminder({ time_of_day: '08:30' })] });
// now = 11:00 МСК: сегодняшние 08:30 и 09:00 уже прошли - первое срабатывание завтра
check('all_day_time_of_day', iso(allDay[0]), '2025-03-02T05:30:00.000Z');
check('all_day_default_0900', iso(plan({ events: [event({ start_time: null })] })[0]), '2025-03-02T06:00:00.000Z');

const tracker = plan({
  reminders: [reminder({ uuid: 'R2', target_type: 'tracker', target_uuid: 'T1', time_of_day: '21:00', created_at: '2025-02-01T00:00:00Z' })],
  events: [],
  trackers: { T1: { uuid: 'T1', name: 'Вес', archived: false } },
  trackerValueKeys: new Set(['T1:2025-03-01']),
});
check('tracker_skip_recorded_day', tracker[0].data.date, '2025-03-02');
check('tracker_fire', iso(tracker[0]), '2025-03-02T18:00:00.000Z');
check('tracker_archived', plan({
  reminders: [reminder({ target_type: 'tracker', target_uuid: 'T1', time_of_day: '21:00' })],
  trackers: { T1: { uuid: 'T1', name: 'Вес', archived: true } },
}).length, 0);

// ---- фаза 2: напоминания о приёмах пищи
const meal = (over = {}) => ({ uuid: 'M1', name: 'Обед', default_time: '13:00', reminder_enabled: true, ...over });
const meals = plan({ reminders: [], events: [], mealTypes: [meal()] });
check('meal_count_in_window', meals.length, 14);
check('meal_first_fire', iso(meals[0]), '2025-03-01T11:00:00.000Z');
check('meal_id', meals[0].id, 'jr:meal-M1:202503011300');
check('meal_data', [meals[0].targetType, meals[0].data.meal_type_uuid, meals[0].data.date], ['meal', 'M1', '2025-03-01']);
check('meal_skip_logged_day', plan({
  reminders: [], events: [], mealTypes: [meal()], mealEntryKeys: new Set(['M1:2025-03-01']),
})[0].data.date, '2025-03-02');
check('meal_disabled', plan({ reminders: [], events: [], mealTypes: [meal({ reminder_enabled: false })] }).length, 0);
check('meal_without_time', plan({ reminders: [], events: [], mealTypes: [meal({ default_time: null })] }).length, 0);
check('meal_and_event_ids_differ', new Set(plan({ mealTypes: [meal()] }).map((t) => t.id)).size, 28);

// ---- фаза 2: расчёт КБЖУ (совпадает с app/services/journal/nutrition.py и tests/journal/test_diet.py)
const nutrition = await import(pathToFileURL(path.join(here, '..', 'src', 'journal', 'utils', 'nutrition.js')).href);
check('portion', nutrition.portion({ kcal: 343, protein: 13.3, fat: 3.4, carbs: 72.6 }, 150),
  { kcal: 514.5, protein: 19.95, fat: 5.1, carbs: 108.9 });
const rice = { kcal: 130, protein: 2.7, fat: 0.3, carbs: 28 };
const chicken = { kcal: 165, protein: 31, fat: 3.6, carbs: 0 };
const recipe = nutrition.recipePer100([{ per100: rice, grams: 200 }, { per100: chicken, grams: 100 }]);
check('recipe_per100', [recipe.weight, recipe.per100.kcal, recipe.per100.protein], [300, 141.67, 12.13]);
check('recipe_yield', nutrition.recipePer100([{ per100: rice, grams: 200 }, { per100: chicken, grams: 100 }], 250).per100.kcal, 170);
check('recipe_empty', nutrition.recipePer100([]).weight, 0);
check('round_half_up', [nutrition.round2(1.005), nutrition.round2(2.675), nutrition.round2(0.125)], [1.01, 2.68, 0.13]);
check('parse_amount', [nutrition.parseAmount('12,5'), nutrition.parseAmount(' 1 000 '), nutrition.parseAmount('abc'), nutrition.parseAmount('')], [12.5, 1000, null, null]);
check('sum_nutrients', nutrition.sumNutrients([{ kcal: 500.4, protein: 1.1 }, { kcal: 300.3, protein: 2.2 }]),
  { kcal: 800.7, protein: 3.3, fat: 0, carbs: 0 });

console.log(failed ? `\n${failed} проверок не прошли` : '\nВсе проверки прошли');
process.exit(failed ? 1 : 0);
