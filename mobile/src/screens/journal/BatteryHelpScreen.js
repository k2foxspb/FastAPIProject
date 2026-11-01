import React, { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { PrimaryButton, Section, useColors } from '../../components/journal/common';
import {
  getReminderPermissions, openBatterySettings, openExactAlarmSettings, openPowerManagerSettings,
} from '../../journal/notifications/permissions';

// Шаги для оболочек с агрессивной экономией батареи (названия пунктов зависят от версии)
const VENDOR_STEPS = [
  {
    match: /xiaomi|redmi|poco/i,
    name: 'Xiaomi / Redmi / POCO (MIUI, HyperOS)',
    steps: [
      'Настройки → Приложения → это приложение → «Автозапуск»: включить.',
      '«Контроль активности» (Экономия заряда): выбрать «Нет ограничений».',
      'В списке недавних приложений потянуть карточку вниз и закрепить замком.',
    ],
  },
  {
    match: /huawei|honor/i,
    name: 'Huawei / Honor (EMUI, MagicOS)',
    steps: [
      'Настройки → Батарея → Запуск приложений → это приложение: отключить «Автоуправление».',
      'Включить «Автозапуск», «Косвенный запуск» и «Работа в фоне».',
    ],
  },
  {
    match: /samsung/i,
    name: 'Samsung (One UI)',
    steps: [
      'Настройки → Приложения → это приложение → Батарея: «Без ограничений».',
      'Настройки → Батарея → Ограничения фонового использования: убрать приложение из «Спящих» и «Глубоко спящих».',
    ],
  },
  {
    match: /oppo|realme|oneplus/i,
    name: 'OPPO / realme / OnePlus (ColorOS, OxygenOS)',
    steps: [
      'Настройки → Приложения → это приложение → Использование батареи: разрешить работу в фоне и автозапуск.',
      'Отключить «Оптимизацию батареи» для приложения.',
    ],
  },
  {
    match: /vivo|iqoo/i,
    name: 'vivo / iQOO',
    steps: [
      'Настройки → Батарея → Высокое энергопотребление в фоне: разрешить приложению.',
      'i Manager → Управление приложениями → Автозапуск: включить.',
    ],
  },
];

const BatteryHelpScreen = () => {
  const colors = useColors();
  const [perm, setPerm] = useState(null);

  useFocusEffect(useCallback(() => {
    getReminderPermissions().then(setPerm).catch(() => undefined);
  }, []));

  if (Platform.OS !== 'android') {
    return (
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 20 }}>
        <Text style={{ color: colors.text, fontSize: 15 }}>
          На iOS напоминания планируются системой и не зависят от экономии батареи. Убедитесь, что уведомления
          приложения разрешены, а режим «Фокусирование» не скрывает их.
        </Text>
      </ScrollView>
    );
  }

  const manufacturer = perm?.powerManager?.manufacturer || '';
  const vendor = VENDOR_STEPS.find((v) => v.match.test(manufacturer));
  const others = VENDOR_STEPS.filter((v) => v !== vendor);

  const Steps = ({ item }) => (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      {item.steps.map((s, i) => (
        <Text key={s} style={[styles.step, { color: colors.text }]}>{`${i + 1}. ${s}`}</Text>
      ))}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        Многие производители «усыпляют» приложения, чтобы экономить заряд. Из-за этого напоминания могут приходить
        с опозданием или не приходить после перезагрузки. Выполните шаги ниже один раз.
      </Text>

      <Section title="Состояние">
        <View style={styles.row}>
          <Icon name={perm?.batteryOptimization ? 'alert-circle' : 'checkmark-circle'} size={20} color={perm?.batteryOptimization ? '#F59E0B' : '#2E7D32'} />
          <Text style={[styles.rowText, { color: colors.text }]}>
            {perm?.batteryOptimization === true ? 'Оптимизация батареи включена для приложения'
              : perm?.batteryOptimization === false ? 'Приложение исключено из оптимизации батареи' : 'Проверка…'}
          </Text>
        </View>
        <View style={styles.row}>
          <Icon name={perm?.exactAlarm === 'disabled' ? 'alert-circle' : 'checkmark-circle'} size={20} color={perm?.exactAlarm === 'disabled' ? '#F59E0B' : '#2E7D32'} />
          <Text style={[styles.rowText, { color: colors.text }]}>
            {perm?.exactAlarm === 'disabled' ? 'Точные будильники запрещены' : 'Точные будильники доступны'}
          </Text>
        </View>
        {!!manufacturer && (
          <Text style={[styles.note, { color: colors.textSecondary }]}>Устройство: {manufacturer} {perm?.powerManager?.model || ''}</Text>
        )}
      </Section>

      <PrimaryButton title="Отключить оптимизацию батареи" onPress={openBatterySettings} style={styles.button} />
      {!!perm?.powerManager?.activity && (
        <PrimaryButton title="Открыть настройки автозапуска" onPress={openPowerManagerSettings} style={styles.button} />
      )}
      {perm?.exactAlarm === 'disabled' && (
        <PrimaryButton title="Разрешить точные будильники" onPress={openExactAlarmSettings} style={styles.button} />
      )}

      {vendor && (
        <Section title={`Для вашего устройства: ${vendor.name}`}>
          <Steps item={vendor} />
        </Section>
      )}
      {others.map((v) => (
        <Section key={v.name} title={v.name}>
          <Steps item={v} />
        </Section>
      ))}

      <Text style={[styles.intro, { color: colors.textSecondary }]}>
        После настройки проверьте результат: «Проверка напоминаний» → «Тестовое уведомление через минуту», затем
        заблокируйте экран.
      </Text>
    </ScrollView>
  );
};

export default BatteryHelpScreen;

const styles = StyleSheet.create({
  intro: { fontSize: 14, marginHorizontal: 16, marginTop: 16, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  rowText: { flex: 1, fontSize: 15, marginLeft: 10 },
  note: { fontSize: 13, paddingHorizontal: 12, paddingBottom: 8 },
  step: { fontSize: 14, lineHeight: 20, paddingVertical: 3 },
  button: { marginHorizontal: 16, marginTop: 10 },
});
