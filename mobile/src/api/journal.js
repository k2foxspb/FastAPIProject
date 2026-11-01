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
  // Диета: поиск по своей базе на сервере и сводка за период (итоги пересчитываются сервером)
  searchFoods: (q, page = 1, limit = 30) => api.get('/api/journal/foods/search', { params: { q, page, limit } }),
  getDietSummary: (from, to) => api.get('/api/journal/diet/summary', { params: { from, to } }),
  getFinanceBalances: () => api.get('/api/journal/finance/balances'),
  getFinanceBudgets: (month) => api.get('/api/journal/finance/budgets', { params: { month } }),
  getFinanceAnalytics: (from, to) => api.get('/api/journal/finance/analytics', { params: { from, to } }),
  getFinanceReview: (limit = 100) => api.get('/api/journal/finance/review', { params: { limit } }),
  getTransferPairs: () => api.get('/api/journal/finance/transfer-pairs'),
  mergeTransferPair: (first_uuid, second_uuid) => api.post('/api/journal/finance/transfer-pairs/merge', { first_uuid, second_uuid }),
  importPreview: (formData) => api.post('/api/journal/import/preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000,
  }),
  importCommit: (payload) => api.post('/api/journal/import/commit', payload, { timeout: 60000 }),
  getImportBatches: () => api.get('/api/journal/import/batches'),
  getImportBatch: (uuid) => api.get(`/api/journal/import/batches/${uuid}`),
  revertImportBatch: (uuid) => api.post(`/api/journal/import/batches/${uuid}/revert`),
  suggestCategories: (descriptions) => api.post('/api/journal/ai/suggest-categories', { descriptions }, { timeout: 90000 }),
  // ИИ-оценка КБЖУ по тексту: только предложение, пользователь подтверждает перед сохранением
  estimateNutrition: (text) => api.post('/api/journal/ai/estimate-nutrition', { text }, { timeout: 90000 }),
  // ИИ-аналитика по сферам журнала за период (факты считает сервер, ничего не сохраняет)
  getAnalysis: (from, to, areas) => api.get('/api/journal/ai/analysis', { params: { from, to, areas: areas.join(',') }, timeout: 120000 }),
};

// Понятный текст ошибки ИИ для пользователя
export const journalAiErrorMessage = (error) => {
  const status = error?.response?.status;
  if (!error?.response) return 'Нет соединения с сервером. ИИ-оценка работает только онлайн.';
  if (status === 429) return 'Слишком много запросов к ИИ. Попробуйте через час или введите КБЖУ вручную.';
  if (status === 504) return 'ИИ не ответил вовремя. Попробуйте ещё раз или введите КБЖУ вручную.';
  const detail = error.response.data?.detail;
  return typeof detail === 'string' ? detail : 'Не удалось получить оценку ИИ.';
};

// Файл вложения отдаётся только владельцу - запрашивать с заголовком Authorization.
export const journalAttachmentUrl = (uuid) => `${API_BASE_URL}/api/journal/attachments/${uuid}/file`;
