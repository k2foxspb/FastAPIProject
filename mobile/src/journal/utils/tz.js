// «Настенное» время в IANA-таймзоне -> абсолютный момент (Date).
// Для несуществующего времени (переход на летнее) время сдвигается вперёд
// (02:30 -> 03:30), для неоднозначного (переход на зимнее) берётся первое - как
// local_to_utc на сервере.
import { TZDate } from '@date-fns/tz';
import { normalizeTime } from './dates';

const offsetMinutes = (timeZone, ms) => new TZDate(ms, timeZone).getTimezoneOffset();

export const localToUtc = (dateKey, time, timeZone) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = (normalizeTime(time) || '00:00').split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Смещение «до» локального момента (за сутки) и «после» - выбираем как zoneinfo с fold=0
  const before = offsetMinutes(timeZone, naive - 24 * 3600 * 1000);
  const after = offsetMinutes(timeZone, naive + 24 * 3600 * 1000);
  const candidateBefore = naive + before * 60000;
  const candidateAfter = naive + after * 60000;
  // Кандидат валиден, если его фактическое смещение совпадает с использованным
  if (offsetMinutes(timeZone, candidateBefore) === before) return new Date(candidateBefore);
  if (offsetMinutes(timeZone, candidateAfter) === after) return new Date(candidateAfter);
  // Несуществующее время: используем смещение до перехода (время уезжает вперёд)
  return new Date(candidateBefore);
};
