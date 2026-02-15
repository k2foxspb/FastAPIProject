import { API_BASE_URL } from '../constants';

export const getFullUrl = (path) => {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  
  // Убираем лишние слеши, если они есть
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${API_BASE_URL}/${cleanPath}`;
};
