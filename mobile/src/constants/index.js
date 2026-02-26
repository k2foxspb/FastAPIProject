import { Platform } from 'react-native';

// Для работы с Android-эмулятором используйте 10.0.2.2 вместо 127.0.0.1
// Для работы с физическим устройством используйте ваш локальный IP (например, 192.168.1.10)

const DEV_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
const PROD_URL = 'https://fokin.fun';

export const API_BASE_URL = __DEV__ ? DEV_URL : PROD_URL;
