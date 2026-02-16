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

// Функция для инициализации токена из хранилища
export const initAuth = async () => {
  const token = await storage.getAccessToken();
  if (token) {
    setAuthToken(token);
  }
};

export const usersApi = {
  getMe: () => api.get('/users/me'),
  login: (username, password) => {
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    return api.post('/users/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  },
  refreshAccessToken: (refreshToken) => api.post('/users/refresh-token-access', { refresh_token: refreshToken }),
  // Пользователи
  getUsers: (search) => api.get('/users/', { params: { search } }),
  getUser: (id) => api.get(`/users/${id}`),
  register: (userData) => api.post('/users/', userData),

  // Альбомы
  getAlbums: () => api.get('/users/albums'),
  getAlbum: (id) => api.get(`/users/albums/${id}`),
  createAlbum: (data) => api.post('/users/albums', data),
  updateAlbum: (id, data) => api.patch(`/users/albums/${id}`, data),
  deleteAlbum: (id) => api.delete(`/users/albums/${id}`),

  // Фотографии
  getPhoto: (id) => api.get(`/users/photos/${id}`),
  addPhoto: (data) => api.post('/users/photos', data),
  uploadPhoto: (formData) => {
    return api.post('/users/photos/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000, 
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  },
  updatePhoto: (id, data) => api.patch(`/users/photos/${id}`, data),
  deletePhoto: (id) => api.delete(`/users/photos/${id}`),
  bulkDeletePhotos: (photoIds) => api.post('/users/photos/bulk-delete', { photo_ids: photoIds }),
  updateFcmToken: (token) => api.post('/users/fcm-token', { fcm_token: token }),
  updateMe: (formData) => api.patch('/users/me', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),
};

export const productsApi = {
  getProducts: (params) => api.get('/products/', { params }),
  getProduct: (id) => api.get(`/products/${id}`),
  createProduct: (formData) => api.post('/products/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  updateProduct: (id, formData) => api.put(`/products/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteProduct: (id) => api.delete(`/products/${id}`),
  getCategories: () => api.get('/categories'),
  createCategory: (data) => api.post('/categories', data),
};

export const newsApi = {
  getNews: () => api.get('/news'),
  getNewsDetail: (id) => api.get(`/news/${id}`),
  createNews: (data) => api.post('/news', data),
  updateNews: (id, data) => api.patch(`/news/${id}`, data),
  deleteNews: (id) => api.delete(`/news/${id}`),
};

export const adminApi = {
  getUsers: () => api.get('/admin/users'),
  updateUserRole: (id, role) => api.patch(`/admin/users/${id}/role`, null, { params: { role } }),
  getPendingModeration: () => api.get('/admin/moderation/pending'),
  approveObject: (model, id) => api.post(`/admin/moderation/approve/${model}/${id}`),
  rejectObject: (model, id) => api.post(`/admin/moderation/reject/${model}/${id}`),
};

export const chatApi = {
  getHistory: (userId, token, limit = 15, skip = 0) => api.get(`/chat/history/${userId}`, { params: { token, limit, skip } }),
  getDialogs: (token) => api.get('/chat/dialogs', { params: { token } }),
  markAsRead: (userId, token) => api.post(`/chat/mark-as-read/${userId}`, {}, { params: { token } }),
  deleteMessage: (messageId, token) => api.delete(`/chat/message/${messageId}`, { params: { token } }),
  bulkDeleteMessages: (messageIds, token) => api.post('/chat/messages/bulk-delete', { message_ids: messageIds }, { params: { token } }),
  uploadFile: (formData) => api.post('/chat/upload', formData),
  initUpload: (data, token) => api.post('/chat/upload/init', data, { params: { token } }),
  getUploadStatus: (uploadId, token) => api.get(`/chat/upload/status/${uploadId}`, { params: { token } }),
};

api.interceptors.request.use(
  async config => {
    // В React Native axios иногда плохо определяет FormData, если заголовок не задан явно
    // Но если мы задаем его вручную, мы НЕ должны добавлять boundary, axios/XMLHttpRequest сделает это сам,
    // если мы передаем FormData. Однако, в некоторых версиях RN/Axios есть баг, 
    // когда заголовок теряется или ставится application/json.
    
    // Проверяем наличие токена перед каждым запросом, если он еще не установлен
    if (!config.headers['Authorization']) {
      const token = await storage.getAccessToken();
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    console.log(`[API Request]: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  error => Promise.reject(error)
);

// Добавляем перехватчик для отладки сетевых ошибок
api.interceptors.response.use(
  response => {
    console.log(`[API Success]: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
    return response;
  },
  async error => {
    const originalRequest = error.config;
    console.log(`[API Error]: ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url} - Status: ${error.response?.status}, Message: ${error.message}`);

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
