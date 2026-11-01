import { getJournalDb } from '../database';
import { rowToObject } from '../../sync/entities';
import { deleteEntity, getEntity, saveEntity } from '../repo';

export const getDiaryEntry = (uuid) => getEntity('diary_entry', uuid);

export const listDiaryByDate = async (date) => {
  const db = getJournalDb();
  const rows = await db.getAllAsync(
    'SELECT * FROM diary_entries WHERE entry_date = ? ORDER BY entry_time IS NULL, entry_time, created_at',
    [date],
  );
  return rows.map((r) => rowToObject('diary_entry', r));
};

// Лента с поиском по тексту/заголовку и тегам. Пагинация по (entry_date, entry_time, uuid).
export const listDiary = async ({ query = '', tag = null, limit = 30, offset = 0 } = {}) => {
  const db = getJournalDb();
  const where = [];
  const params = [];
  const q = query.trim();
  if (q) {
    where.push('(title LIKE ? OR body LIKE ? OR tags LIKE ?)');
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like, like);
  }
  if (tag) {
    where.push('tags LIKE ?');
    params.push(`%${JSON.stringify(tag).slice(0, -1)}"%`);
  }
  const sql = `SELECT d.*, (SELECT COUNT(*) FROM attachments a WHERE a.owner_uuid = d.uuid) AS photo_count
    FROM diary_entries d
    ${where.length ? `WHERE ${where.join(' AND ').replace(/LIKE \?/g, "LIKE ? ESCAPE '\\'")}` : ''}
    ORDER BY entry_date DESC, entry_time DESC, created_at DESC
    LIMIT ? OFFSET ?`;
  const rows = await db.getAllAsync(sql, [...params, limit, offset]);
  return rows.map((r) => rowToObject('diary_entry', r));
};

export const listDiaryTags = async () => {
  const db = getJournalDb();
  const rows = await db.getAllAsync("SELECT tags FROM diary_entries WHERE tags IS NOT NULL AND tags != '[]'");
  const counts = {};
  rows.forEach((r) => {
    try {
      (JSON.parse(r.tags) || []).forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });
    } catch {
      // битые данные пропускаем
    }
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
};

export const saveDiaryEntry = (data, uuid = null) => saveEntity('diary_entry', data, uuid);
export const deleteDiaryEntry = (uuid) => deleteEntity('diary_entry', uuid);
