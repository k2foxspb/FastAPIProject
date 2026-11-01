// Работа с «плавающими» датами журнала: дата хранится строкой 'YYYY-MM-DD',
// время - 'HH:MM' (или 'HH:MM:SS' с сервера). Объекты Date используются только
// в UTC, чтобы не зависеть от часового пояса устройства.

const pad = (n) => String(n).padStart(2, '0');

export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const MONTHS_GEN_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
export const WEEKDAYS_SHORT_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAYS_FULL_RU = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

export const isDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export const parseDateKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export const toDateKey = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const addDays = (key, days) => {
  const d = parseDateKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateKey(d);
};

export const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 0 = понедельник ... 6 = воскресенье (как в Python date.weekday())
export const weekdayIndex = (key) => (parseDateKey(key).getUTCDay() + 6) % 7;

export const monthBounds = (year, month) => {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(last)}`];
};

export const monthKey = (key) => key.slice(0, 7);

// Сегодняшняя дата в заданном часовом поясе (IANA), без внешних зависимостей.
export const todayKey = (timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
};

export const nowTime = () => {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

export const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
};

// 'HH:MM[:SS]' -> 'HH:MM'; некорректное значение -> null
export const normalizeTime = (value) => {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
};

// 'ДД.ММ.ГГГГ' -> 'YYYY-MM-DD'
export const parseRuDate = (value) => {
  const m = String(value || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const key = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return toDateKey(parseDateKey(key)) === key ? key : null;
};

export const formatDateRu = (key, { withWeekday = false, withYear = true } = {}) => {
  if (!isDateKey(key)) return '';
  const d = parseDateKey(key);
  let text = `${d.getUTCDate()} ${MONTHS_GEN_RU[d.getUTCMonth()]}`;
  if (withYear) text += ` ${d.getUTCFullYear()}`;
  if (withWeekday) text = `${WEEKDAYS_FULL_RU[weekdayIndex(key)]}, ${text}`;
  return text;
};

export const formatDateShort = (key) => (isDateKey(key) ? `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}` : '');

export const formatTime = (value) => normalizeTime(value) || '';
