// Диета: типы приёмов пищи, личная база продуктов и рецептов, записи о еде и воде.
// Записи о еде хранят снимок названия и КБЖУ - правка продукта не меняет историю.
import { getJournalDb } from '../database';
import { rowToObject } from '../../sync/entities';
import { deleteEntity, getEntity, saveEntity, saveLocalOnly } from '../repo';
import { getCursor } from '../../sync/outbox';
import { seedUuid } from '../../utils/uuid';
import { normalizeTime, nowTime } from '../../utils/dates';
import { per100Of, portion, recipePer100, round2, sumNutrients } from '../../utils/nutrition';

// Стартовые типы приёмов пищи (совпадают с MEAL_TYPES в app/services/journal/seed.py)
export const MEAL_TYPE_SEEDS = [
  { key: 'breakfast', name: 'Завтрак', default_time: '08:00', icon: 'cafe-outline', sort_order: 10 },
  { key: 'lunch', name: 'Обед', default_time: '13:00', icon: 'restaurant-outline', sort_order: 20 },
  { key: 'snack', name: 'Перекус', default_time: '16:30', icon: 'nutrition-outline', sort_order: 30 },
  { key: 'dinner', name: 'Ужин', default_time: '19:00', icon: 'moon-outline', sort_order: 40 },
];

export const WATER_PORTIONS = [150, 250, 330, 500];

// Офлайн до первой синхронизации: стартовые типы создаются локально (без outbox) с теми же
// UUID, что и на сервере, - первая синхронизация их перезапишет, дублей не будет.
export const ensureLocalMealTypes = async (userId) => {
  const db = getJournalDb();
  const row = await db.getFirstAsync('SELECT COUNT(*) AS n FROM meal_types');
  if (row?.n > 0 || (await getCursor()) > 0) return;
  for (const m of MEAL_TYPE_SEEDS) {
    await saveLocalOnly('meal_type', {
      name: m.name, default_time: m.default_time, icon: m.icon, sort_order: m.sort_order, reminder_enabled: false,
    }, seedUuid(userId, `meal_type:${m.key}`));
  }
};

// ---------------------------------------------------------------- типы приёмов пищи

export const listMealTypes = async () => {
  const rows = await getJournalDb().getAllAsync('SELECT * FROM meal_types ORDER BY sort_order, default_time, name');
  return rows.map((r) => rowToObject('meal_type', r));
};

export const saveMealType = (data, uuid = null) => saveEntity('meal_type', data, uuid);
export const deleteMealType = (uuid) => deleteEntity('meal_type', uuid);

// Тип приёма пищи, ближайший по времени к time ('HH:MM')
export const guessMealType = (mealTypes, time = nowTime()) => {
  const toMin = (t) => {
    const n = normalizeTime(t);
    return n ? Number(n.slice(0, 2)) * 60 + Number(n.slice(3, 5)) : null;
  };
  const now = toMin(time);
  let best = null;
  let bestDiff = Infinity;
  (mealTypes || []).forEach((m) => {
    const t = toMin(m.default_time);
    if (t === null || now === null) return;
    const diff = Math.abs(t - now);
    if (diff < bestDiff) {
      best = m;
      bestDiff = diff;
    }
  });
  return best || (mealTypes || [])[0] || null;
};

// ---------------------------------------------------------------- база продуктов

