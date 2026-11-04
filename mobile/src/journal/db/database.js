// Локальная БД журнала (expo-sqlite). Отдельный файл на пользователя - личные
// данные разных аккаунтов на одном устройстве не смешиваются.
import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

let current = null; // { userId, db }
let opening = null;

export const openJournalDb = async (userId) => {
  if (current && current.userId === userId) return current.db;
  if (opening && opening.userId === userId) return opening.promise;

  const promise = (async () => {
    if (current) {
      try {
        await current.db.closeAsync();
      } catch {
        // уже закрыта
      }
      current = null;
    }
    const db = await SQLite.openDatabaseAsync(`journal_u${userId}.db`);
    await db.execAsync('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
    await runMigrations(db);
    current = { userId, db };
    return db;
  })();
  opening = { userId, promise };
  try {
    return await promise;
  } finally {
    opening = null;
  }
};

export const getJournalDb = () => {
  if (!current) throw new Error('Журнал ещё не открыт');
  return current.db;
};

export const getJournalUserId = () => (current ? current.userId : null);

export const closeJournalDb = async () => {
  if (!current) return;
  const { db } = current;
  current = null;
  try {
    await db.closeAsync();
  } catch {
    // уже закрыта
  }
};

// Записи в БД выполняются строго по очереди: транзакции expo-sqlite на одном
// соединении не изолированы друг от друга, поэтому параллельные записи
// (UI + sync) сериализуются здесь.
let writeQueue = Promise.resolve();
export const serializeWrite = (fn) => {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => undefined);
  return run;
};

// Подписка на изменения данных (экраны перечитывают данные, sync планирует отправку).
const listeners = new Set();
export const subscribeJournalChanges = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const notifyJournalChange = (change) => {
  listeners.forEach((l) => {
    try {
      l(change);
    } catch (e) {
      console.log('[Journal] listener error', e?.message);
    }
  });
};
