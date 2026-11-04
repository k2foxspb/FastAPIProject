// Импорт веса, сна, шагов и воды из Health Connect / HealthKit. Функция опциональна и
// выключена по умолчанию. Инкрементальность: курсор по каждой метрике хранится в sync_meta,
// дедупликация - по внешнему ID в локальной таблице health_imports (не синхронизируется).
import { getJournalDb } from '../db/database';
import { listTrackers, saveTracker, saveTrackerValue } from '../db/repos/trackers';
import { addWater } from '../db/repos/diet';
import { getMeta, setMeta } from '../sync/outbox';
import { HEALTH_METRICS } from './metrics';
import { getHealthSource } from './healthSource';

const ENABLED_KEY = 'health.enabled';
const METRICS_KEY = 'health.metrics';
const cursorKey = (metric) => `health.cursor.${metric}`;
const DEFAULT_LOOKBACK_DAYS = 30;

const dayOf = (iso) => {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeOf = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const startOfDayIso = (iso) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export const isHealthEnabled = async () => (await getMeta(ENABLED_KEY, '0')) === '1';

export const getEnabledMetrics = async () => {
  const raw = await getMeta(METRICS_KEY, '');
  return raw ? raw.split(',').filter(Boolean) : [];
};

export const setHealthSettings = async ({ enabled, metrics }) => {
  if (enabled !== undefined) await setMeta(ENABLED_KEY, enabled ? '1' : '0');
  if (metrics !== undefined) await setMeta(METRICS_KEY, metrics.join(','));
};

export const isHealthAvailable = () => !!getHealthSource();

// Запрос разрешений на чтение выбранных метрик. Возвращает false, если модуль недоступен.
export const requestHealthPermissions = async (metricKeys) => {
  const source = getHealthSource();
  if (!source) return false;
  const recordTypes = metricKeys.flatMap((k) => {
    if (k === 'weight') return ['Weight'];
    if (k === 'sleep') return ['SleepSession'];
    if (k === 'steps') return ['Steps'];
    if (k === 'water') return ['Hydration'];
    if (k === 'heart_rate') return ['HeartRate'];
    return [];
  });
  await source.init();
  await source.requestRead(recordTypes);
  return true;
};

// Находит трекер по шаблону или создаёт его (как при ручном добавлении из шаблона).
const ensureTracker = async (template) => {
  const existing = (await listTrackers({ includeArchived: true })).find((t) => t.template_key === template.template_key);
  if (existing) return existing.uuid;
  return saveTracker({ ...template, sort_order: 0, archived: 0 });
};

const alreadyImported = async (externalId) => {
  const row = await getJournalDb().getFirstAsync('SELECT 1 AS x FROM health_imports WHERE external_id = ?', [externalId]);
  return !!row;
};

const markImported = async (externalId, metric, localUuid) => {
  await getJournalDb().runAsync(
    'INSERT OR IGNORE INTO health_imports (external_id, metric, local_uuid, imported_at) VALUES (?, ?, ?, ?)',
    [externalId, metric, localUuid || null, new Date().toISOString()],
  );
};

// Сохраняет одну запись метрики. Возвращает true, если запись была новой.
const importRecord = async (metric, record, trackerUuidByMetric) => {
  const externalId = `${metric}:${record.uuid || record.metadata?.id || record.time}`;
  if (await alreadyImported(externalId)) return false;
  if (metric === 'weight') {
    const kg = record.weight?.inKilograms ?? record.value;
    if (!kg) return false;
    const uuid = await saveTrackerValue({
      tracker_uuid: trackerUuidByMetric.weight, value_date: dayOf(record.time), value_time: timeOf(record.time),
      num_value: Math.round(kg * 100) / 100,
    });
    await markImported(externalId, metric, uuid);
  } else if (metric === 'heart_rate') {
    const bpm = Math.round(record.value ?? 0);
    if (!bpm) return false;
    const uuid = await saveTrackerValue({
      tracker_uuid: trackerUuidByMetric.heart_rate, value_date: dayOf(record.time), value_time: timeOf(record.time),
      num_value: bpm,
    });
    await markImported(externalId, metric, uuid);
  } else if (metric === 'water') {
    const ml = Math.round(record.volume?.inMilliliters ?? record.value ?? 0);
    if (!ml) return false;
    const uuid = await addWater(dayOf(record.time), ml, timeOf(record.time));
    await markImported(externalId, metric, uuid);
  } else {
    return false;
  }
  return true;
};

// Шаги - сумма за день: одна запись на день, пересчитывается при каждом импорте (как сон - по дню)
const importStepsByDay = async (records, trackerUuid) => {
  const totals = new Map();
  for (const r of records) {
    const day = dayOf(r.time);
    totals.set(day, (totals.get(day) || 0) + Math.round(r.count ?? r.value ?? 0));
  }
  let written = 0;
  for (const [day, count] of totals) {
    if (!count) continue;
    const externalId = `steps:${day}`;
    const row = await getJournalDb().getFirstAsync('SELECT local_uuid FROM health_imports WHERE external_id = ?', [externalId]);
    const uuid = await saveTrackerValue({
      tracker_uuid: trackerUuid, value_date: day, value_time: null, num_value: count,
    }, row?.local_uuid || null);
    if (!row) await markImported(externalId, 'steps', uuid);
    written += 1;
  }
  return written;
};

// Сон - сумма за день по объединённым интервалам: сессии из нескольких источников не дают дублей, одна запись на день
const importSleepByDay = async (records, trackerUuid) => {
  const intervalsByDay = new Map();
  for (const r of records) {
    const day = dayOf(r.endTime);
    if (!intervalsByDay.has(day)) intervalsByDay.set(day, []);
    intervalsByDay.get(day).push([new Date(r.time).getTime(), new Date(r.endTime).getTime()]);
  }
  let written = 0;
  for (const [day, intervals] of intervalsByDay) {
    const merged = [];
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    const minutes = Math.round(merged.reduce((sum, [start, end]) => sum + (end - start), 0) / 60000);
    if (minutes <= 0) continue;
    const externalId = `sleep:${day}`;
    const row = await getJournalDb().getFirstAsync('SELECT local_uuid FROM health_imports WHERE external_id = ?', [externalId]);
    const uuid = await saveTrackerValue({
      tracker_uuid: trackerUuid, value_date: day, value_time: timeOf(new Date(merged[0][0]).toISOString()), num_value: minutes,
    }, row?.local_uuid || null);
    if (!row) await markImported(externalId, 'sleep', uuid);
    written += 1;
  }
  return written;
};

// Инкрементальный импорт: читает только период после курсора. Возвращает число новых записей.
export const runHealthImport = async () => {
  if (!(await isHealthEnabled())) return 0;
  const source = getHealthSource();
  if (!source) return 0;
  // Клиент Health Connect / HealthKit нужно инициализировать перед чтением; после входа/выхода он не инициализирован
  await source.init();
  const enabled = await getEnabledMetrics();
  const now = new Date();
  const fallbackStart = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86400000).toISOString();
  const trackerUuidByMetric = {};
  let imported = 0;
  for (const metricKey of enabled) {
    const spec = HEALTH_METRICS.find((m) => m.key === metricKey);
    if (!spec) continue;
    if (spec.template && !trackerUuidByMetric[metricKey]) {
      trackerUuidByMetric[metricKey] = await ensureTracker(spec.template);
    }
    const recordType = { weight: 'Weight', sleep: 'SleepSession', steps: 'Steps', water: 'Hydration', heart_rate: 'HeartRate' }[metricKey];
    let start = (await getMeta(cursorKey(metricKey), null)) || fallbackStart;
    // Дневные метрики (шаги, сон) пересчитываются по дням и не зависят от курсора: курсор после первой синхронизации
    // отсекал историю, поэтому читаем скользящее окно за DEFAULT_LOOKBACK_DAYS с начала дня
    if (metricKey === 'steps' || metricKey === 'sleep') {
      start = startOfDayIso(fallbackStart);
    }
    const records = await source.read(recordType, start, now.toISOString());
    if (metricKey === 'steps') {
      imported += await importStepsByDay(records, trackerUuidByMetric.steps);
    } else if (metricKey === 'sleep') {
      imported += await importSleepByDay(records, trackerUuidByMetric.sleep);
    } else {
      for (const record of records) {
        if (await importRecord(metricKey, record, trackerUuidByMetric)) imported += 1;
      }
    }
    await setMeta(cursorKey(metricKey), now.toISOString());
  }
  return imported;
};