export const getFood = (uuid) => getEntity('food', uuid);

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Поиск по своей базе: сначала частые и недавние. SQLite lower() не понимает кириллицу,
// поэтому сравниваем с вариантами регистра запроса.
export const searchFoods = async (query, { limit = 50, offset = 0 } = {}) => {
  const db = getJournalDb();
  const q = String(query || '').trim();
  let where = '';
  const params = [];
  if (q) {
    const variants = [...new Set([q, q.toLowerCase(), q[0].toUpperCase() + q.slice(1).toLowerCase(), q.toUpperCase()])];
    const parts = ['barcode = ?'];
    params.push(q);
    variants.forEach((v) => {
      parts.push("name LIKE ? ESCAPE '\\'", "brand LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(v)}%`, `%${escapeLike(v)}%`);
    });
    where = `WHERE ${parts.join(' OR ')}`;
  }
  const rows = await db.getAllAsync(
    `SELECT * FROM foods ${where} ORDER BY use_count DESC, last_used_at DESC, name LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map((r) => rowToObject('food', r));
};

export const getFoodByBarcode = async (barcode) => {
  const row = await getJournalDb().getFirstAsync(
    'SELECT * FROM foods WHERE barcode = ? ORDER BY use_count DESC LIMIT 1', [String(barcode || '').trim()],
  );
  return row ? rowToObject('food', row) : null;
};

export const listRecentFoods = async (limit = 15) => {
  const rows = await getJournalDb().getAllAsync(
    'SELECT * FROM foods WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT ?', [limit],
  );
  return rows.map((r) => rowToObject('food', r));
};

export const listFrequentFoods = async (limit = 15) => {
  const rows = await getJournalDb().getAllAsync(
    'SELECT * FROM foods WHERE use_count > 0 ORDER BY use_count DESC, last_used_at DESC LIMIT ?', [limit],
  );
  return rows.map((r) => rowToObject('food', r));
};

const foodData = (food) => ({
  name: food.name,
  brand: food.brand ?? null,
  kcal_100: round2(food.kcal_100),
  protein_100: round2(food.protein_100),
  fat_100: round2(food.fat_100),
  carbs_100: round2(food.carbs_100),
  serving_g: food.serving_g ? round2(food.serving_g) : null,
  barcode: food.barcode || null,
  source: food.source || 'manual',
  is_recipe: !!food.is_recipe,
  recipe_yield_g: food.is_recipe && food.recipe_yield_g ? round2(food.recipe_yield_g) : null,
  use_count: food.use_count || 0,
  last_used_at: food.last_used_at || null,
});

export const saveFood = (food, uuid = null) => saveEntity('food', foodData(food), uuid);
export const deleteFood = (uuid) => deleteEntity('food', uuid);

// ---------------------------------------------------------------- рецепты

export const listRecipeItems = async (recipeUuid) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT ri.*, f.name AS ingredient_name, f.kcal_100, f.protein_100, f.fat_100, f.carbs_100
     FROM recipe_items ri JOIN foods f ON f.uuid = ri.ingredient_uuid
     WHERE ri.recipe_uuid = ? ORDER BY ri.created_at`,
    [recipeUuid],
  );
  return rows.map((r) => ({ ...rowToObject('recipe_item', r), ingredient_name: r.ingredient_name, per100: per100Of(r) }));
};

/**
 * Сохранение рецепта: КБЖУ на 100 г пересчитывается из ингредиентов,
 * строки ингредиентов синхронизируются (удалённые - удаляются).
 * @param {object} recipe - { name, recipe_yield_g, ... }
 * @param {Array<{uuid?, ingredient_uuid, grams, per100}>} items
 */
export const saveRecipe = async (recipe, items, uuid = null) => {
  const { per100 } = recipePer100(items.map((i) => ({ per100: i.per100, grams: i.grams })), recipe.recipe_yield_g);
  const existing = uuid ? await getFood(uuid) : null;
  const recipeUuid = await saveFood({
    ...(existing || {}),
    ...recipe,
    is_recipe: true,
    source: 'recipe',
    kcal_100: per100.kcal,
    protein_100: per100.protein,
    fat_100: per100.fat,
    carbs_100: per100.carbs,
  }, uuid);
  const current = await listRecipeItems(recipeUuid);
  const keep = new Set(items.filter((i) => i.uuid).map((i) => i.uuid));
  for (const old of current) {
    if (!keep.has(old.uuid)) await deleteEntity('recipe_item', old.uuid);
  }
  for (const item of items) {
    await saveEntity('recipe_item', {
      recipe_uuid: recipeUuid, ingredient_uuid: item.ingredient_uuid, grams: round2(item.grams),
    }, item.uuid || null);
  }
  return recipeUuid;
};

// ---------------------------------------------------------------- записи о еде

export const listFoodEntriesByDate = async (date) => {
  const rows = await getJournalDb().getAllAsync(
    `SELECT e.*, m.name AS meal_name, m.sort_order AS meal_order
     FROM food_entries e LEFT JOIN meal_types m ON m.uuid = e.meal_type_uuid
     WHERE e.entry_date = ?
     ORDER BY e.entry_time IS NULL, e.entry_time, e.created_at`,
    [date],
  );
  return rows.map((r) => ({ ...rowToObject('food_entry', r), meal_name: r.meal_name, meal_order: r.meal_order }));
};

export const getFoodEntry = (uuid) => getEntity('food_entry', uuid);

const entryData = (entry) => ({
  entry_date: entry.entry_date,
  entry_time: entry.entry_time || null,
  meal_type_uuid: entry.meal_type_uuid || null,
  food_uuid: entry.food_uuid || null,
  name: String(entry.name || '').trim().slice(0, 200),
  grams: round2(entry.grams),
  kcal: round2(entry.kcal),
  protein: round2(entry.protein),
  fat: round2(entry.fat),
  carbs: round2(entry.carbs),
  note: entry.note || null,
});

// Отметка использования продукта (для «недавних» и «частых»)
const touchFood = async (foodUuid) => {
  if (!foodUuid) return;
  const food = await getFood(foodUuid);
  if (!food) return;
  await saveFood({ ...food, use_count: (food.use_count || 0) + 1, last_used_at: new Date().toISOString() }, food.uuid);
};

// uuid можно задать и для новой записи (к нему заранее привязаны фото)
export const saveFoodEntry = async (entry, uuid = null) => {
  const isNew = !uuid || !(await getFoodEntry(uuid));
  const id = await saveEntity('food_entry', entryData(entry), uuid);
  if (isNew) await touchFood(entry.food_uuid);
  return id;
};

// Запись из продукта базы: снимок КБЖУ порции
export const entryFromFood = (food, grams, extra = {}) => ({
  name: food.name,
  food_uuid: food.uuid,
  grams,
  ...portion(per100Of(food), grams),
  ...extra,
});

export const deleteFoodEntry = (uuid) => deleteEntity('food_entry', uuid);

// ---------------------------------------------------------------- вода

export const addWater = (date, amountMl, time = nowTime()) => saveEntity('water_entry', {
  entry_date: date, entry_time: time, amount_ml: Math.max(1, Math.min(5000, Math.round(amountMl))),
});

export const listWaterByDate = async (date) => {
  const rows = await getJournalDb().getAllAsync(
    'SELECT * FROM water_entries WHERE entry_date = ? ORDER BY entry_time, created_at', [date],
  );
  return rows.map((r) => rowToObject('water_entry', r));
};

// Отмена последней порции воды за день
export const removeLastWater = async (date) => {
  const row = await getJournalDb().getFirstAsync(
    'SELECT uuid FROM water_entries WHERE entry_date = ? ORDER BY entry_time DESC, created_at DESC LIMIT 1', [date],
  );
  if (row) await deleteEntity('water_entry', row.uuid);
  return !!row;
};

export const deleteWater = (uuid) => deleteEntity('water_entry', uuid);

// ---------------------------------------------------------------- итоги

export const loadDietDay = async (date) => {
  const [entries, water, mealTypes] = await Promise.all([
    listFoodEntriesByDate(date), listWaterByDate(date), listMealTypes(),
  ]);
  return {
    entries,
    water,
    mealTypes,
    totals: sumNutrients(entries),
    waterMl: water.reduce((s, w) => s + (Number(w.amount_ml) || 0), 0),
  };
};

// Итоги для календаря (DAY_TOTAL_PROVIDERS): ккал по дням одним запросом
export const kcalByDay = async (db, start, end) => {
  const rows = await db.getAllAsync(
    'SELECT entry_date AS d, SUM(kcal) AS kcal FROM food_entries WHERE entry_date BETWEEN ? AND ? GROUP BY entry_date',
    [start, end],
  );
  const result = {};
  rows.forEach(({ d, kcal }) => {
    if (kcal) result[d] = { kcal: Math.round(round2(kcal)) };
  });
  return result;
};
