import { getJournalDb } from '../database';
import { rowToObject } from '../../sync/entities';
import { deleteEntity, getEntity, saveEntity } from '../repo';

// Шаблоны трекеров (совпадают с TRACKER_TEMPLATES на сервере)
export const TRACKER_TEMPLATES = [
  { template_key: 'weight', name: 'Вес', value_type: 'number', unit: 'кг', icon: 'scale-outline', color: '#4F8EF7', frequency: 'daily' },
  { template_key: 'sleep', name: 'Сон', value_type: 'duration', unit: 'мин', icon: 'bed-outline', color: '#7E57C2', frequency: 'daily' },
  { template_key: 'mood', name: 'Настроение', value_type: 'scale', scale_min: 1, scale_max: 5, icon: 'happy-outline', color: '#FFB300', frequency: 'daily' },
  { template_key: 'wellbeing', name: 'Самочувствие', value_type: 'scale', scale_min: 1, scale_max: 10, icon: 'heart-outline', color: '#E53935', frequency: 'daily' },
  { template_key: 'habit', name: 'Привычка', value_type: 'bool', icon: 'checkmark-done-outline', color: '#43A047', frequency: 'daily' },
];

export const VALUE_TYPES = [
  { key: 'number', label: 'Число' },
  { key: 'bool', label: 'Да/нет' },
  { key: 'scale', label: 'Шкала' },
  { key: 'duration', label: 'Время' },
  { key: 'text', label: 'Текст' },
];

export const getTracker = (uuid) => getEntity('tracker', uuid);

// Трекеры с последним значением (одним запросом)
export const listTrackers = async ({ includeArchived = false } = {}) => {
  const db = getJournalDb();
  const rows = await db.getAllAsync(
    `SELECT t.*,
       (SELECT v.num_value FROM tracker_values v WHERE v.tracker_uuid = t.uuid
          ORDER BY v.value_date DESC, v.value_time DESC, v.created_at DESC LIMIT 1) AS last_num,
       (SELECT v.text_value FROM tracker_values v WHERE v.tracker_uuid = t.uuid
          ORDER BY v.value_date DESC, v.value_time DESC, v.created_at DESC LIMIT 1) AS last_text,
       (SELECT v.value_date FROM tracker_values v WHERE v.tracker_uuid = t.uuid
          ORDER BY v.value_date DESC, v.value_time DESC, v.created_at DESC LIMIT 1) AS last_date
     FROM trackers t
     ${includeArchived ? '' : 'WHERE t.archived = 0'}
     ORDER BY t.archived, t.sort_order, t.name`,
  );
  return rows.map((r) => rowToObject('tracker', r));
};

export const saveTracker = (data, uuid = null) => saveEntity('tracker', data, uuid);
export const deleteTracker = (uuid) => deleteEntity('tracker', uuid);

export const listTrackerValues = async (trackerUuid, { from = null, to = null, limit = 500 } = {}) => {
  const db = getJournalDb();
  const where = ['tracker_uuid = ?'];
  const params = [trackerUuid];
  if (from) {
    where.push('value_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('value_date <= ?');
    params.push(to);
  }
  const rows = await db.getAllAsync(
    `SELECT * FROM tracker_values WHERE ${where.join(' AND ')}
     ORDER BY value_date DESC, value_time DESC, created_at DESC LIMIT ?`,
    [...params, limit],
  );
  return rows.map((r) => rowToObject('tracker_value', r));
};

export const listValuesByDate = async (date) => {
  const db = getJournalDb();
  const rows = await db.getAllAsync(
    `SELECT v.*, t.name AS tracker_name, t.unit AS tracker_unit, t.value_type AS tracker_value_type,
            t.icon AS tracker_icon, t.color AS tracker_color
     FROM tracker_values v JOIN trackers t ON t.uuid = v.tracker_uuid
     WHERE v.value_date = ?
     ORDER BY v.value_time IS NULL, v.value_time, v.created_at`,
    [date],
  );
  return rows.map((r) => rowToObject('tracker_value', r));
};

export const saveTrackerValue = (data, uuid = null) => saveEntity('tracker_value', data, uuid);
export const deleteTrackerValue = (uuid) => deleteEntity('tracker_value', uuid);

// Отображение значения трекера
export const formatTrackerValue = (tracker, value) => {
  if (!value) return '—';
  const type = tracker.value_type || tracker.tracker_value_type;
  const unit = tracker.unit || tracker.tracker_unit;
  const num = value.num_value ?? value.last_num;
  const text = value.text_value ?? value.last_text;
  if (type === 'text') return text || '—';
  if (num === null || num === undefined) return '—';
  if (type === 'bool') return Number(num) ? 'Да' : 'Нет';
  if (type === 'duration') {
    const total = Math.round(Number(num));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? `${h} ч ${m} мин` : `${m} мин`;
  }
  const formatted = String(Math.round(Number(num) * 100) / 100).replace('.', ',');
  if (type === 'scale') return `${formatted} из ${tracker.scale_max ?? ''}`.trim();
  return unit ? `${formatted} ${unit}` : formatted;
};

// Прогресс к цели: достигнута ли цель по последнему значению
export const hasGoal = (tracker) => tracker.goal_value !== null && tracker.goal_value !== undefined && tracker.value_type !== 'text';

export const goalStatus = (tracker, lastNum) => {
  if (!hasGoal(tracker)) return null;
  const goal = Number(tracker.goal_value);
  const direction = tracker.goal_direction || 'reach';
  const reached = direction === 'not_exceed'
    ? lastNum !== null && lastNum !== undefined && Number(lastNum) <= goal
    : lastNum !== null && lastNum !== undefined && Number(lastNum) >= goal;
  return { goal, direction, reached: !!reached, hasValue: lastNum !== null && lastNum !== undefined };
};
