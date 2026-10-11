import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, TouchableWithoutFeedback, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatName } from '../utils/formatters';
import { getPositionLabel } from '../constants/roles';
import { storage } from '../utils/storage';

const pad2 = (n) => String(n).padStart(2, '0');

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
// Фиксированная высота строки сотрудника - одна и та же для ячейки имени и
// для ячейки дня, чтобы колонка имён и сетка часов шли строго друг напротив
// друга (раньше ячейка имени была выше ячейки дня из-за своего контента, и
// строки расходились по вертикали при скролле вниз).
const ROW_HEIGHT = 66;

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
  const [baseHoursValue, setBaseHoursValue] = useState('');
  const [overtimeHoursValue, setOvertimeHoursValue] = useState('');
  const [textValueInput, setTextValueInput] = useState('');
  const [savingHours, setSavingHours] = useState(false);
  const [exporting, setExporting] = useState(false);

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
    setBaseHoursValue(day.base_hours > 0 ? String(day.base_hours) : '');
    setOvertimeHoursValue(day.overtime_hours > 0 ? String(day.overtime_hours) : '');
    setTextValueInput(day.text_value || '');
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
    const baseStr = baseHoursValue.replace(',', '.').trim();
    const overtimeStr = overtimeHoursValue.replace(',', '.').trim();
    const parsedBase = baseStr === '' ? 0 : parseFloat(baseStr);
    const parsedOvertime = overtimeStr === '' ? 0 : parseFloat(overtimeStr);
    if (isNaN(parsedBase) || parsedBase < 0 || parsedBase > 24) {
      Alert.alert('Ошибка', 'Основное время должно быть числом от 0 до 24');
      return;
    }
    if (isNaN(parsedOvertime) || parsedOvertime < 0 || parsedOvertime > 24) {
      Alert.alert('Ошибка', 'Сверхурочное время должно быть числом от 0 до 24');
      return;
    }
    setSavingHours(true);
    try {
      await timesheetApi.upsertTimesheetDay(hoursModalTarget.userId, {
        date: hoursModalTarget.date,
        hours: parsedBase,
        overtime_hours: parsedOvertime,
        text_value: textValueInput || null,
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

  const handleExport = async () => {
    setExporting(true);
    try {
      if (Platform.OS === 'web') {
        Alert.alert('Экспорт', 'Экспорт в Excel доступен в мобильном приложении');
        return;
      }
      const token = await storage.getAccessToken();
      const url = timesheetApi.getSubordinatesExportUrl(year, month);
      const fileName = `timesheet_subordinates_${year}_${pad2(month)}.xlsx`;
      const localUri = `${FileSystem.documentDirectory}${fileName}`;

      const downloadRes = await FileSystem.downloadAsync(url, localUri, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRes.uri, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      } else {
        Alert.alert('Готово', `Файл сохранён: ${downloadRes.uri}`);
      }
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось выгрузить файл Excel');
    } finally {
      setExporting(false);
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
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Icon name="download-outline" size={22} color={colors.primary} />
          )}
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
                    {getPositionLabel(s.user.role)}
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
                      const baseHours = day.base_hours || 0;
                      const overtimeHours = day.overtime_hours || 0;
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
                          {day.text_value ? (
                            <Text style={[styles.dayCellTextValue, { color: colors.primary }]} numberOfLines={2}>
                              {day.text_value}
                            </Text>
                          ) : (
                            <>
                              <Text style={[styles.dayCellBaseText, { color: colors.text }]}>
                                {baseHours > 0 ? baseHours : '—'}
                              </Text>
                              <Text style={[styles.dayCellOvertimeText, { color: overtimeHours > 0 ? '#F59E0B' : colors.textSecondary }]}>
                                {overtimeHours > 0 ? `+${overtimeHours}` : ''}
                              </Text>
                            </>
                          )}
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
            В ячейке дня верхнее число - основное время, нижнее (со знаком "+") - сверхурочное. Нажмите на ячейку с продукцией, чтобы открыть согласование. Долгое нажатие на любую ячейку - изменить часы.
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
                  <Text style={[styles.modalLabel, { color: colors.textSecondary }]}>Основное время</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={baseHoursValue}
                    onChangeText={setBaseHoursValue}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />
                  <Text style={[styles.modalLabel, { color: colors.textSecondary, marginTop: 10 }]}>Сверхурочное время</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={overtimeHoursValue}
                    onChangeText={setOvertimeHoursValue}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <Text style={[styles.modalLabel, { color: colors.textSecondary, marginTop: 10 }]}>Отметка вместо часов (например, больничный)</Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={textValueInput}
                    onChangeText={setTextValueInput}
                    placeholder="Например, Больничный лист"
                    placeholderTextColor={colors.textSecondary}
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
  exportBtn: { marginLeft: 20, padding: 4 },
  cornerCell: { height: 40, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 10 },
  headerText: { fontSize: 12, fontWeight: '600' },
  nameCell: { height: ROW_HEIGHT, overflow: 'hidden', borderWidth: 1, borderTopWidth: 0, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  nameText: { fontSize: 13, fontWeight: '700' },
  roleText: { fontSize: 11, marginTop: 1 },
  nameFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  totalHoursText: { fontSize: 11 },
  pendingBadge: { minWidth: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  pendingBadgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  dayHeaderCell: { width: DAY_COL_WIDTH, height: 40, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  dayHeaderText: { fontSize: 12, fontWeight: '600' },
  // Высота строго совпадает с nameCell (ROW_HEIGHT), чтобы строка часов
  // сотрудника всегда шла напротив строки с его именем.
  dayCell: { width: DAY_COL_WIDTH, height: ROW_HEIGHT, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  dayCellBaseText: { fontSize: 13, fontWeight: '600' },
  dayCellOvertimeText: { fontSize: 11, marginTop: 2 },
  dayCellTextValue: { fontSize: 9, fontWeight: '600', textAlign: 'center' },
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
