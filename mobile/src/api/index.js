import axios from 'axios';
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

const extractBearer = (headerValue) => {
  if (!headerValue || typeof headerValue !== 'string') return null;
  return headerValue.replace(/^Bearer\s+/i, '') || null;
};

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
});

// Отдельный клиент для обновления токена: без интерцепторов, чтобы 401 на самом
// refresh-запросе не попадал обратно в очередь ожидания и не вызывал дедлок.
const authClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// Интерцептор для добавления Firebase App Check токена
// Максимальное время ожидания App Check токена. На холодном старте Play Integrity
// может отвечать несколько секунд — не блокируем из-за этого загрузку контента.
const APP_CHECK_TIMEOUT_MS = 4000;
let appCheckRef = null;
let getTokenFn = null;
let appCheckUnavailable = false;

const getAppCheckToken = async () => {
  if (appCheckUnavailable) return null;
  try {
    // Импортируем модули один раз (v22+)
    if (!getTokenFn) {
      const { getAppCheck, getToken } = require('@react-native-firebase/app-check');
      if (typeof getAppCheck === 'function' && typeof getToken === 'function') {
        appCheckRef = getAppCheck();
        getTokenFn = getToken;
      } else {
        appCheckUnavailable = true;
        return null;
      }
    }

    // Использование false (forceRefresh=false) позволяет Firebase SDK возвращать кэшированный токен, что очень быстро.
    const tokenPromise = getTokenFn(appCheckRef, false).then(response => response?.token || null);
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), APP_CHECK_TIMEOUT_MS));
    const token = await Promise.race([tokenPromise, timeoutPromise]);
    if (!token && __DEV__) {
      console.log('[AppCheck Interceptor] Token not ready within timeout, sending request without it');
    }
    return token;
  } catch (error) {
    if (__DEV__) {
      console.log('[AppCheck Interceptor] Token acquisition skipped:', error.message);
    }
    return null;
  }
};

// Прогрев App Check токена при старте, чтобы первый запрос не ждал аттестацию
export const warmUpAppCheck = () => getAppCheckToken().catch(() => null);

