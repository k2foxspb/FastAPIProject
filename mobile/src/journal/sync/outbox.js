// Очередь исходящих изменений журнала и служебные значения sync (курсор и т.п.).
import { getJournalDb } from '../db/database';

export const MAX_ATTEMPTS = 20;

export const getMeta = async (key, fallback = null) => {
  const row = await getJournalDb().getFirstAsync('SELECT value FROM sync_meta WHERE key = ?', [key]);
  return row ? row.value : fallback;
};

export const setMeta = async (key, value) => {
  await getJournalDb().runAsync(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value === null || value === undefined ? null : String(value)],
  );
};

export const getCursor = async () => Number(await getMeta('cursor', '0')) || 0;
export const setCursor = (value) => setMeta('cursor', value);

export const takeBatch = async (limit) => getJournalDb().getAllAsync(
  'SELECT * FROM outbox WHERE attempts < ? ORDER BY updated_at LIMIT ?',
  [MAX_ATTEMPTS, limit],
);

export const pendingCount = async () => {
  const db = getJournalDb();
  const a = await db.getFirstAsync('SELECT COUNT(*) AS n FROM outbox');
  const b = await db.getFirstAsync("SELECT COUNT(*) AS n FROM attachments WHERE upload_state = 'pending'");
  return (a?.n || 0) + (b?.n || 0);
};

// Записи, ожидающие отправки (для индикатора «не синхронизировано» на конкретной записи)
export const isPending = async (uuid) => {
  const row = await getJournalDb().getFirstAsync('SELECT 1 AS x FROM outbox WHERE uuid = ? LIMIT 1', [uuid]);
  return !!row;
};
