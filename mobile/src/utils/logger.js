import { Platform } from 'react-native';
import { adminApi } from '../api';

const deviceInfo = `${Platform.OS} ${Platform.Version}`;

const sendToServer = async (level, message) => {
  try {
    await adminApi.addAppLog({ message, level, device_info: deviceInfo });
  } catch (e) {
    // Не выбрасываем ошибку, чтобы не ломать основной поток
  }
};

export const logger = {
  info: (message) => {
    console.log(`[INFO] ${message}`);
    sendToServer('info', message);
  },
  warn: (message) => {
    console.warn(`[WARN] ${message}`);
    sendToServer('warn', message);
  },
  error: (message) => {
    console.error(`[ERROR] ${message}`);
    sendToServer('error', message);
  },
  debug: (message) => {
    console.log(`[DEBUG] ${message}`);
    sendToServer('debug', message);
  },
};
