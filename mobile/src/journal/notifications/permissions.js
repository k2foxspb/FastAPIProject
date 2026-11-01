// Разрешения для точных напоминаний: уведомления (POST_NOTIFICATIONS на Android 13+),
// точные будильники (Android 12+: SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM) и
// оптимизация батареи у производителей.
import { Alert, Linking, Platform } from 'react-native';
import notifee, { AndroidNotificationSetting, AuthorizationStatus } from '@notifee/react-native';

const authStatus = (status) => {
  if (status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL) return 'granted';
  if (status === AuthorizationStatus.DENIED) return 'denied';
  return 'not_determined';
};

const alarmStatus = (value) => {
  if (value === AndroidNotificationSetting.ENABLED) return 'enabled';
  if (value === AndroidNotificationSetting.DISABLED) return 'disabled';
  return 'not_supported'; // Android < 12 и iOS - точное время доступно всегда
};

// Можно ли ставить точный будильник (иначе - неточный, с возможной задержкой)
export const canScheduleExact = async () => {
  if (Platform.OS !== 'android') return true;
  try {
    const settings = await notifee.getNotificationSettings();
    return settings?.android?.alarm !== AndroidNotificationSetting.DISABLED;
  } catch {
    return false;
  }
};

export const getReminderPermissions = async () => {
  const result = {
    notifications: 'not_determined',
    exactAlarm: 'not_supported',
    batteryOptimization: null, // true - приложение ограничено оптимизацией батареи
    powerManager: null, // { manufacturer, model, activity } - есть ли экран производителя
  };
  try {
    const settings = await notifee.getNotificationSettings();
    result.notifications = authStatus(settings?.authorizationStatus);
    if (Platform.OS === 'android') result.exactAlarm = alarmStatus(settings?.android?.alarm);
  } catch (e) {
    console.log('[JournalReminders] settings error', e?.message);
  }
  if (Platform.OS === 'android') {
    try {
      result.batteryOptimization = await notifee.isBatteryOptimizationEnabled();
    } catch {
      result.batteryOptimization = null;
    }
    try {
      result.powerManager = await notifee.getPowerManagerInfo();
    } catch {
      result.powerManager = null;
    }
  }
  return result;
};

export const requestNotificationPermission = async () => {
  try {
    const settings = await notifee.requestPermission({ alert: true, sound: true, badge: true });
    return authStatus(settings?.authorizationStatus);
  } catch {
    return 'denied';
  }
};

export const openNotificationSettings = async () => {
  try {
    await notifee.openNotificationSettings();
  } catch {
    Linking.openSettings();
  }
};

export const openExactAlarmSettings = async () => {
  try {
    await notifee.openAlarmPermissionSettings();
  } catch {
    Linking.openSettings();
  }
};

export const openBatterySettings = async () => {
  try {
    await notifee.openBatteryOptimizationSettings();
  } catch {
    Linking.openSettings();
  }
};

const ask = (title, message, okText) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: 'Не сейчас', style: 'cancel', onPress: () => resolve(false) },
    { text: okText, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) });
});

// Вызывается при включении напоминания: сначала объяснение, затем системный запрос;
// если точные будильники запрещены - предложение открыть настройки. Напоминание
// сохраняется в любом случае (оно синхронизируется и сработает после выдачи разрешения).
export const ensureReminderPermission = async () => {
  const status = await getReminderPermissions();
  let notifications = status.notifications;
  if (notifications === 'not_determined') {
    const ok = await ask(
      'Разрешите уведомления',
      'Напоминания журнала приходят как уведомления точно в заданное время, даже без интернета.',
      'Разрешить',
    );
    if (ok) notifications = await requestNotificationPermission();
  } else if (notifications === 'denied') {
    const ok = await ask(
      'Уведомления выключены',
      'Без разрешения на уведомления напоминания не появятся. Включите их в настройках.',
      'В настройки',
    );
    if (ok) await openNotificationSettings();
  }
  if (notifications === 'granted' && status.exactAlarm === 'disabled') {
    const ok = await ask(
      'Точное время напоминаний',
      'Система запретила приложению точные будильники - напоминания могут приходить с задержкой. Разрешите «Будильники и напоминания» в настройках.',
      'В настройки',
    );
    if (ok) await openExactAlarmSettings();
  }
  return notifications === 'granted';
};

export const openPowerManagerSettings = async () => {
  try {
    await notifee.openPowerManagerSettings();
  } catch {
    Linking.openSettings();
  }
};
