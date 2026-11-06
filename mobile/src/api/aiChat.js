import api, { getAppCheckHeaderToken } from './index';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';

// Сервис для общения с backend-эндпоинтом ИИ-чата.
// Мобильное приложение НИКОГДА не обращается к Ollama напрямую - весь трафик
// идёт только через backend (POST /api/ai/chat), который уже знает адрес
// Ollama и модель (секреты/настройки хранятся только на сервере).

// Разбирает накопленный NDJSON-текст: возвращает обработанные события и остаток незавершённой строки.
const parseNdjson = (buffer) => {
  const lines = buffer.split('\n');
  const rest = lines.pop();
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Битая строка пропускается - следующие чанки всё равно придут
    }
  }
  return { events, rest };
};

export const aiChatApi = {
  /**
   * Отправляет историю сообщений диалога на backend и получает ответ ассистента целиком.
   * @param {Array<{role: 'user'|'assistant', content: string}>} messages - история диалога
   * @returns {Promise<{message: {role: 'assistant', content: string}}>}
   */
  sendMessage: (messages) => api.post('/api/ai/chat', { messages }),

  /**
   * Потоковый ответ ассистента: onDelta получает куски текста по мере генерации,
   * onReset - сигнал очистить уже пришедший текст (модель уехала в китайский, идёт повтор).
   * Возвращает итоговый текст. При 401 откатывается на обычный запрос (он обновит токен).
   * @returns {Promise<string>}
   */
  streamMessage: async (messages, { onDelta, onReset } = {}) => {
    const token = await storage.getAccessToken();
    const appCheckToken = await getAppCheckHeaderToken();

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let processed = 0;
      let buffer = '';
      let finalContent = null;
      let streamError = null;

      const handleEvents = (events) => {
        for (const event of events) {
          if (event.error) {
            streamError = event.error;
          } else if (event.reset) {
            onReset?.();
          } else if (typeof event.delta === 'string') {
            onDelta?.(event.delta);
          } else if (event.done) {
            finalContent = event.content;
          }
        }
      };

      const consumeProgress = () => {
        const text = xhr.responseText || '';
        const chunk = text.slice(processed);
        processed = text.length;
        buffer += chunk;
        const { events, rest } = parseNdjson(buffer);
        buffer = rest;
        handleEvents(events);
      };

      xhr.open('POST', `${API_BASE_URL}/api/ai/chat/stream`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/x-ndjson');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (appCheckToken) xhr.setRequestHeader('X-Firebase-AppCheck', appCheckToken);
      xhr.timeout = 300000;

      xhr.onprogress = consumeProgress;

      xhr.onerror = () => reject(new Error('Сетевая ошибка при получении ответа'));
      xhr.ontimeout = () => {
        const detail = 'ИИ отвечает слишком долго. Попробуйте ещё раз позже.';
        const err = new Error(detail);
        err.response = { data: { detail } };
        reject(err);
      };

      xhr.onload = () => {
        if (xhr.status === 401) {
          // Токен мог истечь - обычный запрос через axios обновит его и повторит попытку
          aiChatApi
            .sendMessage(messages)
            .then((response) => resolve(response?.data?.message?.content))
            .catch(reject);
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          let detail = null;
          try {
            detail = JSON.parse(xhr.responseText)?.detail;
          } catch {
            // Тело ошибки не JSON - используем общий текст ниже
          }
          const err = new Error(typeof detail === 'string' ? detail : 'Ошибка сервиса ИИ');
          err.response = { status: xhr.status, data: { detail } };
          reject(err);
          return;
        }
        consumeProgress();
        if (buffer.trim()) {
          handleEvents(parseNdjson(buffer + '\n').events);
          buffer = '';
        }
        if (streamError) {
          const err = new Error(streamError);
          err.response = { status: xhr.status, data: { detail: streamError } };
          reject(err);
          return;
        }
        if (finalContent === null) {
          reject(new Error('Пустой ответ от сервера'));
          return;
        }
        resolve(finalContent);
      };

      xhr.send(JSON.stringify({ messages }));
    });
  },
};

/**
 * Расчёт КБЖУ с ИИ: onNumbers получает формульную норму и корректировку сразу,
 * onDelta - куски текста советов по мере генерации. Возвращает итоговый текст советов.
 * При 401 ошибка с err.response.status = 401 - вызывающий код может откатиться на обычный запрос.
 * @returns {Promise<string>}
 */
export const streamNutritionPlan = async (body, { onNumbers, onDelta } = {}) => {
  const token = await storage.getAccessToken();
  const appCheckToken = await getAppCheckHeaderToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let processed = 0;
    let buffer = '';
    let finalAdvice = null;
    let streamError = null;

    const handleEvents = (events) => {
      for (const event of events) {
        if (event.error) {
          streamError = event.error;
        } else if (event.plan) {
          onNumbers?.(event);
        } else if (typeof event.delta === 'string') {
          onDelta?.(event.delta);
        } else if (event.done) {
          finalAdvice = event.advice || '';
        }
      }
    };

    const consumeProgress = () => {
      const text = xhr.responseText || '';
      const chunk = text.slice(processed);
      processed = text.length;
      buffer += chunk;
      const { events, rest } = parseNdjson(buffer);
      buffer = rest;
      handleEvents(events);
    };

    xhr.open('POST', `${API_BASE_URL}/api/journal/ai/nutrition-plan/stream`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/x-ndjson');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (appCheckToken) xhr.setRequestHeader('X-Firebase-AppCheck', appCheckToken);
    xhr.timeout = 120000;

    xhr.onprogress = consumeProgress;

    xhr.onerror = () => reject(new Error('Сетевая ошибка при получении ответа'));
    xhr.ontimeout = () => {
      const detail = 'ИИ отвечает слишком долго. Попробуйте ещё раз позже.';
      const err = new Error(detail);
      err.response = { data: { detail } };
      reject(err);
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail = null;
        try {
          detail = JSON.parse(xhr.responseText)?.detail;
        } catch {
          // Тело ошибки не JSON - используем общий текст ниже
        }
        const err = new Error(typeof detail === 'string' ? detail : 'Ошибка сервиса ИИ');
        err.response = { status: xhr.status, data: { detail } };
        reject(err);
        return;
      }
      consumeProgress();
      if (buffer.trim()) {
        handleEvents(parseNdjson(buffer + '\n').events);
        buffer = '';
      }
      if (streamError) {
        const err = new Error(streamError);
        err.response = { status: xhr.status, data: { detail: streamError } };
        reject(err);
        return;
      }
      if (finalAdvice === null) {
        reject(new Error('Пустой ответ от сервера'));
        return;
      }
      resolve(finalAdvice);
    };

    xhr.send(JSON.stringify(body));
  });
};

export default aiChatApi;
