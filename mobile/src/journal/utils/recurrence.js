// Повторения событий журнала - то же подмножество RFC 5545 RRULE, что и на сервере
// (app/services/journal/recurrence.py): FREQ=DAILY|WEEKLY|MONTHLY; INTERVAL; BYDAY
// (только WEEKLY); BYMONTHDAY (только MONTHLY); UNTIL=YYYYMMDD.
// Правило разворачивается в «плавающих» датах (Date в UTC), перевод конкретного
// срабатывания в абсолютное время - через tz.js (localToUtc).
import { RRule } from 'rrule';
import { compareKeys, parseDateKey, toDateKey } from './dates';

const FREQS = { DAILY: RRule.DAILY, WEEKLY: RRule.WEEKLY, MONTHLY: RRule.MONTHLY };
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const RRULE_WEEKDAYS = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];
const MAX_INSTANCES = 2000;

// Разбор правила в объект { freq, interval, byday: [0..6], bymonthday: [], until: 'YYYY-MM-DD'|null }.
export const parseRule = (value) => {
  if (!value || typeof value !== 'string') throw new Error('Пустое правило повторения');
  let text = value.trim();
  if (text.toUpperCase().startsWith('RRULE:')) text = text.slice(6);
  const parts = {};
  text.split(';').filter((c) => c.trim()).forEach((chunk) => {
    const [key, val = ''] = chunk.split('=');
    parts[key.trim().toUpperCase()] = val.trim().toUpperCase();
  });
  if (!FREQS[parts.FREQ]) throw new Error('FREQ должен быть DAILY, WEEKLY или MONTHLY');
  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
  if (!(interval >= 1 && interval <= 366)) throw new Error('INTERVAL должен быть от 1 до 366');
  const byday = parts.BYDAY
    ? [...new Set(parts.BYDAY.split(',').map((d) => WEEKDAY_CODES.indexOf(d.trim())))].sort((a, b) => a - b)
    : [];
  if (byday.some((d) => d < 0)) throw new Error('BYDAY: допустимы MO..SU');
  const bymonthday = parts.BYMONTHDAY
    ? [...new Set(parts.BYMONTHDAY.split(',').map((x) => parseInt(x, 10)))].sort((a, b) => a - b)
    : [];
  if (bymonthday.some((x) => !(Math.abs(x) >= 1 && Math.abs(x) <= 31))) throw new Error('BYMONTHDAY: 1..31');
  let until = null;
  if (parts.UNTIL) {
    const raw = parts.UNTIL.slice(0, 8);
    if (!/^\d{8}$/.test(raw)) throw new Error('UNTIL должен быть в формате YYYYMMDD');
    until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return { freq: parts.FREQ, interval, byday, bymonthday, until };
};

// Каноническая строка правила (совпадает с format_rrule на сервере).
export const formatRule = ({ freq, interval = 1, byday = [], bymonthday = [], until = null }) => {
  const parts = [`FREQ=${freq}`];
  if (interval && interval !== 1) parts.push(`INTERVAL=${interval}`);
  if (freq === 'WEEKLY' && byday.length) parts.push(`BYDAY=${[...byday].sort((a, b) => a - b).map((d) => WEEKDAY_CODES[d]).join(',')}`);
  if (freq === 'MONTHLY' && bymonthday.length) parts.push(`BYMONTHDAY=${[...bymonthday].sort((a, b) => a - b).join(',')}`);
  if (until) parts.push(`UNTIL=${until.replace(/-/g, '')}`);
  return parts.join(';');
};

// Даты срабатываний правила в диапазоне [start, end] включительно ('YYYY-MM-DD').
export const iterDates = (rule, dtstart, start, end, until = null) => {
  const r = typeof rule === 'string' ? parseRule(rule) : rule;
  const limits = [r.until, until].filter(Boolean).sort(compareKeys);
  const effectiveUntil = limits[0] || null;
  const lo = compareKeys(start, dtstart) > 0 ? start : dtstart;
  const hi = effectiveUntil && compareKeys(effectiveUntil, end) < 0 ? effectiveUntil : end;
  if (compareKeys(hi, lo) < 0) return [];

  const options = {
    freq: FREQS[r.freq],
    interval: r.interval,
    dtstart: parseDateKey(dtstart),
    until: parseDateKey(hi),
    wkst: RRule.MO,
  };
  if (r.byday.length) options.byweekday = r.byday.map((d) => RRULE_WEEKDAYS[d]);
  if (r.bymonthday.length) options.bymonthday = r.bymonthday;
  const result = [];
  new RRule(options).between(parseDateKey(lo), parseDateKey(hi), true, (date, i) => {
    result.push(toDateKey(date));
    return i + 1 < MAX_INSTANCES;
  });
  return result;
};

export const isOccurrence = (rule, dtstart, day, until = null) => iterDates(rule, dtstart, day, day, until).length > 0;

// Разворачивает событие в экземпляры диапазона с учётом исключений
// (overrides: { 'YYYY-MM-DD' (исходная дата): occurrence }), как expand_event на сервере.
export const expandEvent = (event, overrides, start, end) => {
  const recurring = !!event.rrule;
  let candidates;
  if (recurring) {
    let rule;
    try {
      rule = parseRule(event.rrule);
    } catch {
      return [];
    }
    candidates = new Set(iterDates(rule, event.start_date, start, end, event.until_date));
    Object.entries(overrides || {}).forEach(([orig, occ]) => {
      if (candidates.has(orig) || !occ.moved_date) return;
      if (compareKeys(occ.moved_date, start) >= 0 && compareKeys(occ.moved_date, end) <= 0
        && isOccurrence(rule, event.start_date, orig, event.until_date)) {
        candidates.add(orig);
      }
    });
  } else {
    candidates = new Set([event.start_date]);
  }

  const instances = [];
  [...candidates].sort(compareKeys).forEach((orig) => {
    const occ = overrides ? overrides[orig] : null;
    const status = occ ? occ.status : (recurring ? 'planned' : event.status);
    if (status === 'cancelled') return;
    const day = occ && occ.moved_date ? occ.moved_date : orig;
    if (compareKeys(day, start) < 0 || compareKeys(day, end) > 0) return;
    instances.push({
      event_uuid: event.uuid,
      original_date: orig,
      date: day,
      time: (occ && occ.moved_time) || event.start_time || null,
      status,
      title: event.title,
      kind: event.kind,
      color: event.color,
      occurrence_uuid: occ ? occ.uuid : null,
      recurring,
    });
  });
  instances.sort((a, b) => compareKeys(a.date, b.date) || compareKeys(a.time || '', b.time || ''));
  return instances;
};

// Человекочитаемое описание правила для UI.
export const describeRule = (value) => {
  if (!value) return 'Не повторяется';
  let r;
  try {
    r = parseRule(value);
  } catch {
    return 'Повторяется';
  }
  const names = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  let text;
  if (r.freq === 'DAILY') text = r.interval === 1 ? 'Каждый день' : `Раз в ${r.interval} дн.`;
  else if (r.freq === 'WEEKLY') {
    const days = r.byday.length ? `: ${r.byday.map((d) => names[d]).join(', ')}` : '';
    text = (r.interval === 1 ? 'Каждую неделю' : `Раз в ${r.interval} нед.`) + days;
  } else {
    const days = r.bymonthday.length ? `, ${r.bymonthday.map((d) => (d === -1 ? 'последний день' : `${d}-го`)).join(', ')}` : '';
    text = (r.interval === 1 ? 'Каждый месяц' : `Раз в ${r.interval} мес.`) + days;
  }
  if (r.until) text += ` до ${r.until.slice(8, 10)}.${r.until.slice(5, 7)}.${r.until.slice(0, 4)}`;
  return text;
};
