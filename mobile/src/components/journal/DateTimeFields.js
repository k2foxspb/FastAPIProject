import React, { useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { Ionicons as Icon } from '@expo/vector-icons';
import { Input, useColors } from './common';
import { formatDateRu, normalizeTime } from '../../journal/utils/dates';
import './calendarLocale';

export const calendarTheme = (colors) => ({
  calendarBackground: colors.card,
  dayTextColor: colors.text,
  monthTextColor: colors.text,
  textSectionTitleColor: colors.textSecondary,
  todayTextColor: colors.primary,
  selectedDayBackgroundColor: colors.primary,
  selectedDayTextColor: '#fff',
  arrowColor: colors.primary,
  textDisabledColor: colors.border,
});

// Поле даты: нажатие открывает календарь в модальном окне.
export const DateField = ({ value, onChange, allowClear = false, placeholder = 'Выберите дату' }) => {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const marked = useMemo(() => (value ? { [value]: { selected: true } } : {}), [value]);
  return (
    <>
      <TouchableOpacity
        style={[styles.field, { borderColor: colors.border, backgroundColor: colors.surface }]}
        onPress={() => setOpen(true)}
      >
        <Icon name="calendar-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.fieldText, { color: value ? colors.text : colors.textSecondary }]}>
          {value ? formatDateRu(value, { withWeekday: true }) : placeholder}
        </Text>
        {allowClear && !!value && (
          <TouchableOpacity onPress={() => onChange(null)} hitSlop={8}>
            <Icon name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: colors.card }]}>
            <Calendar
              key={`${colors.card}`}
              current={value || undefined}
              firstDay={1}
              markedDates={marked}
              onDayPress={(d) => {
                onChange(d.dateString);
                setOpen(false);
              }}
              theme={calendarTheme(colors)}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// Поле времени 'ЧЧ:ММ' (пустое значение = без времени).
export const TimeField = ({ value, onChange, placeholder = 'Без времени' }) => {
  const [text, setText] = useState(value || '');
  const [invalid, setInvalid] = useState(false);
  const colors = useColors();
  const handleChange = (raw) => {
    let t = raw.replace(/[^\d:]/g, '');
    if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
    setText(t);
    if (!t) {
      setInvalid(false);
      onChange(null);
      return;
    }
    const normalized = normalizeTime(t);
    setInvalid(!normalized);
    if (normalized) onChange(normalized);
  };
  return (
    <Input
      value={text}
      onChangeText={handleChange}
      placeholder={placeholder}
      keyboardType="numbers-and-punctuation"
      maxLength={5}
      style={invalid ? { borderColor: colors.error } : null}
    />
  );
};

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  fieldText: { flex: 1, fontSize: 16, marginLeft: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 16, overflow: 'hidden', paddingBottom: 8 },
});
