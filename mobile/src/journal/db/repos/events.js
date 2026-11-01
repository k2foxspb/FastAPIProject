import { getJournalDb } from '../database';
import { rowToObject } from '../../sync/entities';
import { deleteEntity, getEntity, saveEntity } from '../repo';
import { expandEvent, parseRule } from '../../utils/recurrence';
import { occurrenceUuid } from '../../utils/uuid';

export const getEvent = (uuid) => getEntity('event', uuid);

// Экземпляры событий в диапазоне [start, end] с учётом повторений и исключений
// (та же выборка, что events_in_range на сервере).
export const eventsInRange = async (start, end) => {
  const db = getJournalDb();
  const events = (await db.getAllAsync(
    `SELECT * FROM events
     WHERE (start_date <= ? AND (
              (rrule IS NULL AND start_date >= ?)
              OR (rrule IS NOT NULL AND (until_date IS NULL OR until_date >= ?))
           ))
        OR uuid IN (SELECT event_uuid FROM event_occurrences WHERE moved_date BETWEEN ? AND ?)`,
    [end, start, start, start, end],
  )).map((r) => rowToObject('event', r));
  if (!events.length) return [];

  const placeholders = events.map(() => '?').join(', ');
  const occurrences = await db.getAllAsync(
    `SELECT * FROM event_occurrences
     WHERE event_uuid IN (${placeholders})
       AND (occurrence_date BETWEEN ? AND ? OR moved_date BETWEEN ? AND ?)`,
    [...events.map((e) => e.uuid), start, end, start, end],
  );
  const overrides = {};
  occurrences.forEach((o) => {
    if (!overrides[o.event_uuid]) overrides[o.event_uuid] = {};
    overrides[o.event_uuid][o.occurrence_date] = o;
  });

  const instances = [];
  events.forEach((event) => {
    instances.push(...expandEvent(event, overrides[event.uuid] || {}, start, end));
  });
  return instances;
};

export const saveEvent = async (data, uuid = null) => {
  const payload = { ...data };
  if (payload.rrule) {
    // UNTIL из правила дублируется в until_date - по нему фильтруется выборка (как на сервере)
    const ruleUntil = parseRule(payload.rrule).until;
    if (ruleUntil && (!payload.until_date || ruleUntil < payload.until_date)) payload.until_date = ruleUntil;
  } else {
    payload.rrule = null;
    payload.until_date = null;
  }
  return saveEntity('event', payload, uuid);
};

export const deleteEvent = (uuid) => deleteEntity('event', uuid);

// Отметка экземпляра: разовое событие меняет свой статус, повторяющееся -
// пишет исключение с детерминированным UUID (event + исходная дата).
export const setInstanceStatus = async (instance, status) => {
  if (!instance.recurring) {
    const event = await getEvent(instance.event_uuid);
    if (!event) return;
    const { uuid, created_at: c, updated_at: u, server_rev: s, ...fields } = event;
    await saveEntity('event', { ...fields, status }, uuid);
    return;
  }
  const occUuid = instance.occurrence_uuid || occurrenceUuid(instance.event_uuid, instance.original_date);
  const existing = await getEntity('event_occurrence', occUuid);
  await saveEntity('event_occurrence', {
    event_uuid: instance.event_uuid,
    occurrence_date: instance.original_date,
    status,
    moved_date: existing?.moved_date || null,
    moved_time: existing?.moved_time || null,
    done_at: status === 'done' ? new Date().toISOString() : null,
    note: existing?.note || null,
  }, occUuid);
};

// Удаление одного срабатывания повторяющегося события («только это»)
export const cancelInstance = (instance) => setInstanceStatus(instance, 'cancelled');
