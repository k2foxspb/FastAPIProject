// Общий слой записи сущностей журнала: локальная запись в SQLite + постановка
// изменения в outbox (одна строка на запись - последнее состояние). UI пишет
// только через эти функции, sync применяет серверные изменения через applyRemote*.
import { ENTITIES, ENTITY_NAMES, rowToObject, rowToPayload, toDbValue } from '../sync/entities';
import { getJournalDb, notifyJournalChange, serializeWrite } from './database';
import { newUuid } from '../utils/uuid';
import { deleteLocalFile } from '../utils/files';

const nowIso = () => new Date().toISOString();

const tableOf = (entity) => ENTITIES[entity].table;

export const getEntity = async (entity, uuid) => {
  const db = getJournalDb();
  const row = await db.getFirstAsync(`SELECT * FROM ${tableOf(entity)} WHERE uuid = ?`, [uuid]);
  return rowToObject(entity, row);
};

const writeRow = async (db, entity, uuid, data, meta) => {
  const { fields } = ENTITIES[entity];
  const names = Object.keys(fields).filter((n) => Object.prototype.hasOwnProperty.call(data, n));
  const cols = ['uuid', 'updated_at', ...names];
  const values = [uuid, meta.updated_at, ...names.map((n) => toDbValue(fields[n], data[n]))];
  if (meta.server_rev !== undefined) {
    cols.push('server_rev');
    values.push(meta.server_rev);
  }
  if (meta.created_at) {
    cols.push('created_at');
    values.push(meta.created_at);
  }
  if (meta.extra) {
    Object.entries(meta.extra).forEach(([k, v]) => {
      cols.push(k);
      values.push(v);
    });
  }
  const updates = cols.filter((c) => c !== 'uuid' && c !== 'created_at').map((c) => `${c} = excluded.${c}`);
  await db.runAsync(
    `INSERT INTO ${tableOf(entity)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
     ON CONFLICT(uuid) DO UPDATE SET ${updates.join(', ')}`,
    values,
  );
};

const putOutbox = async (db, entity, uuid, op, payload, updatedAt) => {
  await db.runAsync(
    `INSERT INTO outbox (entity, uuid, op, payload, updated_at, attempts, last_error)
     VALUES (?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(entity, uuid) DO UPDATE SET op = excluded.op, payload = excluded.payload,
       updated_at = excluded.updated_at, attempts = 0, last_error = NULL`,
    [entity, uuid, op, payload ? JSON.stringify(payload) : null, updatedAt],
  );
};

// Создание или изменение записи. data - полный набор полей сущности (или изменённые
// поля поверх существующей записи). Возвращает uuid.
export const saveEntity = (entity, data, uuid = null) => serializeWrite(async () => {
  const db = getJournalDb();
  const id = uuid || newUuid();
  const updatedAt = nowIso();
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync(`SELECT * FROM ${tableOf(entity)} WHERE uuid = ?`, [id]);
    // Частичное обновление дополняется текущими полями: SQLite проверяет NOT NULL до разрешения
    // конфликта по uuid, поэтому без обязательных полей (например, tracker.name) запись падает
    const merged = existing ? { ...rowToPayload(entity, existing), ...data } : data;
    await writeRow(db, entity, id, merged, { updated_at: updatedAt, created_at: existing ? null : updatedAt });
    const row = await db.getFirstAsync(`SELECT * FROM ${tableOf(entity)} WHERE uuid = ?`, [id]);
    if (ENTITIES[entity].pushUpsert !== false) {
      await putOutbox(db, entity, id, 'upsert', rowToPayload(entity, row), updatedAt);
    }
  });
  notifyJournalChange({ entity, uuid: id, local: true });
  return id;
});

// Локальная запись без постановки в outbox (значения по умолчанию, вложения до загрузки).
export const saveLocalOnly = (entity, data, uuid, extra = null) => serializeWrite(async () => {
  const db = getJournalDb();
  await writeRow(db, entity, uuid, data, { updated_at: nowIso(), created_at: nowIso(), extra });
  notifyJournalChange({ entity, uuid, local: true });
  return uuid;
});

