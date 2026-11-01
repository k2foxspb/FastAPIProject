import { getJournalDb } from '../database';
import { rowToObject } from '../../sync/entities';
import { saveEntity, saveLocalOnly } from '../repo';
import { seedUuid } from '../../utils/uuid';
import { deviceTimeZone } from '../../utils/dates';

export const getSettings = async () => {
  const db = getJournalDb();
  const row = await db.getFirstAsync('SELECT * FROM settings ORDER BY server_rev DESC LIMIT 1');
  return rowToObject('settings', row);
};

// Настройки по умолчанию создаются только локально (без outbox): если на сервере
// они уже есть, первая синхронизация их перезапишет и не затрёт чужие цели.
export const ensureLocalSettings = async (userId) => {
  const existing = await getSettings();
  if (existing) return existing;
  const uuid = seedUuid(userId, 'settings');
  await saveLocalOnly('settings', { timezone: deviceTimeZone(), week_start: 1, seed_version: 0 }, uuid);
  return getSettings();
};

export const updateSettings = async (changes) => {
  const current = await getSettings();
  if (!current) return null;
  const data = {
    timezone: current.timezone,
    week_start: current.week_start,
    kcal_goal: current.kcal_goal,
    protein_g_goal: current.protein_g_goal,
    fat_g_goal: current.fat_g_goal,
    carbs_g_goal: current.carbs_g_goal,
    water_ml_goal: current.water_ml_goal,
    height_cm: current.height_cm,
    weight_kg: current.weight_kg,
    seed_version: current.seed_version || 0,
    ...changes,
  };
  await saveEntity('settings', data, current.uuid);
  return getSettings();
};
