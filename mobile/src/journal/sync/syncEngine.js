// Движок синхронизации журнала: push outbox -> загрузка фото -> pull изменений.
// Запускается при появлении сети, возврате приложения на передний план и после
// локальных правок (с задержкой, чтобы собрать пачку). При ошибках сети - backoff.
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { journalApi } from '../../api/journal';
import { storage } from '../../utils/storage';
import { ENTITIES } from './entities';
import { getJournalDb, notifyJournalChange, serializeWrite, subscribeJournalChanges } from '../db/database';
import { applyRemoteChange, hasPendingOutbox } from '../db/repo';
import { MAX_ATTEMPTS, getCursor, getMeta, pendingCount, setCursor, setMeta, takeBatch } from './outbox';
import { uploadPendingAttachments } from './uploader';
import { newUuid } from '../utils/uuid';

const PUSH_BATCH = 200;
const MAX_PUSH_BYTES = 1800 * 1024; // запас до серверного лимита 2 МБ
const PULL_LIMIT = 500;
const BACKOFF_MS = [5000, 15000, 60000, 300000];
const LOCAL_CHANGE_DELAY_MS = 2000;

let state = { status: 'idle', pending: 0, lastSyncAt: null, lastError: null };
const stateListeners = new Set();
let timer = null;
let running = null;
let rerun = false;
let failures = 0;
let started = false;
let unsubscribers = [];
let isOnline = true;

const setState = (patch) => {
  state = { ...state, ...patch };
  stateListeners.forEach((l) => l(state));
};

export const getSyncState = () => state;
export const subscribeSyncState = (listener) => {
  stateListeners.add(listener);
  listener(state);
  return () => stateListeners.delete(listener);
};

const refreshPending = async () => {
  try {
    setState({ pending: await pendingCount() });
  } catch {
    // БД закрыта
  }
};

const getDeviceId = async () => {
  let id = await getMeta('device_id');
  if (!id) {
    id = newUuid();
    await setMeta('device_id', id);
  }
  return id;
};

const tableOf = (entity) => ENTITIES[entity]?.table;

// ---------------------------------------------------------------- push

const buildChanges = (rows) => {
  const changes = [];
  let size = 0;
  for (const row of rows) {
    const change = {
      entity: row.entity,
      client_uuid: row.uuid,
      op: row.op,
      updated_at: row.updated_at,
      data: row.payload ? JSON.parse(row.payload) : null,
    };
    const len = JSON.stringify(change).length;
    if (changes.length && size + len > MAX_PUSH_BYTES) break;
    changes.push({ change, row });
    size += len;
  }
  return changes;
};

const applyPushResults = async (sent, results) => {
  const db = getJournalDb();
  const byKey = new Map(sent.map(({ row }) => [`${row.entity}:${row.uuid}`, row]));
  let progressed = 0;
  let remoteChanged = false;
  await serializeWrite(() => db.withTransactionAsync(async () => {
    for (const res of results) {
      const row = byKey.get(`${res.entity}:${res.client_uuid}`);
      if (!row) continue;
      const table = tableOf(res.entity);
      if (res.status === 'applied') {
        progressed += 1;
        // Удаляем из очереди только если запись не изменилась после отправки
        await db.runAsync('DELETE FROM outbox WHERE entity = ? AND uuid = ? AND updated_at = ?', [row.entity, row.uuid, row.updated_at]);
        if (table && res.server_rev) {
          await db.runAsync(`UPDATE ${table} SET server_rev = ? WHERE uuid = ?`, [res.server_rev, row.uuid]);
        }
      } else if (res.status === 'stale') {
        // На сервере более свежая версия - она побеждает (LWW)
        progressed += 1;
        const del = await db.runAsync('DELETE FROM outbox WHERE entity = ? AND uuid = ? AND updated_at = ?', [row.entity, row.uuid, row.updated_at]);
        if (del.changes && res.current) {
          await applyRemoteChange(db, {
            entity: res.entity,
            client_uuid: res.client_uuid,
            server_rev: res.current.server_rev,
            deleted_at: res.current.deleted_at,
            data: res.current.data,
          });
          remoteChanged = true;
        }
      } else {
        // missing_ref - родитель ещё не доехал, повторим; остальные причины - не повторяем
        const retry = res.reason === 'missing_ref';
        console.log(`[JournalSync] rejected ${res.entity}: ${res.reason}`);
        await db.runAsync(
          'UPDATE outbox SET attempts = ?, last_error = ? WHERE entity = ? AND uuid = ?',
          [retry ? row.attempts + 1 : MAX_ATTEMPTS, String(res.reason || 'rejected').slice(0, 200), row.entity, row.uuid],
        );
      }
    }
  }));
  if (remoteChanged) notifyJournalChange({ remote: true });
  return progressed;
};

const pushAll = async () => {
  const deviceId = await getDeviceId();
  for (let i = 0; i < 50; i += 1) {
    const rows = await takeBatch(PUSH_BATCH);
    if (!rows.length) return;
    const sent = buildChanges(rows);
    const res = await journalApi.push(sent.map((s) => s.change), deviceId);
    const progressed = await applyPushResults(sent, res.data?.results || []);
    if (!progressed) return; // остались только отклонённые - ждём следующего цикла
  }
};

