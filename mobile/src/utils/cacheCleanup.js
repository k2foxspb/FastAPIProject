import * as FileSystem from 'expo-file-system/legacy';

const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 дня

export async function cleanOldCache() {
  try {
    const dir = FileSystem.cacheDirectory;
    const files = await FileSystem.readDirectoryAsync(dir);
    const now = Date.now();
    let deleted = 0;

    for (const file of files) {
      // Пропускаем системные папки expo
      if (!file.includes('.')) continue;

      const uri = dir + file;
      try {
        const info = await FileSystem.getInfoAsync(uri, { md5: false });
        if (!info.exists) continue;

        // modificationTime в секундах
        const ageMs = now - (info.modificationTime || 0) * 1000;
        if (ageMs > MAX_AGE_MS) {
          await FileSystem.deleteAsync(uri, { idempotent: true });
          // Удаляем маркер .done если есть
          await FileSystem.deleteAsync(uri + '.done', { idempotent: true });
          deleted++;
        }
      } catch (e) {
        // игнорируем ошибки отдельных файлов
      }
    }

    if (deleted > 0) {
      console.log(`[cacheCleanup] Удалено ${deleted} устаревших файлов из кэша`);
    }
  } catch (e) {
    console.log('[cacheCleanup] Ошибка очистки кэша:', e);
  }
}
