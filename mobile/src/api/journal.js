import api from './index';
import { API_BASE_URL } from '../constants';

// «Журнал жизни»: все CRUD-операции идут через sync push/pull (см. src/journal/sync),
// остальные эндпоинты - серверные функции (вложения, календарь-агрегаты).
export const journalApi = {
  getMeta: () => api.get('/api/journal/sync/meta'),
  push: (changes, deviceId) => api.post('/api/journal/sync/push', { device_id: deviceId, changes }, { timeout: 60000 }),
  pull: (since, limit = 500) => api.get('/api/journal/sync/pull', { params: { since, limit }, timeout: 60000 }),
  uploadAttachment: (formData) => api.post('/api/journal/attachments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }),
  getCalendar: (month) => api.get('/api/journal/calendar', { params: { month } }),
  getDay: (date) => api.get('/api/journal/day', { params: { date } }),
};

// Файл вложения отдаётся только владельцу - запрашивать с заголовком Authorization.
export const journalAttachmentUrl = (uuid) => `${API_BASE_URL}/api/journal/attachments/${uuid}/file`;
