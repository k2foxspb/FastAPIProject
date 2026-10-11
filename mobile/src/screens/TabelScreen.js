import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Alert, Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { storage } from '../utils/storage';
import { formatName } from '../utils/formatters';
import { getRoleScope, loadPositions } from '../constants/roles';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// Понедельник первый - как принято в российском календаре.
const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const STATUS_COLORS = {
  draft: '#9CA3AF',
  pending: '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
};

const pad2 = (n) => String(n).padStart(2, '0');
const toIsoDate = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;
const daysInMonth = (year, month) => new Date(year, month, 0).getDate();
// JS Date.getDay(): 0=вс..6=сб. Переводим в индекс понедельник-первого ряда: 0=пн..6=вс.
const mondayFirstWeekday = (year, month, day) => (new Date(year, month - 1, day).getDay() + 6) % 7;
const isWeekend = (weekdayIndex) => weekdayIndex === 5 || weekdayIndex === 6; // сб, вс

export default function TabelScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser, loadingUser } = useNotifications();
  const { width } = useWindowDimensions();

  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [targetUser, setTargetUser] = useState(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [exporting, setExporting] = useState(false);

  React.useEffect(() => {
    if (currentUser) {
      loadPositions();
      setTargetUser(prev => prev || currentUser);
    }
  }, [currentUser]);

  const isOwnTimesheet = !!(targetUser && currentUser && targetUser.id === currentUser.id);
  const canPickEmployee = currentUser && getRoleScope(currentUser.role) !== 'self';
  const canEditHours = isOwnTimesheet || canPickEmployee;

  const fetchDays = useCallback(async () => {
    if (!targetUser) return;
    const res = await timesheetApi.getProductionMonth(targetUser.id, year, month);
    setDays(res.data);
  }, [targetUser, year, month]);

  const fetchPendingCount = useCallback(async () => {
    if (!canPickEmployee) return;
    try {
      const res = await timesheetApi.getPendingEntries();
      setPendingCount(res.data.length);
    } catch (e) {
      // молча игнорируем - не критично для отображения табеля
    }
  }, [canPickEmployee]);

  const fetchAll = useCallback(async () => {
    if (!targetUser) return;
    setLoading(true);
    try {
      await Promise.all([fetchDays(), fetchPendingCount()]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось загрузить табель');
    } finally {
      setLoading(false);
    }
  }, [fetchDays, fetchPendingCount, targetUser]);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  const changeMonth = (delta) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) { newMonth = 1; newYear += 1; }
    if (newMonth < 1) { newMonth = 12; newYear -= 1; }
    setMonth(newMonth);
    setYear(newYear);
  };

  const openEmployeePicker = () => {
    navigation.navigate('TabelEmployeePicker', {
      onSelect: (employee) => setTargetUser(employee),
    });
  };

  const openDay = (day) => {
    if (!day || !targetUser) return;
    if (!isOwnTimesheet && day.entry) {
      // У подчинённого уже есть запись - открываем карточку согласования.
      navigation.navigate('ProductionEntryDetail', { entryId: day.entry.id });
      return;
    }
    if (!canEditHours) return;
    navigation.navigate('ProductionEntryForm', {
      date: day.date,
      entryId: day.entry?.id,
      hours: day.hours,
      userId: targetUser.id,
      isOwnTimesheet,
      canEditHours,
    });
  };

  const handleExport = async () => {
    if (!targetUser) return;
    setExporting(true);
    try {
      const token = await storage.getAccessToken();
      const url = timesheetApi.getExportUrl(targetUser.id, year, month);
      const fileName = `timesheet_${targetUser.id}_${year}_${pad2(month)}.xlsx`;
      const localUri = `${FileSystem.documentDirectory}${fileName}`;

      if (Platform.OS === 'web') {
        Alert.alert('Экспорт', 'Экспорт в Excel доступен в мобильном приложении');
        return;
      }

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

  // Собираем сетку календаря: пустые ячейки в начале/конце, чтобы недели
  // выравнивались по дням недели (понедельник - первый столбец).
  const weeks = useMemo(() => {
    const total = daysInMonth(year, month);
    const byDate = {};
    days.forEach(d => { byDate[d.date] = d; });

    const cells = [];
    const leadingEmpty = mondayFirstWeekday(year, month, 1);
    for (let i = 0; i < leadingEmpty; i++) cells.push(null);
    for (let day = 1; day <= total; day++) {
      const dateStr = toIsoDate(year, month, day);
      const info = byDate[dateStr];
      cells.push({
        date: dateStr,
        day,
        weekday: mondayFirstWeekday(year, month, day),
        hours: info?.hours ?? 0,
        entry: info?.entry || null,
      });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const result = [];
    for (let i = 0; i < cells.length; i += 7) result.push(cells.slice(i, i + 7));
    return result;
  }, [days, year, month]);

  const todayIso = useMemo(() => {
    const d = new Date();
    return toIsoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }, []);

  const cellSize = Math.floor((width - 30) / 7);

  if (loadingUser || !targetUser) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const weekendBg = theme === 'dark' ? 'rgba(239,68,68,0.12)' : '#FEF2F2';
  const saturdayBg = theme === 'dark' ? 'rgba(245,158,11,0.12)' : '#FFFBEB';

  const renderCell = (cell, colIndex) => {
    if (!cell) {
      return <View key={colIndex} style={[styles.cell, { width: cellSize, height: cellSize }]} />;
    }
    const weekend = isWeekend(cell.weekday);
    const isSaturday = cell.weekday === 5;
    const isToday = cell.date === todayIso;
    const statusColor = cell.entry ? (STATUS_COLORS[cell.entry.status] || colors.border) : null;
    const bg = weekend ? (isSaturday ? saturdayBg : weekendBg) : colors.surface;
    const interactive = isOwnTimesheet ? canEditHours : (!!cell.entry || canEditHours);

    return (
      <TouchableOpacity
        key={colIndex}
        style={[
          styles.cell,
          {
            width: cellSize, height: cellSize, backgroundColor: bg,
            borderColor: isToday ? colors.primary : colors.border,
            borderWidth: isToday ? 2 : 1,
          },
        ]}
        onPress={() => openDay(cell)}
        disabled={!interactive}
      >
        <Text style={[styles.cellDay, { color: weekend ? '#DC2626' : colors.text }]}>{cell.day}</Text>
        <Text style={[styles.cellHours, { color: colors.textSecondary }]}>
          {cell.hours > 0 ? `${cell.hours} ч` : '—'}
        </Text>
        {statusColor && <View style={[styles.statusDot, { backgroundColor: statusColor }]} />}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerName, { color: colors.text }]}>
              {isOwnTimesheet ? 'Мой табель' : formatName(targetUser)}
            </Text>
          </View>
          {canPickEmployee && (
            <TouchableOpacity style={styles.headerIconBtn} onPress={openEmployeePicker}>
              <Icon name="people-outline" size={22} color={colors.primary} />
            </TouchableOpacity>
          )}
          {canPickEmployee && (
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate('ProductionApprovalList')}
            >
              <Icon name="checkmark-done-outline" size={22} color={colors.primary} />
              {pendingCount > 0 && (
                <View style={[styles.badge, { backgroundColor: colors.error }]}>
                  <Text style={styles.badgeText}>{pendingCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.headerIconBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="download-outline" size={22} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.monthRow}>
          <TouchableOpacity onPress={() => changeMonth(-1)}>
            <Icon name="chevron-back" size={24} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.monthLabel, { color: colors.text }]}>{MONTH_NAMES[month - 1]} {year}</Text>
          <TouchableOpacity onPress={() => changeMonth(1)}>
            <Icon name="chevron-forward" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.weekdaysRow}>
          {WEEKDAY_NAMES.map((name, i) => (
            <View key={name} style={[styles.weekdayCell, { width: cellSize }]}>
              <Text style={[styles.weekdayText, { color: isWeekend(i) ? '#DC2626' : colors.textSecondary }]}>
                {name}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.calendar}
          refreshControl={undefined}
        >
          {weeks.map((week, wIdx) => (
            <View key={wIdx} style={styles.weekRow}>
              {week.map((cell, cIdx) => renderCell(cell, cIdx))}
            </View>
          ))}

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
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingTop: 10, borderBottomWidth: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15 },
  headerName: { fontSize: 18, fontWeight: '700' },
  headerIconBtn: { padding: 8, marginLeft: 4 },
  badge: {
    position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  monthLabel: { fontSize: 16, fontWeight: '600', marginHorizontal: 20 },
  weekdaysRow: { flexDirection: 'row', justifyContent: 'center', paddingBottom: 6 },
  weekdayCell: { alignItems: 'center' },
  weekdayText: { fontSize: 12, fontWeight: '600' },
  calendar: { paddingHorizontal: 15, paddingTop: 10, paddingBottom: 30 },
  weekRow: { flexDirection: 'row', justifyContent: 'center' },
  cell: {
    borderWidth: 1, borderRadius: 8, marginBottom: 4,
    justifyContent: 'center', alignItems: 'center', padding: 2,
  },
  cellDay: { fontSize: 13, fontWeight: '700' },
  cellHours: { fontSize: 11, marginTop: 2 },
  statusDot: { position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 3.5 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 15, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginBottom: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  legendText: { fontSize: 11 },
});
