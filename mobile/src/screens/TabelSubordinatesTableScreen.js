import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, TouchableWithoutFeedback, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName } from '../utils/formatters';
import { getRoleLabel } from '../constants/roles';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const STATUS_COLORS = {
  draft: '#9CA3AF',
  pending: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
const mondayFirstWeekday = (year, month, day) => (new Date(year, month - 1, day).getDay() + 6) % 7;
const isWeekend = (year, month, day) => {
  const w = mondayFirstWeekday(year, month, day);
  return w === 5 || w === 6;
};

const NAME_COL_WIDTH = 150;
const DAY_COL_WIDTH = 44;

// Сводная таблица подчинённых вышестоящего пользователя: по строкам -
// сотрудники, по столбцам - дни месяца с часами из табеля и статусом
// сданной продукции. Короткое нажатие на ячейку с поданной продукцией
// открывает карточку согласования, долгое нажатие (или нажатие на пустую
// ячейку) позволяет отредактировать часы за день.
export default function TabelSubordinatesTableScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);

  const [hoursModalVisible, setHoursModalVisible] = useState(false);
  const [hoursModalTarget, setHoursModalTarget] = useState(null); // { userId, userName, date }
  const [hoursValue, setHoursValue] = useState('');
  const [savingHours, setSavingHours] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await timesheetApi.getSubordinatesSummary(year, month);
      setSummaries(res.data);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось загрузить таблицу подчинённых');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useFocusEffect(useCallback(() => { fetchSummary(); }, [fetchSummary]));

  const changeMonth = (delta) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) { newMonth = 1; newYear += 1; }
    if (newMonth < 1) { newMonth = 12; newYear -= 1; }
    setMonth(newMonth);
    setYear(newYear);
  };

  const openEmployeeCalendar = (user) => {
    navigation.navigate('TabelMain', { employee: user });
  };

  const openHoursModal = (user, day) => {
    setHoursModalTarget({ userId: user.id, userName: formatName(user), date: day.date });
    setHoursValue(day.hours > 0 ? String(day.hours) : '');
    setHoursModalVisible(true);
  };

  const handleCellPress = (user, day) => {
    if (day.entry_id) {
      navigation.navigate('ProductionEntryDetail', { entryId: day.entry_id });
    } else {
      openHoursModal(user, day);
    }
  };

  const handleCellLongPress = (user, day) => {
    openHoursModal(user, day);
  };

  const saveHours = async () => {
    const hoursValueStr = hoursValue.replace(',', '.').trim();
    const parsed = hoursValueStr === '' ? 0 : parseFloat(hoursValueStr);
    if (isNaN(parsed) || parsed < 0 || parsed > 24) {
      Alert.alert('Ошибка', 'Часы должны быть числом от 0 до 24');
      return;
    }
    setSavingHours(true);
    try {
      await timesheetApi.upsertTimesheetDay(hoursModalTarget.userId, {
        date: hoursModalTarget.date,
        hours: parsed,
        comment: '',
      });
      setHoursModalVisible(false);
      fetchSummary();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить часы');
    } finally {
      setSavingHours(false);
    }
  };

  const total = daysInMonth(year, month);
  const dayNumbers = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);

  const weekendBg = theme === 'dark' ? 'rgba(239,68,68,0.12)' : '#FEF2F2';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.monthRow, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => changeMonth(-1)}>
          <Icon name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[styles.monthLabel, { color: colors.text }]}>{MONTH_NAMES[month - 1]} {year}</Text>
        <TouchableOpacity onPress={() => changeMonth(1)}>
          <Icon name="chevron-forward" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : summaries.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ color: colors.textSecondary }}>Нет подчинённых сотрудников</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: NAME_COL_WIDTH }}>
              <View style={[styles.cornerCell, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[styles.headerText, { color: colors.textSecondary }]}>Сотрудник</Text>
              </View>
              {summaries.map(s => (
                <TouchableOpacity
                  key={s.user.id}
                  style={[styles.nameCell, { borderColor: colors.border, backgroundColor: colors.surface }]}
                  onPress={() => openEmployeeCalendar(s.user)}
                >
                  <Text style={[styles.nameText, { color: colors.text }]} numberOfLines={1}>
                    {formatName(s.user)}
                  </Text>
                  <Text style={[styles.roleText, { color: colors.textSecondary }]} numberOfLines={1}>
                    {getRoleLabel(s.user.role)}
                  </Text>
                  <View style={styles.nameFooterRow}>
                    <Text style={[styles.totalHoursText, { color: colors.textSecondary }]}>
                      Σ {s.total_hours} ч
                    </Text>
                    {s.pending_count > 0 && (
                      <View style={[styles.pendingBadge, { backgroundColor: colors.error }]}>
                        <Text style={styles.pendingBadgeText}>{s.pending_count}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                <View style={{ flexDirection: 'row' }}>
                  {dayNumbers.map(d => {
                    const weekend = isWeekend(year, month, d);
                    return (
                      <View
                        key={d}
                        style={[
                          styles.dayHeaderCell,
                          { borderColor: colors.border, backgroundColor: weekend ? weekendBg : colors.surface },
                        ]}
                      >
                        <Text style={[styles.dayHeaderText, { color: weekend ? '#DC2626' : colors.textSecondary }]}>
                          {d}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {summaries.map(s => (
                  <View key={s.user.id} style={{ flexDirection: 'row' }}>
                    {s.days.map(day => {
                      const dayNum = parseInt(day.date.split('-')[2], 10);
                      const weekend = isWeekend(year, month, dayNum);
                      const statusColor = day.status ? (STATUS_COLORS[day.status] || colors.border) : null;
                      return (
                        <TouchableOpacity
                          key={day.date}
                          style={[
                            styles.dayCell,
                            { borderColor: colors.border, backgroundColor: weekend ? weekendBg : colors.background },
                          ]}
                          onPress={() => handleCellPress(s.user, day)}
                          onLongPress={() => handleCellLongPress(s.user, day)}
                        >
                          <Text style={[styles.dayCellText, { color: colors.text }]}>
                            {day.hours > 0 ? day.hours : '—'}
                          </Text>
                          {statusColor && <View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.legend}>
            {Object.entries(STATUS_COLORS).map(([status, color]) => (
              <View key={status} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: color }]} />
                <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                  {{
                    draft: 'Черновик',
                    pending: 'На согласовании',
                    approved: 'Подтверждено',
                    rejected: 'Отклонено',
                  }[status]}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Нажмите на ячейку с продукцией, чтобы открыть согласование. Долгое нажатие на любую ячейку - изменить часы.
          </Text>
        </ScrollView>
      )}

      <Modal visible={hoursModalVisible} transparent animationType="slide" onRequestClose={() => setHoursModalVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setHoursModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    {hoursModalTarget?.userName} · {hoursModalTarget?.date}
                  </Text>
                  <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Часы за день</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={hoursValue}
                    onChangeText={setHoursValue}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[styles.modalSaveBtn, { backgroundColor: colors.primary }]}
                    onPress={saveHours}
                    disabled={savingHours}
                  >
                    {savingHours ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSaveBtnText}>Сохранить</Text>}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  monthLabel: { fontSize: 16, fontWeight: '600', marginHorizontal: 20 },
  cornerCell: { height: 40, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 10 },
  headerText: { fontSize: 12, fontWeight: '600' },
  nameCell: { minHeight: 56, borderWidth: 1, borderTopWidth: 0, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  nameText: { fontSize: 13, fontWeight: '700' },
  roleText: { fontSize: 11, marginTop: 1 },
  nameFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  totalHoursText: { fontSize: 11 },
  pendingBadge: { minWidth: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  pendingBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  dayHeaderCell: { width: DAY_COL_WIDTH, height: 40, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  dayHeaderText: { fontSize: 12, fontWeight: '600' },
  dayCell: { width: DAY_COL_WIDTH, minHeight: 56, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  dayCellText: { fontSize: 13 },
  statusDot: { position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 3.5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 15, justifyContent: 'center', paddingHorizontal: 15 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginBottom: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  legendText: { fontSize: 11 },
  hint: { fontSize: 11, textAlign: 'center', paddingHorizontal: 25, marginTop: 5, fontStyle: 'italic' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  modalLabel: { fontSize: 13, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  modalSaveBtn: { marginTop: 15, padding: 14, borderRadius: 10, alignItems: 'center' },
  modalSaveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