// ---------------------------------------------------------------- pull

const resetForFullResync = async () => {
  const db = getJournalDb();
  await serializeWrite(() => db.withTransactionAsync(async () => {
    for (const [entity, spec] of Object.entries(ENTITIES)) {
      // Локальные неотправленные записи и незагруженные фото сохраняем
      const extra = entity === 'attachment' ? " AND upload_state = 'done'" : '';
      await db.runAsync(
        `DELETE FROM ${spec.table} WHERE uuid NOT IN (SELECT uuid FROM outbox WHERE entity = ?)${extra}`,
        [entity],
      );
    }
    await setCursor(0);
  }));
};

const pullAll = async () => {
  const db = getJournalDb();
  let cursor = await getCursor();
  let changed = false;
  for (let i = 0; i < 200; i += 1) {
    let res;
    try {
      res = await journalApi.pull(cursor, PULL_LIMIT);
    } catch (e) {
      if (e?.response?.status === 410 && cursor !== 0) {
        console.log('[JournalSync] cursor expired, full resync');
        await resetForFullResync();
        cursor = 0;
        changed = true;
        continue;
      }
      throw e;
    }
    const { changes = [], cursor: next, has_more: hasMore } = res.data || {};
    if (changes.length) {
      await serializeWrite(() => db.withTransactionAsync(async () => {
        for (const change of changes) {
          // Локальная неотправленная правка важнее: её отправит push, конфликт решит сервер (LWW)
          if (await hasPendingOutbox(db, change.entity, change.client_uuid)) continue;
          if (await applyRemoteChange(db, change)) changed = true;
        }
        await setCursor(next);
      }));
    } else if (next !== cursor) {
      await setCursor(next);
    }
    cursor = next;
    if (!hasMore) break;
  }
  await setMeta('initial_sync_done', '1');
  if (changed) notifyJournalChange({ remote: true });
};

// ---------------------------------------------------------------- цикл

const runOnce = async () => {
  const token = await storage.getAccessToken();
  if (!token) {
    setState({ status: 'auth', lastError: 'Войдите в аккаунт, чтобы синхронизировать журнал' });
    return;
  }
  if (!isOnline) {
    setState({ status: 'offline' });
    return;
  }
  setState({ status: 'syncing', lastError: null });
  try {
    await pushAll();
    await uploadPendingAttachments();
    await pullAll();
    failures = 0;
    setState({ status: 'idle', lastSyncAt: new Date().toISOString(), lastError: null });
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      setState({ status: 'auth', lastError: 'Сессия истекла - войдите снова' });
    } else {
      failures += 1;
      const delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
      const message = status ? `Ошибка сервера (${status})` : 'Нет связи с сервером';
      setState({ status: status ? 'error' : 'offline', lastError: message });
      schedule(delay);
    }
  } finally {
    await refreshPending();
  }
};

export const syncNow = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await runOnce();
      } while (rerun);
    } finally {
      running = null;
    }
  })();
  return running;
};

function schedule(delay) {
  if (!started) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow();
  }, delay);
}

export const requestSync = (delay = LOCAL_CHANGE_DELAY_MS) => schedule(delay);

// Полная пересинхронизация по запросу пользователя (неотправленные правки сохраняются).
export const fullResync = async () => {
  if (running) await running;
  await resetForFullResync();
  notifyJournalChange({ remote: true });
  return syncNow();
};

// Изменения, которые сервер отклонил окончательно (для экрана настроек)
export const listRejectedChanges = () => getJournalDb().getAllAsync(
  'SELECT entity, uuid, op, last_error, updated_at FROM outbox WHERE attempts >= ? ORDER BY updated_at DESC LIMIT 50',
  [MAX_ATTEMPTS],
);

export const discardRejectedChanges = async () => {
  await serializeWrite(() => getJournalDb().runAsync('DELETE FROM outbox WHERE attempts >= ?', [MAX_ATTEMPTS]));
  await refreshPending();
};

export const retryRejectedChanges = async () => {
  await serializeWrite(() => getJournalDb().runAsync('UPDATE outbox SET attempts = 0 WHERE attempts >= ?', [MAX_ATTEMPTS]));
  return syncNow();
};

export const startSyncEngine = () => {
  if (started) return;
  started = true;
  failures = 0;
  const appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active') schedule(300);
  });
  unsubscribers = [
    NetInfo.addEventListener((net) => {
      const online = !!net.isConnected && net.isInternetReachable !== false;
      const cameOnline = online && !isOnline;
      isOnline = online;
      if (cameOnline) schedule(500);
      else if (!online) setState({ status: 'offline' });
    }),
    () => appStateSub.remove(),
    subscribeJournalChanges((change) => {
      if (change?.local) {
        refreshPending();
        schedule(LOCAL_CHANGE_DELAY_MS);
      }
    }),
  ];
  refreshPending();
  schedule(0);
};

export const stopSyncEngine = () => {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
  unsubscribers.forEach((u) => {
    try {
      u();
    } catch {
      // уже отписаны
    }
  });
  unsubscribers = [];
  setState({ status: 'idle', pending: 0, lastError: null });
};
