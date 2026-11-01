// Метрики здоровья, которые можно импортировать из Health Connect (Android) и HealthKit (iOS).
// По умолчанию всё выключено: импорт работает только после явного включения пользователем.
export const HEALTH_METRICS = [
  {
    key: 'weight',
    title: 'Вес',
    hint: 'Масса тела - в трекер «Вес»',
    template: { template_key: 'weight', name: 'Вес', value_type: 'number', unit: 'кг', icon: 'scale-outline', color: '#4F8EF7', frequency: 'daily' },
  },
  {
    key: 'sleep',
    title: 'Сон',
    hint: 'Длительность сна - в трекер «Сон»',
    template: { template_key: 'sleep', name: 'Сон', value_type: 'duration', unit: 'мин', icon: 'bed-outline', color: '#7E57C2', frequency: 'daily' },
  },
  {
    key: 'steps',
    title: 'Шаги',
    hint: 'Сумма шагов за день - в трекер «Шаги»',
    template: { template_key: 'steps', name: 'Шаги', value_type: 'number', unit: 'шагов', icon: 'walk-outline', color: '#43A047', frequency: 'daily' },
  },
  {
    key: 'water',
    title: 'Вода',
    hint: 'Записи о воде - в дневник воды',
    template: null,
  },
];

export const healthMetric = (key) => HEALTH_METRICS.find((m) => m.key === key) || null;
