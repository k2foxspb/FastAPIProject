// Адаптер нативных модулей здоровья. Модули подгружаются лениво: если сборка без них
// (или функция выключена), приложение работает как раньше и импорт просто недоступен.
import { Platform } from 'react-native';

let cachedAdapter;

// Health Connect отдаёт startTime/endTime, HealthKit - Date; приводим к единому виду: time/endTime (ISO).
const normalizeRecord = (record) => ({
  ...record,
  time: record.time ?? record.startTime,
  endTime: record.endTime ?? record.time ?? record.startTime,
});

const loadAndroid = () => {
  const hc = require('react-native-health-connect');
  return {
    init: () => hc.initialize(),
    requestRead: (recordTypes) => hc.requestPermission(recordTypes.map((recordType) => ({ accessType: 'read', recordType }))),
    read: async (recordType, startIso, endIso) => {
      const res = await hc.readRecords(recordType, {
        timeRangeFilter: { operator: 'between', startTime: startIso, endTime: endIso },
      });
      if (recordType === 'HeartRate') {
        // Health Connect отдаёт пульс пачкой замеров внутри одной записи
        return (res.records || []).flatMap((r) => (r.samples || []).map((s) => ({
          time: s.time, endTime: s.time, value: s.beatsPerMinute, uuid: `${r.metadata?.id}:${s.time}`,
        })));
      }
      return (res.records || []).map(normalizeRecord);
    },
  };
};

const loadIos = () => {
  const hk = require('@kingstinct/react-native-healthkit');
  const quantityMap = {
    Weight: { id: hk.QuantityTypeIdentifier.bodyMass, unit: 'kg' },
    Steps: { id: hk.QuantityTypeIdentifier.stepCount, unit: 'count' },
    Hydration: { id: hk.QuantityTypeIdentifier.dietaryWater, unit: 'mL' },
    HeartRate: { id: hk.QuantityTypeIdentifier.heartRate, unit: 'count/min' },
  };
  const toRead = (recordTypes) => recordTypes.flatMap((t) => {
    if (quantityMap[t]) return [quantityMap[t].id];
    if (t === 'SleepSession') return [hk.CategoryTypeIdentifier.sleepAnalysis];
    return [];
  });
  return {
    init: () => hk.isHealthDataAvailableAsync(),
    requestRead: (recordTypes) => hk.requestAuthorization({ toRead: toRead(recordTypes) }),
    read: async (recordType, startIso, endIso) => {
      const filter = { date: { startDate: new Date(startIso), endDate: new Date(endIso) } };
      if (quantityMap[recordType]) {
        const { id, unit } = quantityMap[recordType];
        const samples = await hk.queryQuantitySamples(id, { limit: 0, filter, unit });
        return samples.map((s) => normalizeRecord({
          time: s.startDate.toISOString(), endTime: s.endDate.toISOString(), value: s.quantity, uuid: s.uuid,
        }));
      }
      if (recordType === 'SleepSession') {
        const samples = await hk.queryCategorySamples(hk.CategoryTypeIdentifier.sleepAnalysis, { limit: 0, filter });
        return samples.map((s) => normalizeRecord({
          time: s.startDate.toISOString(), endTime: s.endDate.toISOString(), uuid: s.uuid,
        }));
      }
      return [];
    },
  };
};

// Возвращает адаптер для текущей платформы или null, если нативный модуль недоступен.
export const getHealthSource = () => {
  if (cachedAdapter !== undefined) return cachedAdapter;
  try {
    cachedAdapter = Platform.OS === 'android' ? loadAndroid() : Platform.OS === 'ios' ? loadIos() : null;
  } catch (e) {
    cachedAdapter = null;
  }
  return cachedAdapter;
};
