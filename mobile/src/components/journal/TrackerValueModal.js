import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Chip, Input, PrimaryButton, useColors } from './common';
import { DateField } from './DateTimeFields';
import { saveTrackerValue } from '../../journal/db/repos/trackers';
import { nowTime } from '../../journal/utils/dates';

const parseNumber = (text) => {
  const s = String(text || '').replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

// Быстрый ввод значения трекера (2 тапа: выбрать значение -> сохранить).
export default function TrackerValueModal({ visible, tracker, date, value: existing, onClose }) {
  const colors = useColors();
  const [valueDate, setValueDate] = useState(date);
  const [text, setText] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [num, setNum] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setValueDate(existing?.value_date || date);
    setNote(existing?.note || '');
    const n = existing?.num_value;
    setNum(n ?? null);
    setText(tracker?.value_type === 'text' ? (existing?.text_value || '') : (n !== null && n !== undefined ? String(n).replace('.', ',') : ''));
    if (tracker?.value_type === 'duration' && n !== null && n !== undefined) {
      setHours(String(Math.floor(n / 60)));
      setMinutes(String(Math.round(n % 60)));
    } else {
      setHours('');
      setMinutes('');
    }
  }, [visible, existing, date, tracker]);

  if (!tracker) return null;
  const type = tracker.value_type;

  const save = async () => {
    let numValue = null;
    let textValue = null;
    if (type === 'text') {
      textValue = text.trim();
      if (!textValue) return Alert.alert('Введите текст');
    } else if (type === 'number') {
      numValue = parseNumber(text);
      if (numValue === null) return Alert.alert('Введите число');
    } else if (type === 'duration') {
      const h = parseInt(hours || '0', 10);
      const m = parseInt(minutes || '0', 10);
      if (Number.isNaN(h) || Number.isNaN(m) || (h === 0 && m === 0)) return Alert.alert('Укажите длительность');
      numValue = h * 60 + m;
    } else {
      numValue = num;
      if (numValue === null) return Alert.alert('Выберите значение');
    }
    setSaving(true);
    try {
      await saveTrackerValue({
        tracker_uuid: tracker.uuid,
        value_date: valueDate,
        value_time: existing?.value_time || nowTime(),
        num_value: numValue,
        text_value: textValue,
        note: note.trim() || null,
      }, existing?.uuid || null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onClose(true);
    } catch (e) {
      Alert.alert('Не удалось сохранить', e?.message || '');
    } finally {
      setSaving(false);
    }
  };

  const scaleValues = [];
  if (type === 'scale') {
    const lo = Math.ceil(tracker.scale_min ?? 1);
    const hi = Math.floor(tracker.scale_max ?? 5);
    for (let v = lo; v <= hi && scaleValues.length < 21; v += 1) scaleValues.push(v);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => onClose(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>{tracker.name}</Text>
          <DateField value={valueDate} onChange={(d) => d && setValueDate(d)} />
          <View style={{ height: 12 }} />
          {(type === 'number' || type === 'text') && (
            <Input
              value={text}
              onChangeText={setText}
              autoFocus
              placeholder={type === 'number' ? `Значение${tracker.unit ? `, ${tracker.unit}` : ''}` : 'Текст'}
              keyboardType={type === 'number' ? 'decimal-pad' : 'default'}
              maxLength={type === 'text' ? 500 : 20}
            />
          )}
          {type === 'duration' && (
            <View style={styles.row}>
              <Input style={styles.half} value={hours} onChangeText={setHours} placeholder="часы" keyboardType="number-pad" maxLength={3} />
              <Input style={styles.half} value={minutes} onChangeText={setMinutes} placeholder="минуты" keyboardType="number-pad" maxLength={2} />
            </View>
          )}
          {type === 'bool' && (
            <View style={styles.wrap}>
              <Chip label="Да" selected={num === 1} onPress={() => setNum(1)} color={colors.success} />
              <Chip label="Нет" selected={num === 0} onPress={() => setNum(0)} color={colors.error} />
            </View>
          )}
          {type === 'scale' && (
            <View style={styles.wrap}>
              {scaleValues.map((v) => (
                <Chip key={v} label={String(v)} selected={num === v} onPress={() => setNum(v)} color={tracker.color || undefined} />
              ))}
            </View>
          )}
          <View style={{ height: 12 }} />
          <Input value={note} onChangeText={setNote} placeholder="Заметка (необязательно)" maxLength={500} />
          <PrimaryButton title="Сохранить" onPress={save} loading={saving} style={{ marginHorizontal: 0 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  half: { width: '48%' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
