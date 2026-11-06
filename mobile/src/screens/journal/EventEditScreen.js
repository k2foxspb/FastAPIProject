import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useJournal } from '../../context/JournalContext';
import { Chip, Field, HeaderButton, Input, JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { DateField, TimeField } from '../../components/journal/DateTimeFields';
import { deleteEvent, getEvent, saveEvent } from '../../journal/db/repos/events';
import { describeRule, formatRule, parseRule } from '../../journal/utils/recurrence';
import { WEEKDAYS_SHORT_RU, weekdayIndex } from '../../journal/utils/dates';
import { getReminderFor, setReminderFor } from '../../journal/db/repos/reminders';
import { ensureReminderPermission } from '../../journal/notifications/permissions';
import { DEFAULT_ALL_DAY_TIME } from '../../journal/notifications/plan';

const KINDS = [
  { key: 'custom', label: 'Событие', icon: 'star-outline' },
  { key: 'note', label: 'Заметка', icon: 'document-text-outline' },
  { key: 'meal', label: 'Еда', icon: 'restaurant-outline' },
  { key: 'payment', label: 'Платёж', icon: 'card-outline' },
];

const REPEATS = [
  { key: 'none', label: 'Нет' },
  { key: 'daily', label: 'Каждый день' },
  { key: 'weekly', label: 'По дням недели' },
  { key: 'interval', label: 'Раз в N дней' },
  { key: 'monthly', label: 'Каждый месяц' },
];

// За сколько минут до события напоминать (null - без напоминания)
const REMINDERS = [
  { key: null, label: 'Нет' },
  { key: 0, label: 'В момент события' },
  { key: 5, label: 'За 5 мин' },
  { key: 15, label: 'За 15 мин' },
  { key: 30, label: 'За 30 мин' },
  { key: 60, label: 'За 1 ч' },
  { key: 1440, label: 'За 1 день' },
];

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899', '#8B5CF6'];

// Правило из полей формы и обратно
const buildRule = ({ repeat, weekdays, interval, monthDay, until }) => {
  if (repeat === 'none') return null;
  if (repeat === 'daily') return formatRule({ freq: 'DAILY', until });
  if (repeat === 'interval') return formatRule({ freq: 'DAILY', interval: Math.max(2, Math.min(366, parseInt(interval, 10) || 2)), until });
  if (repeat === 'weekly') return formatRule({ freq: 'WEEKLY', byday: weekdays, until });
  return formatRule({ freq: 'MONTHLY', bymonthday: [monthDay], until });
};

const repeatFromRule = (rrule) => {
  if (!rrule) return { repeat: 'none' };
  try {
    const r = parseRule(rrule);
    if (r.freq === 'DAILY') return r.interval > 1 ? { repeat: 'interval', interval: String(r.interval), until: r.until } : { repeat: 'daily', until: r.until };
    if (r.freq === 'WEEKLY') return { repeat: 'weekly', weekdays: r.byday, until: r.until };
    return { repeat: 'monthly', monthDay: r.bymonthday[0] || null, until: r.until };
  } catch {
    return { repeat: 'none' };
  }
};

const EventForm = ({ navigation, route }) => {
  const colors = useColors();
  const { today, timezone } = useJournal();
  const uuid = route.params?.uuid || null;
  const [loaded, setLoaded] = useState(!uuid);
  const [existing, setExisting] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('custom');
  const [date, setDate] = useState(route.params?.date || today);
  const [time, setTime] = useState(null);
  const [color, setColor] = useState(null);
  const [repeat, setRepeat] = useState('none');
  const [weekdays, setWeekdays] = useState([]);
  const [interval, setIntervalValue] = useState('2');
  const [monthDay, setMonthDay] = useState(null);
  const [until, setUntil] = useState(null);
  const [reminderOffset, setReminderOffset] = useState(null);
  const [reminderTime, setReminderTime] = useState(DEFAULT_ALL_DAY_TIME);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!uuid) return;
    getEvent(uuid).then((ev) => {
      if (!ev) {
        navigation.goBack();
        return;
      }
      setExisting(ev);
      setTitle(ev.title);
      setDescription(ev.description || '');
      setKind(ev.kind === 'tracker' ? 'custom' : ev.kind);
      setDate(ev.start_date);
      setTime(ev.start_time);
      setColor(ev.color);
      const r = repeatFromRule(ev.rrule);
      setRepeat(r.repeat);
      if (r.weekdays) setWeekdays(r.weekdays);
      if (r.interval) setIntervalValue(r.interval);
      if (r.monthDay) setMonthDay(r.monthDay);
      setUntil(r.until || ev.until_date || null);
      return getReminderFor(uuid).then((rem) => {
        if (rem) {
          setReminderOffset(rem.enabled ? rem.offset_min || 0 : null);
          if (rem.time_of_day) setReminderTime(rem.time_of_day);
        }
        setLoaded(true);
      });
    });
  }, [uuid, navigation]);

  const effectiveWeekdays = weekdays.length ? weekdays : [weekdayIndex(date)];
  const effectiveMonthDay = monthDay || Number(date.slice(8, 10));
  const rule = buildRule({ repeat, weekdays: effectiveWeekdays, interval, monthDay: effectiveMonthDay, until });

  const save = async () => {
    if (!title.trim()) {
      Alert.alert('Введите название');
      return;
    }
    if (until && until < date) {
      Alert.alert('Дата окончания раньше даты начала');
      return;
    }
    setSaving(true);
    try {
      const eventUuid = await saveEvent({
        kind: existing?.kind === 'tracker' ? 'tracker' : kind,
        title: title.trim().slice(0, 200),
        description: description.trim() || null,
        start_date: date,
        start_time: time,
        timezone,
        duration_min: existing?.duration_min ?? null,
        rrule: rule,
        until_date: rule ? until : null,
        status: existing?.status || 'planned',
        ref_type: existing?.ref_type === 'tracker' ? 'tracker' : null,
        ref_uuid: existing?.ref_type === 'tracker' ? existing.ref_uuid : null,
        payload: existing?.payload || null,
        color,
      }, uuid);
      await setReminderFor('event', eventUuid, reminderOffset === null ? null : {
        offset_min: reminderOffset,
        // Для события «весь день» напоминание приходит в заданное время
        time_of_day: time ? null : (reminderTime || DEFAULT_ALL_DAY_TIME),
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Alert.alert(
      'Удалить событие?',
      existing?.rrule ? 'Будут удалены все повторения и отметки о выполнении' : null,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            await deleteEvent(uuid);
            navigation.goBack();
          },
        },
      ],
    );
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: uuid ? 'Событие' : 'Новое событие',
      headerRight: () => (uuid ? <HeaderButton icon="trash-outline" color={colors.error} onPress={remove} /> : null),
    });
  });

  if (!loaded) return null;

  const toggleWeekday = (d) => {
    const base = weekdays.length ? weekdays : effectiveWeekdays;
    const next = base.includes(d) ? base.filter((x) => x !== d) : [...base, d];
    setWeekdays(next.length ? next.sort((a, b) => a - b) : base);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Field label="Название">
          <Input value={title} onChangeText={setTitle} placeholder="Например, обед или оплата интернета" maxLength={200} autoFocus={!uuid} />
        </Field>
        {existing?.kind !== 'tracker' && (
          <Field label="Тип">
            <View style={styles.wrap}>
              {KINDS.map((k) => <Chip key={k.key} label={k.label} icon={k.icon} selected={kind === k.key} onPress={() => setKind(k.key)} />)}
            </View>
          </Field>
        )}
        <Field label="Дата">
          <DateField value={date} onChange={(d) => d && setDate(d)} />
        </Field>
        <Field label="Время (ЧЧ:ММ)">
          <TimeField value={time} onChange={setTime} placeholder="Весь день" />
        </Field>
        <Field label="Повторять">
          <View style={styles.wrap}>
            {REPEATS.map((r) => <Chip key={r.key} label={r.label} selected={repeat === r.key} onPress={() => setRepeat(r.key)} />)}
          </View>
        </Field>
        {repeat === 'weekly' && (
          <Field label="Дни недели">
            <View style={styles.wrap}>
              {WEEKDAYS_SHORT_RU.map((name, i) => (
                <Chip key={name} label={name} selected={effectiveWeekdays.includes(i)} onPress={() => toggleWeekday(i)} />
              ))}
            </View>
          </Field>
        )}
        {repeat === 'interval' && (
          <Field label="Интервал, дней">
            <Input value={interval} onChangeText={(t) => setIntervalValue(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
          </Field>
        )}
        {repeat === 'monthly' && (
          <Field label="День месяца">
            <View style={styles.wrap}>
              <Chip label={`${Number(date.slice(8, 10))}-го`} selected={effectiveMonthDay !== -1} onPress={() => setMonthDay(Number(date.slice(8, 10)))} />
              <Chip label="Последний день" selected={effectiveMonthDay === -1} onPress={() => setMonthDay(-1)} />
            </View>
          </Field>
        )}
        {repeat !== 'none' && (
          <Field label="Повторять до">
            <DateField value={until} onChange={setUntil} allowClear placeholder="Без даты окончания" />
            <Text style={[styles.hint, { color: colors.textSecondary }]}>{describeRule(rule)}</Text>
          </Field>
        )}
        <Field label="Напоминание">
          <View style={styles.wrap}>
            {REMINDERS.map((r) => (
              <Chip
                key={String(r.key)}
                label={r.label}
                icon={r.key === null ? 'notifications-off-outline' : undefined}
                selected={reminderOffset === r.key}
                onPress={() => {
                  if (reminderOffset === null && r.key !== null) ensureReminderPermission();
                  setReminderOffset(r.key);
                }}
              />
            ))}
          </View>
        </Field>
        {reminderOffset !== null && !time && (
          <Field label="Событие на весь день - напомнить в (ЧЧ:ММ)">
            <TimeField value={reminderTime} onChange={(v) => setReminderTime(v || DEFAULT_ALL_DAY_TIME)} placeholder={DEFAULT_ALL_DAY_TIME} />
          </Field>
        )}
        <Field label="Цвет">
          <View style={styles.wrap}>
            {COLORS.map((c) => (
              <Chip key={c} label="  " color={c} selected={color === c} onPress={() => setColor(color === c ? null : c)} icon="ellipse" />
            ))}
          </View>
        </Field>
        <Field label="Описание">
          <Input value={description} onChangeText={setDescription} placeholder="Необязательно" multiline maxLength={5000} style={{ minHeight: 80, textAlignVertical: 'top' }} />
        </Field>
        <PrimaryButton title="Сохранить" onPress={save} loading={saving} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default function EventEditScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <EventForm navigation={navigation} route={route} />
    </JournalGate>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  hint: { fontSize: 13, marginTop: 6 },
});
