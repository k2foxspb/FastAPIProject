import axios from 'axios';
import { API_BASE_URL } from '../constants';

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
  uploadFile: (formData) => api.post('/chat/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

// Добавляем перехватчик для отладки сетевых ошибок
api.interceptors.response.use(
  response => response,
  error => {
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
