import { getJournalDb } from '../database';
import { rowToObject } from '../../sync/entities';
import { deleteEntity, saveEntity } from '../repo';

// Напоминание цели (событие/трекер). В UI у цели одно напоминание.
export const getReminderFor = async (targetUuid) => {
  if (!targetUuid) return null;
  const row = await getJournalDb().getFirstAsync(
    'SELECT * FROM reminders WHERE target_uuid = ? ORDER BY created_at LIMIT 1',
    [targetUuid],
  );
  return rowToObject('reminder', row);
};

/**
 * Создаёт, изменяет или удаляет (settings = null) напоминание цели.
 * settings: { offset_min, time_of_day, rrule, enabled }
 */
export const setReminderFor = async (targetType, targetUuid, settings) => {
  const existing = await getReminderFor(targetUuid);
  if (!settings) {
    if (existing) await deleteEntity('reminder', existing.uuid);
    return null;
  }
  const data = {
    target_type: targetType,
    target_uuid: targetUuid,
    offset_min: Math.max(0, Math.min(10080, Number(settings.offset_min) || 0)),
    time_of_day: settings.time_of_day || null,
    rrule: settings.rrule || null,
    enabled: settings.enabled !== false,
  };
  const same = existing
    && existing.offset_min === data.offset_min
    && (existing.time_of_day || null) === data.time_of_day
    && (existing.rrule || null) === data.rrule
    && !!existing.enabled === data.enabled;
  if (same) return existing.uuid;
  return saveEntity('reminder', data, existing?.uuid || null);
};
