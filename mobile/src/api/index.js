import axios from 'axios';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const setAuthToken = (token) => {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

export const usersApi = {
  getMe: () => api.get('/users/me'),
  login: (username, password) => {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);
    return api.post('/users/token', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  refreshAccessToken: (refreshToken) => api.post('/users/refresh-token-access', { refresh_token: refreshToken }),
  // Пользователи
  getUsers: (search) => api.get('/users/', { params: { search } }),
  getUser: (id) => api.get(`/users/${id}`),

  // Альбомы
  getAlbums: () => api.get('/users/albums'),
  getAlbum: (id) => api.get(`/users/albums/${id}`),
  createAlbum: (data) => api.post('/users/albums', data),
  updateAlbum: (id, data) => api.patch(`/users/albums/${id}`, data),
  deleteAlbum: (id) => api.delete(`/users/albums/${id}`),

  // Фотографии
  getPhoto: (id) => api.get(`/users/photos/${id}`),
  addPhoto: (data) => api.post('/users/photos', data),
  uploadPhoto: (formData) => api.post('/users/photos/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  updatePhoto: (id, data) => api.patch(`/users/photos/${id}`, data),
  deletePhoto: (id) => api.delete(`/users/photos/${id}`),
};

export const productsApi = {
  getProducts: (params) => api.get('/products/', { params }),
};

export const chatApi = {
  getHistory: (userId, token) => api.get(`/chat/history/${userId}`, { params: { token } }),
  getDialogs: (token) => api.get('/chat/dialogs', { params: { token } }),
  markAsRead: (userId, token) => api.post(`/chat/mark-as-read/${userId}`, {}, { params: { token } }),
  uploadFile: (formData) => api.post('/chat/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

// Добавляем перехватчик для отладки сетевых ошибок
api.interceptors.response.use(
  response => response,
  async error => {
    const originalRequest = error.config;

    // Если ошибка 401 и это не повторный запрос и у нас есть refresh_token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = await storage.getRefreshToken();
        if (refreshToken) {
          const res = await usersApi.refreshAccessToken(refreshToken);
          const newAccessToken = res.data.access_token;
          
          if (newAccessToken) {
            await storage.saveTokens(newAccessToken, refreshToken);
            setAuthToken(newAccessToken);
            originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
            return api(originalRequest);
          }
        }
      } catch (refreshError) {
        console.error('Failed to refresh token:', refreshError);
        // Если не удалось обновить токен, выходим из системы
        await storage.clearTokens();
        setAuthToken(null);
      }
    }

    console.log('[API Error Detail]:', {
      message: error.message,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
        headers: error.config?.headers,
      },
      status: error.response?.status,
      data: error.response?.data
    });
    return Promise.reject(error);
  }
);

export default api;
