import { API_BASE_URL } from '../constants';

export const getFullUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  // Убираем лишние слеши в начале пути
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${API_BASE_URL}/${cleanPath}`;
};

export const getAvatarUrl = (url) => {
  return getFullUrl(url) || 'https://via.placeholder.com/150';
};

export const stripHtml = (html) => {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '');
};

export const formatName = (user) => {
  if (!user) return '';
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  return user.first_name || user.last_name || user.email || '';
};

export const parseISODate = (timeStr) => {
  if (!timeStr) return null;
  try {
    let dateStr = String(timeStr);
    if (dateStr && !dateStr.includes('Z') && !dateStr.includes('+')) {
      dateStr += 'Z';
    }
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch (e) {
    return null;
  }
};

export const formatMessageTime = (timeStr) => {
  const date = parseISODate(timeStr);
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const formatStatus = (status, lastSeen) => {
  // Приводим статус к нижнему регистру для надежности
  const s = (status || '').toLowerCase();
  if (s === 'online') return 'В сети';
  if (!lastSeen) return 'Был(а) недавно';

  try {
    // Если дата в формате ISO без указания таймзоны (Z), 
    // добавляем Z, чтобы JS понимал, что это UTC
    let dateStr = lastSeen;
    const date = parseISODate(dateStr);
    if (!date) return 'Был(а) недавно';
    
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Был(а) только что';
    
    if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `Был(а) ${minutes} мин. назад`;
    }

    if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `Был(а) ${hours} ч. назад`;
    }

    if (diffInSeconds < 172800) {
      return 'Был(а) вчера';
    }

    return `Был(а) ${date.toLocaleDateString()}`;
  } catch (e) {
    return 'Был(а) недавно';
  }
};

export const formatFileSize = (bytes) => {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
