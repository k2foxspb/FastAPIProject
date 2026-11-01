// Загрузка фото журнала на сервер с повторными попытками. Фото загружается после
// того, как запись-владелец доехала до сервера (иначе сервер ответит 404).
import { journalApi } from '../../api/journal';
import { getJournalDb, serializeWrite } from '../db/database';

const MAX_UPLOAD_ATTEMPTS = 8;

export const uploadPendingAttachments = async () => {
  const db = getJournalDb();
  const pending = await db.getAllAsync(
    `SELECT a.* FROM attachments a
     WHERE a.upload_state = 'pending' AND a.local_uri IS NOT NULL AND a.upload_attempts < ?
       AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.uuid = a.owner_uuid AND o.op = 'upsert')
     ORDER BY a.created_at LIMIT 20`,
    [MAX_UPLOAD_ATTEMPTS],
  );
  let uploaded = 0;
  for (const att of pending) {
    const form = new FormData();
    form.append('client_uuid', att.uuid);
    form.append('owner_type', att.owner_type);
    form.append('owner_uuid', att.owner_uuid);
    form.append('file', { uri: att.local_uri, name: att.local_uri.split('/').pop(), type: att.mime || 'image/jpeg' });
    try {
      const res = await journalApi.uploadAttachment(form);
      await serializeWrite(() => db.runAsync(
        "UPDATE attachments SET upload_state = 'done', server_rev = ?, size_bytes = COALESCE(?, size_bytes) WHERE uuid = ?",
        [res.data?.server_rev || 0, res.data?.size_bytes || null, att.uuid],
      ));
      uploaded += 1;
    } catch (e) {
      const status = e?.response?.status;
      if (!status) throw e; // нет сети - прервёмся, повторим при следующей синхронизации
      // 413/415/422 - файл не будет принят никогда; 404 - владелец ещё не на сервере
      const permanent = [413, 415, 422].includes(status);
      await serializeWrite(() => db.runAsync(
        `UPDATE attachments SET upload_attempts = upload_attempts + 1,
           upload_state = CASE WHEN ? THEN 'failed' ELSE upload_state END WHERE uuid = ?`,
        [permanent ? 1 : 0, att.uuid],
      ));
      if (status === 401 || status === 429) throw e;
    }
  }
  return uploaded;
};
