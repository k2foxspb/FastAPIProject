import { API_BASE_URL } from '../../constants';

// Размер страницы при подгрузке истории сообщений
export const HISTORY_LIMIT = 15;

export const generateClientId = () => `c_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const emptyUploadingData = () => ({ loaded: 0, total: 0, uri: null, mimeType: null });

export const getMediaTypeFromMime = (mimeType) => {
  const mt = mimeType || '';
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'voice';
  return 'file';
};

export const resolveMediaUri = (filePath) => (
  filePath.startsWith('http') ? filePath : `${API_BASE_URL}${filePath}`
);

// Собираем все медиафайлы из сообщений для полноэкранного просмотра.
// Сообщения в messages идут от новых к старым (inverted FlatList).
// Пользователь хочет, чтобы скролл вправо (увеличение индекса в allMedia)
// вел к БОЛЕЕ ПОЗДНИМ (новым) видео. Значит allMedia должен быть от СТАРЫХ к НОВЫМ.
// Для этого итерируем messages с конца.
export const collectMediaFromMessages = (messages) => {
  const media = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.message_type === 'media_group' && msg.attachments) {
      msg.attachments.forEach(att => {
        if (att.file_path && att.type !== 'video_note') {
          media.push({
            uri: resolveMediaUri(att.file_path),
            file_path: att.file_path,
            type: att.type,
            messageId: msg.id
          });
        }
      });
    } else if ((msg.message_type === 'image' || msg.message_type === 'video') && msg.file_path && msg.message_type !== 'video_note') {
      media.push({
        uri: resolveMediaUri(msg.file_path),
        file_path: msg.file_path,
        type: msg.message_type,
        messageId: msg.id
      });
    }
  }
  return media;
};

export const buildOptimisticMessage = (msgData, currentUserId, replyTo = null) => ({
  ...msgData,
  id: msgData.client_id, // используем clientId как временный id для FlatList key
  sender_id: currentUserId,
  timestamp: new Date().toISOString(),
  is_read: false,
  status: 'pending', // Статус для визуализации
  reply_to: replyTo
});

// Собираем данные для пересылки сообщения другому пользователю.
// Переиспользуем уже загруженные файлы (file_path/attachments), поэтому повторная загрузка не нужна.
// Если пересылаемое сообщение уже было переслано ранее, сохраняем ссылку на самого первого автора (не переписываем цепочку).
export const buildForwardMessageData = (message, receiverId) => {
  const msgData = {
    receiver_id: receiverId,
    client_id: generateClientId(),
    message_type: message.message_type || 'text',
    forwarded_from_id: message.forwarded_from_id || message.sender_id,
    forwarded_from_name: message.forwarded_from_name || message.sender_name,
  };

  if (message.message) {
    msgData.message = message.message;
  }
  if (message.duration) {
    msgData.duration = message.duration;
  }

  if (message.message_type === 'media_group' && message.attachments && message.attachments.length > 0) {
    msgData.attachments = message.attachments.map(att => ({ file_path: att.file_path, type: att.type }));
  } else if (message.file_path) {
    msgData.file_path = message.file_path;
  }

  return msgData;
};

export const getReplyPreviewText = (msg) => (
  msg.message || (msg.message_type === 'image' ? 'Фотография' : (msg.message_type === 'voice' ? 'Голосовое сообщение' : 'Файл'))
);

export const formatMediaTime = (seconds) => {
  const totalSeconds = Math.floor(seconds || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
};

export const formatRecordingTime = (millis) => {
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
};

export const formatBytesRu = (bytes) => (
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`
);

export const isVideoMedia = (mediaItem) => (
  mediaItem?.type === 'video' || mediaItem?.message_type === 'video'
);
