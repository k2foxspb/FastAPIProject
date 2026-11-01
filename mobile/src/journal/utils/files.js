// Локальные копии фото журнала: лежат в documentDirectory/journal/ до (и после)
// загрузки на сервер, чтобы запись показывала фото и офлайн.
import { copyAsync, deleteAsync, documentDirectory, getInfoAsync, makeDirectoryAsync } from 'expo-file-system/legacy';

const DIR = `${documentDirectory}journal/`;

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
};

export const guessMime = (uri, fallback = 'image/jpeg') => {
  const ext = String(uri || '').split('?')[0].split('.').pop().toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp' };
  return map[ext] || fallback;
};

export const copyToJournalDir = async (sourceUri, uuid, mime) => {
  const info = await getInfoAsync(DIR);
  if (!info.exists) await makeDirectoryAsync(DIR, { intermediates: true });
  const target = `${DIR}${uuid}.${EXT_BY_MIME[mime] || 'jpg'}`;
  await copyAsync({ from: sourceUri, to: target });
  const copied = await getInfoAsync(target);
  return { uri: target, size: copied.exists ? copied.size : null };
};

export const deleteLocalFile = (uri) => {
  if (!uri || !uri.startsWith(DIR)) return;
  deleteAsync(uri, { idempotent: true }).catch(() => undefined);
};
