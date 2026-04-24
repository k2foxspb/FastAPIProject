import { storage } from './storage';

/**
 * Проверяет, включен ли режим "Тишины" и попадает ли текущее время в заданный интервал.
 */
export const isWithinQuietHours = async () => {
  try {
    const enabled = await storage.getItem('quiet_hours_enabled');
    if (enabled !== 'true') return false;

    const start = await storage.getItem('quiet_hours_start') || '22:00';
    const end = await storage.getItem('quiet_hours_end') || '08:00';

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    if (startTime < endTime) {
      // Интервал внутри одного дня (например, 14:00 - 16:00)
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Интервал через полночь (например, 22:00 - 08:00)
      return currentTime >= startTime || currentTime <= endTime;
    }
  } catch (e) {
    console.error('[QuietHours] Error checking:', e);
    return false;
  }
};

/**
 * Возвращает текущие настройки тихих часов.
 */
export const getQuietHoursSettings = async () => {
  return {
    enabled: (await storage.getItem('quiet_hours_enabled')) === 'true',
    start: (await storage.getItem('quiet_hours_start')) || '22:00',
    end: (await storage.getItem('quiet_hours_end')) || '08:00',
  };
};