// Дочерние записи (как каскад на сервере): по прямым ссылкам и полиморфным.
// Ссылки с onDelete: 'set_null' не удаляют детей, а обнуляются (сервер пришлёт то же через pull).
const nullifyRefs = async (db, entity, uuid) => {
  for (const childName of ENTITY_NAMES) {
    const spec = ENTITIES[childName];
    for (const p of spec.parents || []) {
      if (p.entity === entity && p.onDelete === 'set_null') {
        const rows = await db.getAllAsync(`SELECT uuid FROM ${spec.table} WHERE ${p.field} = ?`, [uuid]);
        if (!rows.length) continue;
        await db.runAsync(`UPDATE ${spec.table} SET ${p.field} = NULL WHERE ${p.field} = ?`, [uuid]);
        // Неотправленные правки детей не должны ссылаться на удалённую запись (иначе missing_ref)
        for (const { uuid: childUuid } of rows) {
          const pending = await db.getFirstAsync(
            'SELECT op FROM outbox WHERE entity = ? AND uuid = ?', [childName, childUuid],
          );
          if (pending?.op !== 'upsert') continue;
          const row = await db.getFirstAsync(`SELECT * FROM ${spec.table} WHERE uuid = ?`, [childUuid]);
          await db.runAsync(
            'UPDATE outbox SET payload = ? WHERE entity = ? AND uuid = ?',
            [JSON.stringify(rowToPayload(childName, row)), childName, childUuid],
          );
        }
      }
    }
  }
};

const collectChildren = async (db, entity, uuid) => {
  const result = [];
  for (const childName of ENTITY_NAMES) {
    const spec = ENTITIES[childName];
    const fields = [];
    (spec.parents || []).forEach((p) => {
      if (p.entity === entity && p.onDelete !== 'set_null') fields.push(p.field);
    });
    if (spec.polyParents) fields.push(spec.polyParents.uuidField);
    for (const field of fields) {
      const rows = await db.getAllAsync(`SELECT * FROM ${spec.table} WHERE ${field} = ?`, [uuid]);
      rows.forEach((row) => result.push({ entity: childName, row }));
    }
  }
  return result;
};

const removeLocal = async (db, entity, uuid, removedFiles) => {
  await nullifyRefs(db, entity, uuid);
  const children = await collectChildren(db, entity, uuid);
  for (const child of children) {
    await removeLocal(db, child.entity, child.row.uuid, removedFiles);
    // Сервер удалит дочерние записи каскадом - локальные неотправленные изменения не нужны
    await db.runAsync('DELETE FROM outbox WHERE entity = ? AND uuid = ?', [child.entity, child.row.uuid]);
  }
  if (entity === 'attachment') {
    const att = await db.getFirstAsync('SELECT local_uri FROM attachments WHERE uuid = ?', [uuid]);
    if (att?.local_uri) removedFiles.push(att.local_uri);
  }
  await db.runAsync(`DELETE FROM ${tableOf(entity)} WHERE uuid = ?`, [uuid]);
};

// Удаление записи пользователем (с каскадом и отправкой на сервер).
export const deleteEntity = (entity, uuid) => serializeWrite(async () => {
  const db = getJournalDb();
  const removedFiles = [];
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync(`SELECT * FROM ${tableOf(entity)} WHERE uuid = ?`, [uuid]);
    if (!row) return;
    const pending = await db.getFirstAsync('SELECT op FROM outbox WHERE entity = ? AND uuid = ?', [entity, uuid]);
    const neverSynced = !row.server_rev && (
      (pending && pending.op === 'upsert')
      || (entity === 'attachment' && row.upload_state !== 'done')
    );
    await removeLocal(db, entity, uuid, removedFiles);
    if (neverSynced) {
      // Сервер о записи ещё не знает - достаточно забыть её
      await db.runAsync('DELETE FROM outbox WHERE entity = ? AND uuid = ?', [entity, uuid]);
    } else {
      await putOutbox(db, entity, uuid, 'delete', null, nowIso());
    }
  });
  removedFiles.forEach(deleteLocalFile);
  notifyJournalChange({ entity, uuid, local: true, deleted: true });
});

// ---------------------------------------------------------------- применение серверных изменений

// Возвращает true, если запись изменилась. Вызывается внутри serializeWrite (sync).
export const applyRemoteChange = async (db, { entity, client_uuid: uuid, server_rev: serverRev, deleted_at: deletedAt, data }) => {
  if (!ENTITIES[entity]) return false;
  const removedFiles = [];
  if (deletedAt || !data) {
    await removeLocal(db, entity, uuid, removedFiles);
    removedFiles.forEach(deleteLocalFile);
    return true;
  }
  const extra = {};
  if (entity === 'attachment') {
    const existing = await db.getFirstAsync('SELECT upload_state FROM attachments WHERE uuid = ?', [uuid]);
    if (!existing) extra.upload_state = 'done';
  }
  await writeRow(db, entity, uuid, data, {
    updated_at: data.updated_at || nowIso(),
    created_at: data.created_at || null,
    server_rev: serverRev || 0,
    extra: Object.keys(extra).length ? extra : null,
  });
  return true;
};

export const hasPendingOutbox = async (db, entity, uuid) => {
  const row = await db.getFirstAsync('SELECT 1 AS x FROM outbox WHERE entity = ? AND uuid = ?', [entity, uuid]);
  return !!row;
};
