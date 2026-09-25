/**
 * videoDownloadStore — глобальный синглтон для загрузки видео.
 *
 * Гарантирует что одно видео загружается только один раз,
 * а все подписчики (плейсхолдер + fullscreen) получают одинаковый прогресс.
 */
import * as FileSystem from 'expo-file-system/legacy';

// url -> { downloading, downloadedBytes, totalBytes, cached, localUri, listeners: Set<fn> }
const store = new Map();

// Глобальный реестр активных скачиваний (для отображения индикатора вне экрана чата)
const globalRegistry = new Map(); // url -> { url, fileName, downloadedBytes, totalBytes, status }
const globalListeners = new Set();

function notifyGlobalListeners() {
  const list = Array.from(globalRegistry.values());
  globalListeners.forEach(fn => {
    try { fn(list); } catch (e) {}
  });
}

function upsertGlobalEntry(url, patch) {
  const prev = globalRegistry.get(url) || { url };
  globalRegistry.set(url, { ...prev, ...patch });
  notifyGlobalListeners();
}

function removeGlobalEntry(url) {
  if (globalRegistry.delete(url)) {
    notifyGlobalListeners();
  }
}

export function subscribeGlobal(callback) {
  globalListeners.add(callback);
  callback(Array.from(globalRegistry.values()));
  return () => globalListeners.delete(callback);
}

export function getAllActiveDownloads() {
  return Array.from(globalRegistry.values());
}

function getEntry(url) {
  if (!store.has(url)) {
    store.set(url, {
      downloading: false,
      downloadedBytes: 0,
      totalBytes: 0,
      cached: false,
      localUri: null,
      resumable: null,
      listeners: new Set(),
    });
  }
  return store.get(url);
}

function notify(url) {
  const entry = store.get(url);
  if (!entry) return;
  const snapshot = {
    downloading: entry.downloading,
    downloadedBytes: entry.downloadedBytes,
    totalBytes: entry.totalBytes,
    cached: entry.cached,
    localUri: entry.localUri,
  };
  entry.listeners.forEach(fn => fn(snapshot));

  // Синхронизируем глобальный реестр, чтобы индикатор был виден вне экрана чата
  if (entry.downloading) {
    let fileName = url;
    try { fileName = decodeURIComponent(url.split('/').pop().split('?')[0]) || url; } catch (_) {}
    upsertGlobalEntry(url, {
      url,
      fileName,
      loaded: entry.downloadedBytes,
      total: entry.totalBytes,
      progress: entry.totalBytes ? entry.downloadedBytes / entry.totalBytes : 0,
      status: 'downloading',
      direction: 'download',
    });
  } else {
    removeGlobalEntry(url);
  }
}

export function subscribe(url, listener) {
  const entry = getEntry(url);
  entry.listeners.add(listener);
  // Immediately call with current state
  listener({
    downloading: entry.downloading,
    downloadedBytes: entry.downloadedBytes,
    totalBytes: entry.totalBytes,
    cached: entry.cached,
    localUri: entry.localUri,
  });
  return () => entry.listeners.delete(listener);
}

export function getState(url) {
  const entry = store.get(url);
  if (!entry) return { downloading: false, downloadedBytes: 0, totalBytes: 0, cached: false, localUri: null };
  return {
    downloading: entry.downloading,
    downloadedBytes: entry.downloadedBytes,
    totalBytes: entry.totalBytes,
    cached: entry.cached,
    localUri: entry.localUri,
  };
}

export async function startDownload(url, localUri, doneMarkerUri) {
  const entry = getEntry(url);

  // Already downloading or cached — don't start again
  if (entry.downloading) return;
  if (entry.cached && entry.localUri) return;

  // Check done marker
  try {
    const markerInfo = await FileSystem.getInfoAsync(doneMarkerUri);
    if (markerInfo.exists) {
      const fileInfo = await FileSystem.getInfoAsync(localUri);
      if (fileInfo.exists && fileInfo.size > 0) {
        entry.cached = true;
        entry.localUri = fileInfo.uri;
        entry.downloading = false;
        notify(url);
        return;
      } else {
        try { await FileSystem.deleteAsync(doneMarkerUri, { idempotent: true }); } catch (_) {}
        try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (_) {}
      }
    }
  } catch (_) {}

  // Delete any partial file — always start fresh
  try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (_) {}
  try { await FileSystem.deleteAsync(doneMarkerUri, { idempotent: true }); } catch (_) {}

  entry.downloading = true;
  entry.downloadedBytes = 0;
  entry.totalBytes = 0;
  entry.cached = false;
  entry.localUri = null;
  notify(url);

  const MAX_RETRIES = 3;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    let resumable = null;
    try {
      resumable = FileSystem.createDownloadResumable(
        url,
        localUri,
        {},
        (progress) => {
          const loaded = progress.totalBytesWritten || 0;
          const total = progress.totalBytesExpectedToWrite || 0;
          // Не даём индикатору "скакать" назад: если после разрыва соединения
          // докачка стартует заново, показываем максимум из уже достигнутого
          // и текущего значения, чтобы прогресс-бар не прыгал вперёд-назад.
          entry.downloadedBytes = Math.max(entry.downloadedBytes, loaded);
          if (total > 0) entry.totalBytes = total;
          notify(url);
        }
      );
      entry.resumable = resumable;

      const result = await resumable.downloadAsync();

      entry.resumable = null;

      if (result && result.uri) {
        const verify = await FileSystem.getInfoAsync(result.uri);
        if (verify.exists && verify.size > 0) {
          try { await FileSystem.writeAsStringAsync(doneMarkerUri, '1'); } catch (_) {}
          entry.cached = true;
          entry.localUri = verify.uri;
          entry.downloading = false;
          notify(url);
          return;
        } else {
          try { await FileSystem.deleteAsync(result.uri, { idempotent: true }); } catch (_) {}
        }
      }
      break;
    } catch (e) {
      entry.resumable = null;
      attempt += 1;
      const isRefused = e?.message && (e.message.includes('REFUSED_STREAM') || e.message.includes('stream was reset'));
      if (isRefused && attempt < MAX_RETRIES) {
        // Не сбрасываем entry.downloadedBytes здесь — иначе индикатор прыгнет назад к 0.
        // Math.max в колбэке прогресса не даст отображаемому значению уменьшиться,
        // даже если сама докачка технически начнётся с нуля.
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        // Delete partial file before retry
        try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch (_) {}
      } else {
        console.warn('[videoDownloadStore] download failed:', e);
        break;
      }
    }
  }

  entry.downloading = false;
  notify(url);
}

// Legacy exports for acquireExclusive/releaseExclusive (used in VideoNoteMessage/ChatScreen)
export function acquireExclusive() { return null; }
export function releaseExclusive() {}
export function isExclusiveActive() { return false; }
