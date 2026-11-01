// Расчёт КБЖУ на клиенте (совпадает с app/services/journal/nutrition.py).
// КБЖУ - не деньги: числа с округлением до сотых.

export const NUTRIENTS = ['kcal', 'protein', 'fat', 'carbs'];

export const round2 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // Округление половины вверх, как ROUND_HALF_UP на сервере (с поправкой на двоичное представление)
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-9) / 100;
};

export const per100Of = (food) => ({
  kcal: Number(food?.kcal_100) || 0,
  protein: Number(food?.protein_100) || 0,
  fat: Number(food?.fat_100) || 0,
  carbs: Number(food?.carbs_100) || 0,
});

// КБЖУ порции весом grams из значений на 100 г
export const portion = (per100, grams) => {
  const k = (Number(grams) || 0) / 100;
  const result = {};
  NUTRIENTS.forEach((n) => { result[n] = round2((Number(per100?.[n]) || 0) * k); });
  return result;
};

/**
 * КБЖУ рецепта на 100 г готового блюда.
 * @param {Array<{per100: object, grams: number}>} items - ингредиенты
 * @param {number|null} yieldG - вес готового блюда (уварка/ужарка); иначе сумма весов
 * @returns {{per100: object, weight: number}}
 */
export const recipePer100 = (items, yieldG = null) => {
  const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  let raw = 0;
  (items || []).forEach(({ per100, grams }) => {
    const g = Number(grams) || 0;
    if (g <= 0) return;
    raw += g;
    NUTRIENTS.forEach((n) => { totals[n] += (Number(per100?.[n]) || 0) * g / 100; });
  });
  const weight = Number(yieldG) > 0 ? Number(yieldG) : raw;
  if (weight <= 0) return { per100: { kcal: 0, protein: 0, fat: 0, carbs: 0 }, weight: 0 };
  const result = {};
  NUTRIENTS.forEach((n) => { result[n] = round2(totals[n] * 100 / weight); });
  return { per100: result, weight: round2(weight) };
};

// Сумма КБЖУ записей
export const sumNutrients = (entries) => {
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  (entries || []).forEach((e) => NUTRIENTS.forEach((n) => { total[n] += Number(e?.[n]) || 0; }));
  NUTRIENTS.forEach((n) => { total[n] = round2(total[n]); });
  return total;
};

// Ввод числа пользователем: «12,5» -> 12.5; пусто/некорректно -> null
export const parseAmount = (text) => {
  const s = String(text ?? '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

export const formatAmount = (value, digits = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const factor = 10 ** digits;
  return String(Math.round(n * factor) / factor).replace('.', ',');
};

export const formatKcal = (value) => `${Math.round(Number(value) || 0)} ккал`;
