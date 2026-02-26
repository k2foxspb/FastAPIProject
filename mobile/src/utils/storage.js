import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_ID_KEY = 'user_id';

export const storage = {
  saveTokens: async (accessToken, refreshToken) => {
    try {
      await AsyncStorage.multiSet([
        [ACCESS_TOKEN_KEY, accessToken],
        [REFRESH_TOKEN_KEY, refreshToken],
      ]);
    } catch (e) {
      console.error('Error saving tokens', e);
    }
  },

  saveUserId: async (userId) => {
    try {
      if (userId) {
        await AsyncStorage.setItem(USER_ID_KEY, String(userId));
      }
    } catch (e) {
      console.error('Error saving userId', e);
    }
  },

  getUserId: async () => {
    try {
      const id = await AsyncStorage.getItem(USER_ID_KEY);
      return id ? parseInt(id, 10) : null;
    } catch (e) {
      console.error('Error getting userId', e);
      return null;
    }
  },

  getAccessToken: async () => {
    try {
      return await AsyncStorage.getItem(ACCESS_TOKEN_KEY);
    } catch (e) {
      console.error('Error getting access token', e);
      return null;
    }
  },

  getRefreshToken: async () => {
    try {
      return await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    } catch (e) {
      console.error('Error getting refresh token', e);
      return null;
    }
  },

  clearTokens: async () => {
    try {
      await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_ID_KEY]);
    } catch (e) {
      console.error('Error clearing tokens', e);
    }
  },

  saveItem: async (key, value) => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      console.error(`Error saving item ${key}`, e);
    }
  },

  getItem: async (key) => {
    try {
      return await AsyncStorage.getItem(key);
    } catch (e) {
      console.error(`Error getting item ${key}`, e);
      return null;
    }
  },

  removeItem: async (key) => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      console.error(`Error removing item ${key}`, e);
    }
  },
};
