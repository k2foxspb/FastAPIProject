import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import { Platform } from 'react-native';
import { requestUserPermission } from './notifications';

/**
 * Запрашивает все необходимые разрешения для приложения:
 * 1. Уведомления (через Firebase)
 * 2. Камера (через expo-camera)
 * 3. Микрофон (через expo-camera)
 * 4. Галерея (через expo-image-picker)
 */
export const requestAllAppPermissions = async () => {
  console.log('[Permissions] Starting global permission requests...');
  
  try {
    const results = {};

    // 1. Уведомления
    console.log('[Permissions] Requesting notifications...');
    const authStatus = await requestUserPermission();
    results.notifications = authStatus;
    console.log('[Permissions] Notification status result:', authStatus);

    // Дополнительный явный запрос через Notifee для Android 13+, если Firebase промолчал
    if (Platform.OS === 'android' && Platform.Version >= 33) {
        try {
            const notifee = require('@notifee/react-native').default;
            const settings = await notifee.requestPermission();
            console.log('[Permissions] Notifee explicit status:', settings.authorizationStatus);
        } catch (e) {
            console.log('[Permissions] Notifee explicit request failed:', e.message);
        }
    }

    // 2. Камера
    const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
    results.camera = cameraStatus;
    console.log('[Permissions] Camera status:', cameraStatus);

    // 3. Микрофон
    const { status: microphoneStatus } = await Camera.requestMicrophonePermissionsAsync();
    results.microphone = microphoneStatus;
    console.log('[Permissions] Microphone status:', microphoneStatus);

    // 4. Галерея (нужна для выбора фото)
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    results.library = libraryStatus;
    console.log('[Permissions] Media library status:', libraryStatus);

    return results;
  } catch (error) {
    console.error('[Permissions] Error requesting permissions:', error);
    // Пытаемся использовать ImagePicker как запасной вариант для камеры, если Camera упала
    try {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        return { camera: status };
    } catch (e) {
        return null;
    }
  }
};