api.interceptors.request.use(async (config) => {
  const token = await getAppCheckToken();
  if (token) {
    config.headers['X-Firebase-AppCheck'] = token;
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
  refreshAccessToken: (refreshToken) => authClient.post('/users/refresh-token-access', { refresh_token: refreshToken }),
  // Пользователи
  getUsers: (search) => api.get('/users/', { params: { search } }),
  getUser: (id) => api.get(`/users/${id}`),

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
  getMyNewsComments: () => api.get('/users/me/news-comments'),
  getMyPhotoComments: () => api.get('/users/me/photo-comments'),
  // Настройки уведомлений: отключение по группам + "тихие часы" (без звука)
  getNotificationSettings: () => api.get('/users/me/notification-settings'),
  updateNotificationSettings: (data) => api.patch('/users/me/notification-settings', data),
  // Личные публикации в профиле (Profile Posts)
  getProfilePosts: (userId) => api.get(`/users/${userId}/posts`),
  createProfilePost: (data) => api.post('/users/me/posts', data),
  updateProfilePost: (postId, data) => api.patch(`/users/me/posts/${postId}`, data),
  deleteProfilePost: (postId) => api.delete(`/users/me/posts/${postId}`),
  reactToProfilePost: (postId, reactionType) => api.post(`/users/posts/${postId}/react`, null, { params: { reaction_type: reactionType } }),
  getProfilePostComments: (postId) => api.get(`/users/posts/${postId}/comments`),
  addProfilePostComment: (postId, comment) => api.post(`/users/posts/${postId}/comments`, { comment }),
  deleteProfilePostComment: (commentId) => api.delete(`/users/posts/comments/${commentId}`),
};

// Единая лента - объединяет новости, публичные/дружеские публикации пользователей
// и объявления (ProfilePost с post_type="announcement"), каждый элемент содержит item_type.
export const feedApi = {
  getFeed: (skip = 0, limit = 20) => api.get('/feed', { params: { skip, limit } }),
  createPost: (data) => api.post('/users/me/posts', data),
  createAnnouncement: (data) => api.post('/feed/announcements', data),
  moderatePost: (postId) => api.post(`/posts/${postId}/moderate`),
  hidePost: (postId) => api.post(`/posts/${postId}/hide`),
  unhidePost: (postId) => api.post(`/posts/${postId}/unhide`),
  deletePost: (postId) => api.delete(`/posts/${postId}`),
};

export const notificationsApi = {
  getNotifications: (skip = 0, limit = 20) => api.get('/notifications', { params: { skip, limit } }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
  getSettings: () => api.get('/notifications/settings'),
  updateSettings: (data) => api.put('/notifications/settings', data),
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
  banUser: (id, { reason, durationHours } = {}) => api.post(`/admin/users/${id}/ban`, { reason, duration_hours: durationHours }),
  unbanUser: (id) => api.post(`/admin/users/${id}/unban`),
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

export const groupChatApi = {
  createGroup: (name, memberIds = [], avatarUrl = null) => api.post('/chat/groups', { name, member_ids: memberIds, avatar_url: avatarUrl }),
  getMyGroups: () => api.get('/chat/groups'),
  getGroup: (groupId) => api.get(`/chat/groups/${groupId}`),
  updateGroup: (groupId, data) => api.patch(`/chat/groups/${groupId}`, data),
  addMembers: (groupId, userIds) => api.post(`/chat/groups/${groupId}/members`, { user_ids: userIds }),
  removeMember: (groupId, userId) => api.delete(`/chat/groups/${groupId}/members/${userId}`),
  promoteToAdmin: (groupId, userId) => api.post(`/chat/groups/${groupId}/admins/${userId}`),
  demoteAdmin: (groupId, userId) => api.delete(`/chat/groups/${groupId}/admins/${userId}`),
  leaveGroup: (groupId) => api.post(`/chat/groups/${groupId}/leave`),
  deleteGroup: (groupId) => api.delete(`/chat/groups/${groupId}`),
};

// ---------------------------------------------------------------------------
// Обновление access-токена
// ---------------------------------------------------------------------------
// Единый promise на все параллельные запросы: пока идёт refresh, все ждут его
// результат. Нет очереди failedQueue и флага isRefreshing, которые раньше могли
// «зависнуть», если сам refresh-запрос вернул 401 (бесконечная загрузка).
let refreshPromise = null;

const NO_REFRESH_TOKEN = 'NO_REFRESH_TOKEN';

const refreshTokens = () => {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await storage.getRefreshToken();
    if (!refreshToken) {
      const err = new Error('No refresh token available');
      err.code = NO_REFRESH_TOKEN;
      throw err;
    }

    console.log('[API] Refreshing access token...');
    const res = await usersApi.refreshAccessToken(refreshToken);
    const newAccessToken = res.data?.access_token;
    if (!newAccessToken) {
      throw new Error('No access token in refresh response');
    }

    await storage.saveTokens(newAccessToken, refreshToken);
    setAuthToken(newAccessToken);
    console.log('[API] Access token refreshed');
    return newAccessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
};

// Сессия действительно недействительна (а не временная сетевая ошибка):
// нет refresh-токена либо сервер отверг его (4xx).
const isSessionInvalid = (err) => {
  if (err?.code === NO_REFRESH_TOKEN) return true;
  const status = err?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
};

const handleSessionExpired = async (redirectToLogin) => {
  await storage.clearTokens();
  setAuthToken(null);
  if (redirectToLogin) {
    console.log('[API] Session expired, redirecting to login');
    navigate('Profile', { screen: 'Login' });
  }
};

// 401 от App Check — это не проблема авторизации пользователя, refresh не поможет
const isAppCheckError = (error) => {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' && detail.includes('App Check');
};

// Эндпоинты, которые можно смотреть анонимно — при 401 не редиректим на логин
const ignoredUrls = ['/news/'];
const isIgnoredUrl = (url) => ignoredUrls.some(ignored => (url || '').includes(ignored));

api.interceptors.request.use(
  async config => {
    // Берём токен из заголовков (явно переданный или дефолтный), иначе из storage (холодный старт)
    let token = extractBearer(config.headers?.['Authorization']) || extractBearer(api.defaults.headers.common['Authorization']);
    if (!token) {
      token = await storage.getAccessToken();
      if (token) {
        setAuthToken(token);
      }
    }

    if (token) {
      if (isTokenExpiredOrExpiringSoon(token, 0)) {
        // Токен уже истёк — обновляем до отправки, иначе гарантированно получим 401 и лишний круг
        try {
          token = await refreshTokens();
        } catch (e) {
          console.log('[API] Pre-request refresh failed:', e.message);
          if (isSessionInvalid(e)) {
            await handleSessionExpired(false);
            token = null;
          }
        }
      } else if (isTokenExpiredOrExpiringSoon(token, 300)) {
        // Истекает в ближайшие 5 минут — обновляем в фоне, текущий запрос не блокируем
        refreshTokens().catch(e => console.log('[API] Background refresh failed:', e.message));
      }
    }

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    } else {
      delete config.headers['Authorization'];
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
    const status = error.response?.status;
    console.log(`[API Error]: ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url} - Status: ${status}, Message: ${error.message}`);

    // Если ошибка 401 (не App Check) и это не повторный запрос — пробуем обновить токен один раз
    if (status === 401 && originalRequest && !originalRequest._retry && !isAppCheckError(error)) {
      originalRequest._retry = true;
      const isIgnored = isIgnoredUrl(originalRequest.url);

      try {
        const newAccessToken = await refreshTokens();
        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        console.log('[API] Failed to refresh token:', refreshError.message);
        if (isSessionInvalid(refreshError)) {
          await handleSessionExpired(!isIgnored);
        }
        // Возвращаем исходную 401-ошибку, чтобы вызывающий код корректно её обработал
        return Promise.reject(error);
      }
    }

    console.log('[API Error Detail]:', {
      message: error.message,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        baseURL: error.config?.baseURL,
      },
      status,
      data: error.response?.data
    });
    return Promise.reject(error);
  }
);

export default api;

