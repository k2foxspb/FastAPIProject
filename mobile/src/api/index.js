import axios from 'axios';
import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://192.168.1.100:8000';

const api = axios.create({
  baseURL: API_URL,
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
  getUsers: (search) => api.get('/users/', { params: { search } }),
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

export default api;
