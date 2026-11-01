import { getJournalDb } from '../database';
import { deleteEntity, saveLocalOnly } from '../repo';
import { newUuid } from '../../utils/uuid';
import { copyToJournalDir, guessMime } from '../../utils/files';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];

export const listAttachments = async (ownerUuid) => {
  const db = getJournalDb();
  return db.getAllAsync('SELECT * FROM attachments WHERE owner_uuid = ? ORDER BY created_at', [ownerUuid]);
};

// Фото из галереи/камеры: копия в каталог журнала + запись «ожидает загрузки».
// Загрузку выполняет uploader после того, как запись-владелец доедет до сервера.
export const addAttachment = async (ownerType, ownerUuid, asset) => {
  const mime = asset.mimeType && ALLOWED_MIME.includes(asset.mimeType) ? asset.mimeType : guessMime(asset.uri);
  if (!ALLOWED_MIME.includes(mime)) throw new Error('Поддерживаются только фото JPEG, PNG, HEIC и WebP');
  if (asset.fileSize && asset.fileSize > MAX_ATTACHMENT_BYTES) throw new Error('Фото больше 15 МБ');
  const uuid = newUuid();
  const copied = await copyToJournalDir(asset.uri, uuid, mime);
  if (copied.size && copied.size > MAX_ATTACHMENT_BYTES) throw new Error('Фото больше 15 МБ');
  await saveLocalOnly('attachment', {
    owner_type: ownerType,
    owner_uuid: ownerUuid,
    mime,
    size_bytes: copied.size || asset.fileSize || null,
    width: asset.width || null,
    height: asset.height || null,
  }, uuid, { local_uri: copied.uri, upload_state: 'pending', upload_attempts: 0 });
  return uuid;
};

export const deleteAttachment = (uuid) => deleteEntity('attachment', uuid);
