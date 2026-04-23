/**
 * downloadManager — глобальный менеджер фоновых загрузок.
 *
 * Когда пользователь открывает видео (вызывает `acquireExclusive`),
 * все зарегистрированные фоновые загрузки приостанавливаются.
 * После закрытия видео (`releaseExclusive`) они возобновляются.
 */

const registeredDownloads = new Map(); // id -> { pause, resume }
let exclusiveActive = false;
let exclusiveId = null;

let _nextId = 1;
const nextId = () => String(_nextId++);

/**
 * Зарегистрировать фоновую загрузку.
 * @param {{ pause: () => void, resume: () => void }} handlers
 * @returns {string} id для последующей отмены регистрации
 */
export function registerDownload(handlers) {
  const id = nextId();
  registeredDownloads.set(id, handlers);
  // Если уже идёт эксклюзивный режим — сразу приостановить
  if (exclusiveActive) {
    try { handlers.pause(); } catch (e) {}
  }
  return id;
}

/**
 * Снять регистрацию загрузки (например, при размонтировании компонента).
 */
export function unregisterDownload(id) {
  registeredDownloads.delete(id);
}

/**
 * Захватить эксклюзивный режим (пользователь открыл видео).
 * Все остальные фоновые загрузки будут приостановлены.
 * @returns {string} exclusiveId для последующего releaseExclusive
 */
export function acquireExclusive() {
  exclusiveActive = true;
  exclusiveId = nextId();
  registeredDownloads.forEach((handlers) => {
    try { handlers.pause(); } catch (e) {}
  });
  return exclusiveId;
}

/**
 * Освободить эксклюзивный режим (пользователь закрыл видео).
 * Все приостановленные загрузки возобновятся.
 */
export function releaseExclusive(id) {
  if (id !== exclusiveId) return; // устаревший вызов
  exclusiveActive = false;
  exclusiveId = null;
  registeredDownloads.forEach((handlers) => {
    try { handlers.resume(); } catch (e) {}
  });
}

/**
 * Проверить, активен ли эксклюзивный режим.
 */
export function isExclusiveActive() {
  return exclusiveActive;
}
