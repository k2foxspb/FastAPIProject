import api from './index';

// Сервис для общения с backend-эндпоинтом ИИ-чата.
// Мобильное приложение НИКОГДА не обращается к Ollama напрямую - весь трафик
// идёт только через backend (POST /api/ai/chat), который уже знает адрес
// Ollama и модель (секреты/настройки хранятся только на сервере).
export const aiChatApi = {
  /**
   * Отправляет историю сообщений диалога на backend и получает ответ ассистента.
   * @param {Array<{role: 'user'|'assistant', content: string}>} messages - история диалога
   * @returns {Promise<{message: {role: 'assistant', content: string}}>}
   */
  sendMessage: (messages) => api.post('/api/ai/chat', { messages }),
};

export default aiChatApi;
