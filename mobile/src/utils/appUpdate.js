import { Platform, Linking, Alert, ToastAndroid } from 'react-native';
import { cacheDirectory, createDownloadResumable, getContentUriAsync, deleteAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { API_BASE_URL } from '../constants';

// Скачивание и установка новой версии приложения (APK) по нажатию на уведомление
// "Доступна новая версия" (push / колокольчик) или на баннер в профиле.
// Android: APK скачивается в кэш с прогрессом в шторке и открывается системный установщик.
// iOS / ошибка: ссылка открывается в браузере.

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const PROGRESS_CHANNEL_ID = 'app_update';
const PROGRESS_NOTIFICATION_ID = 'app_update_progress';
const FALLBACK_URL = 'https://fokin.fun';

let activeDownload = null;

const resolveUrl = (path) => {
  if (!path || typeof path !== 'string') return null;
  const candidate = path.trim();
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith('//')) return `https:${candidate}`;
  const base = API_BASE_URL.replace(/\/+$/, '');
  return `${base}/${candidate.replace(/^\/+/, '')}`;
};

const toast = (message) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }
};

async function fetchLatestVersion() {
  try {
    const api = require('../api').default;
    const res = await api.get('/news/app-version/latest');
    return res.data || null;
  } catch (e) {
    console.log('[AppUpdate] Failed to fetch latest version:', e?.message || e);
    return null;
  }
}

async function showProgress(version, percent) {
  try {
    await notifee.createChannel({
      id: PROGRESS_CHANNEL_ID,
      name: 'Обновление приложения',
      importance: AndroidImportance.LOW,
      vibration: false,
    });
    await notifee.displayNotification({
      id: PROGRESS_NOTIFICATION_ID,
      title: version ? `Загрузка обновления ${version}` : 'Загрузка обновления',
      body: percent >= 0 ? `${percent}%` : 'Подготовка...',
      data: { type: 'app_update_progress' },
      android: {
        channelId: PROGRESS_CHANNEL_ID,
        smallIcon: 'notification_icon',
        color: '#023c69',
        onlyAlertOnce: true,
        ongoing: true,
        autoCancel: false,
        progress: percent >= 0 ? { max: 100, current: percent } : { indeterminate: true },
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    });
  } catch (e) {
    console.log('[AppUpdate] Progress notification error:', e?.message || e);
  }
}

async function hideProgress() {
  try {
    await notifee.cancelNotification(PROGRESS_NOTIFICATION_ID);
  } catch (_) {}
}

async function openInBrowser(url) {
  try {
    await Linking.openURL(url || FALLBACK_URL);
  } catch (e) {
    console.error("[AppUpdate] Couldn't open url", e);
  }
}

async function downloadAndInstallApk(url, version) {
  const safeVersion = String(version || Date.now()).replace(/[^0-9A-Za-z._-]/g, '_');
  const localUri = `${cacheDirectory}app_update_${safeVersion}.apk`;

  toast('Загрузка обновления началась');
  await showProgress(version, -1);

  let lastPercent = -1;
  const download = createDownloadResumable(url, localUri, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    if (!totalBytesExpectedToWrite) return;
    const percent = Math.floor((totalBytesWritten / totalBytesExpectedToWrite) * 100);
    // Обновляем шторку не чаще, чем на каждые 5%
    if (percent >= lastPercent + 5 || percent === 100) {
      lastPercent = percent;
      showProgress(version, percent);
    }
  });

  try {
    // Удаляем недокачанный файл от прошлой попытки
    await deleteAsync(localUri, { idempotent: true });
    const result = await download.downloadAsync();
    if (!result?.uri || (result.status && result.status >= 400)) {
      throw new Error(`Download failed with status ${result?.status}`);
    }
    await hideProgress();

    const contentUri = await getContentUriAsync(result.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: APK_MIME_TYPE,
    });
  } catch (e) {
    await hideProgress();
    throw e;
  }
}

/**
 * Запускает скачивание и установку новой версии приложения.
 * @param {string|null} fileUrl - ссылка на APK (data.file_path из уведомления); если нет - берётся последняя версия с сервера
 * @param {string|null} version - номер версии (для имени файла и текста в шторке)
 */
export async function startAppUpdate(fileUrl = null, version = null) {
  if (activeDownload) {
    toast('Обновление уже загружается');
    return activeDownload;
  }

  activeDownload = (async () => {
    let url = resolveUrl(fileUrl);
    let ver = version;
    if (!url) {
      const latest = await fetchLatestVersion();
      url = resolveUrl(latest?.file_path);
      ver = ver || latest?.version;
    }

    if (Platform.OS !== 'android' || !url) {
      await openInBrowser(url);
      return;
    }

    try {
      await downloadAndInstallApk(url, ver);
    } catch (e) {
      console.error('[AppUpdate] Download/install failed:', e?.message || e);
      Alert.alert(
        'Не удалось установить обновление',
        'Попробуйте скачать новую версию через браузер.',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Открыть', onPress: () => openInBrowser(url) },
        ]
      );
    }
  })();

  try {
    await activeDownload;
  } finally {
    activeDownload = null;
  }
}
