// Имя и базовые константы ИИ-ассистента приложения.
// Вынесены в отдельный файл, чтобы имя/иконка были согласованы
// везде, где упоминается ассистент (список чатов, экран чата и т.д.).
export const AI_ASSISTANT_NAME = 'Фокси';
export const AI_ASSISTANT_SUBTITLE = 'ИИ-ассистент';
export const AI_ASSISTANT_ICON = 'sparkles';

// Ключ локального хранилища (AsyncStorage) для истории переписки с ассистентом.
// История хранится отдельно для каждого пользователя устройства.
export const getAiChatHistoryKey = (userId) => `ai_chat_history_${userId || 'guest'}`;
