import axios from 'axios';
import { getToken as getAppCheckToken } from '@react-native-firebase/app-check';
import { API_BASE_URL } from '../constants';
import { storage } from '../utils/storage';
import { navigate } from '../navigation/NavigationService';

// Декодирует JWT без верификации подписи (только для проверки exp)
const decodeJwtExp = (token) => {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.exp || null;
  } catch {
    return null;
  }
};

// Возвращает true если токен истёк или истечёт в течение следующих bufferSeconds секунд
const isTokenExpiredOrExpiringSoon = (token, bufferSeconds = 300) => {
  const exp = decodeJwtExp(token);
  if (!exp) return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp - nowSeconds < bufferSeconds;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Интерцептор для добавления Firebase App Check токена
let appCheckRef = null;
let getTokenFn = null;

api.interceptors.request.use(async (config) => {
  try {
    // Импортируем модули один раз (v22+)
    if (!getTokenFn) {
      const { getAppCheck, getToken } = require('@react-native-firebase/app-check');
      if (typeof getAppCheck === 'function' && typeof getToken === 'function') {
        appCheckRef = getAppCheck();
        getTokenFn = getToken;
      }
    }

    if (getTokenFn && appCheckRef) {
      // Использование false (forceRefresh=false) позволяет Firebase SDK возвращать кэшированный токен, что очень быстро.
      const response = await getTokenFn(appCheckRef, false);
      const token = response?.token;
      if (token) {
        config.headers['X-Firebase-AppCheck'] = token;
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.log('[AppCheck Interceptor] Token acquisition skipped:', error.message);
    }
  }
  return config;
}, (error) => {
  return Promise.reject(error);
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
  getMe: (appVersion = null) => api.get('/users/me', { params: { app_version: appVersion } }),
  login: (username, password, fcmToken = null) => {
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    if (fcmToken) {
      params.append('fcm_token', fcmToken);
    }
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
  register: (formData) => api.post('/users/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),

  // Альбомы
  getAlbums: () => api.get('/users/albums'),
  getAlbum: (id) => api.get(`/users/albums/${id}`),
  createAlbum: (data) => api.post('/users/albums', data),
  updateAlbum: (id, data) => api.patch(`/users/albums/${id}`, data),
  deleteAlbum: (id) => api.delete(`/users/albums/${id}`),
  reactToAlbum: (albumId, reactionType) => api.post(`/users/albums/${albumId}/react`, null, { params: { reaction_type: reactionType } }),
  getAlbumComments: (albumId) => api.get(`/users/albums/${albumId}/comments`),
  addAlbumComment: (albumId, comment) => api.post(`/users/albums/${albumId}/comments`, { comment }),
  deleteAlbumComment: (commentId) => api.delete(`/users/albums/comments/${commentId}`),
  reactToAlbumComment: (commentId, reactionType) => api.post(`/users/albums/comments/${commentId}/react`, null, { params: { reaction_type: reactionType } }),

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
  bulkUploadPhotos: (formData) => {
    return api.post('/users/photos/bulk-upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 120000, 
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
  },
  updatePhoto: (id, data) => api.patch(`/users/photos/${id}`, data),
  deletePhoto: (id) => api.delete(`/users/photos/${id}`),
  bulkDeletePhotos: (photoIds) => api.post('/users/photos/bulk-delete', { photo_ids: photoIds }),
  reactToPhoto: (photoId, reactionType) => api.post(`/users/photos/${photoId}/react`, null, { params: { reaction_type: reactionType } }),
  getPhotoComments: (photoId) => api.get(`/users/photos/${photoId}/comments`),
  addPhotoComment: (photoId, comment) => api.post(`/users/photos/${photoId}/comments`, { comment }),
  deletePhotoComment: (commentId) => api.delete(`/users/photos/comments/${commentId}`),
  reactToPhotoComment: (commentId, reactionType) => api.post(`/users/photos/comments/${commentId}/react`, null, { params: { reaction_type: reactionType } }),
  updateFcmToken: (token) => api.post('/users/fcm-token', { fcm_token: token }),
  googleAuth: (idToken, fcmToken = null, recaptchaToken = null) => api.post('/users/firebase-auth', { id_token: idToken, fcm_token: fcmToken, recaptcha_token: recaptchaToken }),
  firebaseAuth: (idToken, fcmToken = null, recaptchaToken = null) => api.post('/users/firebase-auth', { id_token: idToken, fcm_token: fcmToken, recaptcha_token: recaptchaToken }),
  requestPhoneCode: (phoneNumber) => api.post('/users/request-phone-code', { phone_number: phoneNumber }),
  verifyPhoneCode: (phoneNumber, code) => api.post('/users/verify-phone-code', { phone_number: phoneNumber, code }),
  updateMe: (formData) => api.patch('/users/me', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),
  // Друзья
  sendFriendRequest: (userId) => api.post(`/users/friends/request/${userId}`),
  acceptFriendRequest: (userId) => api.post(`/users/friends/accept/${userId}`),
  rejectFriendRequest: (userId) => api.post(`/users/friends/reject/${userId}`),
  deleteFriend: (userId) => api.delete(`/users/friends/${userId}`),
  getFriendsList: () => api.get('/users/friends/list'),
  getFriendRequests: () => api.get('/users/friends/requests'),
  getLikedNews: () => api.get('/users/me/likes'),
  getLikedPhotos: () => api.get('/users/me/liked-photos'),
  getMyReviews: () => api.get('/users/me/reviews'),
  getMyNewsComments: () => api.get('/users/me/news-comments'),
  getMyPhotoComments: () => api.get('/users/me/photo-comments'),
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
  getReviews: (productId) => api.get(`/products/${productId}/review`),
  createReview: (data) => api.post('/reviews', data),
  deleteReview: (id) => api.delete(`/reviews/reviews/${id}`),
  reactToReview: (reviewId, reactionType) => api.post(`/reviews/${reviewId}/react`, null, { params: { reaction_type: reactionType } }),
};

export const newsApi = {
  getNews: () => api.get('/news/'),
  getNewsDetail: (id) => api.get(`/news/${id}/`),
  getUserNews: (userId) => api.get(`/news/user/${userId}`),
  createNews: (formData) => api.post('/news/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }),
  updateNews: (id, data) => api.patch(`/news/${id}/`, data),
  deleteNews: (id) => api.delete(`/news/${id}/`),
  uploadMedia: (formData) => api.post('/news/upload-media/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  reactToNews: (newsId, reactionType) => api.post(`/news/${newsId}/react`, null, { params: { reaction_type: reactionType } }),
  getNewsComments: (newsId) => api.get(`/news/${newsId}/comments`),
  addNewsComment: (newsId, comment) => api.post(`/news/${newsId}/comments`, { comment }),
  deleteNewsComment: (commentId) => api.delete(`/news/comments/${commentId}`),
  reactToNewsComment: (commentId, reactionType) => api.post(`/news/comments/${commentId}/react`, null, { params: { reaction_type: reactionType } }),
};

export const adminApi = {
  getUsers: () => api.get('/admin/users'),
  getUser: (id) => api.get(`/admin/users/${id}`),
  updateUserRole: (id, role) => api.patch(`/admin/users/${id}/role`, null, { params: { role } }),
  getPendingModeration: () => api.get('/admin/moderation/pending'),
  approveObject: (model, id) => api.post(`/admin/moderation/approve/${model}/${id}`),
  rejectObject: (model, id) => api.post(`/admin/moderation/reject/${model}/${id}`),
  uploadApp: (formData) => api.post('/admin/upload-app', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  }),
  initUpload: (data, token) => api.post('/admin/upload-app/init', data, { params: { token } }),
  getUploadStatus: (uploadId, token) => api.get(`/admin/upload-app/status/${uploadId}`, { params: { token } }),
  getLogs: (limit = 1000) => api.get('/admin/logs', { params: { limit } }),
  getAppLogs: (limit = 1000) => api.get('/admin/app-logs', { params: { limit } }),
  addAppLog: (data) => api.post('/admin/app-logs', data),
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
  cancelUpload: (uploadId, token) => api.post(`/chat/upload/cancel/${uploadId}`, {}, { params: { token } }),
  getActiveUploads: (token) => api.get('/chat/upload/active', { params: { token } }),
  sendMessage: (data, token) => api.post('/chat/message', data, { params: { token } }),
};

export const cartApi = {
  getCart: () => api.get('/cart/'),
  addItem: (productId, quantity = 1) => api.post('/cart/items', { product_id: productId, quantity }),
  updateItem: (productId, quantity) => api.put(`/cart/items/${productId}`, { quantity }),
  removeItem: (productId) => api.delete(`/cart/items/${productId}`),
};

export const ordersApi = {
  checkout: () => api.post('/orders/checkout'),
  getOrders: (page = 1, pageSize = 10) => api.get('/orders/', { params: { page, page_size: pageSize } }),
  getOrder: (id) => api.get(`/orders/${id}`),
  getOrderStatus: (id) => api.get(`/orders/${id}/status`),
};

// Добавляем перехватчик для отладки сетевых ошибок
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Проактивный рефреш: если токен истекает в течение 5 минут — обновляем заранее
const proactiveRefresh = async () => {
  if (isRefreshing) return;
  const currentToken = api.defaults.headers.common['Authorization']?.replace('Bearer ', '');
  if (!currentToken || !isTokenExpiredOrExpiringSoon(currentToken, 300)) return;

  const refreshToken = await storage.getRefreshToken();
  if (!refreshToken) return;

  isRefreshing = true;
  try {
    console.log('[API] Proactive token refresh...');
    const res = await usersApi.refreshAccessToken(refreshToken);
    const newAccessToken = res.data.access_token;
    if (newAccessToken) {
      await storage.saveTokens(newAccessToken, refreshToken);
      setAuthToken(newAccessToken);
      processQueue(null, newAccessToken);
      console.log('[API] Proactive token refresh successful');
    }
  } catch (e) {
    console.error('[API] Proactive token refresh failed:', e);
    processQueue(e, null);
  } finally {
    isRefreshing = false;
  }
};

api.interceptors.request.use(
  async config => {
    // Если токен уже есть в дефолтных заголовках — используем его (без обращения к storage)
    const defaultAuth = api.defaults.headers.common['Authorization'];
    if (defaultAuth) {
      config.headers['Authorization'] = defaultAuth;
      // Проактивно рефрешим если токен скоро истечёт (не блокируем текущий запрос)
      const token = defaultAuth.replace('Bearer ', '');
      if (isTokenExpiredOrExpiringSoon(token, 300)) {
        proactiveRefresh();
      }
    } else if (!config.headers['Authorization']) {
      // Токен не в памяти — читаем из storage (только при холодном старте)
      const token = await storage.getAccessToken();
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
        setAuthToken(token);
        // Проактивно рефрешим если токен скоро истечёт
        if (isTokenExpiredOrExpiringSoon(token, 300)) {
          proactiveRefresh();
        }
      }
    }
    console.log(`[API Request]: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  error => Promise.reject(error)
);

api.interceptors.response.use(
  response => {
    console.log(`[API Success]: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
    return response;
  },
  async error => {
    const originalRequest = error.config;
    console.log(`[API Error]: ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url} - Status: ${error.response?.status}, Message: ${error.message}`);

    // Если ошибка 401 и это не повторный запрос
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Игнорируем редирект для некоторых эндпоинтов, чтобы пользователь мог смотреть контент анонимно
      const ignoredUrls = ['/news/', '/products/'];
      const isIgnored = ignoredUrls.some(url => originalRequest.url.includes(url));

      // Если URL в списке игнорируемых и у нас нет refresh токена, просто возвращаем ошибку без редиректа
      const refreshToken = await storage.getRefreshToken();
      if (isIgnored && !refreshToken) {
        console.log(`[API] 401 for ignored URL ${originalRequest.url} and no refresh token, skipping redirect`);
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        })
          .then(token => {
            originalRequest.headers['Authorization'] = 'Bearer ' + token;
            return api(originalRequest);
          })
          .catch(err => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      return new Promise(async (resolve, reject) => {
        try {
          const refreshToken = await storage.getRefreshToken();
          if (refreshToken) {
            console.log('[API] Attempting to refresh token...');
            const res = await usersApi.refreshAccessToken(refreshToken);
            const newAccessToken = res.data.access_token;
            
            if (newAccessToken) {
              await storage.saveTokens(newAccessToken, refreshToken);
              setAuthToken(newAccessToken);
              processQueue(null, newAccessToken);
              originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
              resolve(api(originalRequest));
            } else {
              throw new Error('No access token in refresh response');
            }
          } else {
            console.log('[API] No refresh token available');
            await storage.clearTokens();
            setAuthToken(null);
            
            if (!isIgnored) {
              console.log('[API] Redirecting to login');
              navigate('Profile', { screen: 'Login' });
            }
            throw new Error('No refresh token available');
          }
        } catch (refreshError) {
          console.error('[API] Failed to refresh token:', refreshError);
          processQueue(refreshError, null);
          await storage.clearTokens();
          setAuthToken(null);
          
          if (!isIgnored) {
             console.log('[API] Redirecting to login');
             navigate('Profile', { screen: 'Login' });
          }
          reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      });
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
