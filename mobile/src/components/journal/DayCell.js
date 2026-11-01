import React, { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { formatKopCompact } from '../../journal/utils/money';

// Ячейка дня календаря с краткими итогами. Перерисовывается только при изменении
// своих итогов (memo со сравнением значений), а не всего месяца.
const DayCell = ({ date, state, marking, onPress, colors }) => {
  const s = marking?.summary;
  const isToday = state === 'today';
  const disabled = state === 'disabled';
  const selected = marking?.selected;
  const hasData = !disabled && !!s && (s.events_total > 0 || s.kcal > 0 || s.expense_kop > 0 || s.has_diary || s.tracker_count > 0);
  return (
    <TouchableOpacity
      style={[
        styles.cell,
        hasData && { backgroundColor: `${colors.primary}10` },
        selected && { backgroundColor: `${colors.primary}26` },
      ]}
      onPress={() => onPress?.(date)}
      activeOpacity={0.6}
    >
      <View style={[styles.dayCircle, isToday && { backgroundColor: colors.primary }]}>
        <Text style={[styles.day, { color: isToday ? '#fff' : disabled ? colors.border : colors.text }]}>{date.day}</Text>
      </View>
      {!disabled && s && (
        <View style={styles.info}>
          {s.events_total > 0 && (
            <Text style={[styles.line, { color: s.events_done === s.events_total ? colors.success : colors.textSecondary }]} numberOfLines={1}>
              {s.events_done}/{s.events_total}
            </Text>
          )}
          {s.kcal > 0 && <Text style={[styles.line, { color: colors.textSecondary }]} numberOfLines={1}>{s.kcal} ккал</Text>}
          {s.expense_kop > 0 && (
            <Text style={[styles.line, { color: colors.error }]} numberOfLines={1}>−{formatKopCompact(s.expense_kop)}</Text>
          )}
          <View style={styles.dots}>
            {s.has_diary && <Icon name="book" size={9} color={colors.primary} />}
            {s.tracker_count > 0 && <View style={[styles.dot, { backgroundColor: colors.success }]} />}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};

const sameSummary = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.events_total === b.events_total && a.events_done === b.events_done && a.kcal === b.kcal
    && a.expense_kop === b.expense_kop && a.has_diary === b.has_diary && a.tracker_count === b.tracker_count;
};

export default memo(DayCell, (prev, next) => (
  prev.date?.dateString === next.date?.dateString
  && prev.state === next.state
  && prev.colors === next.colors
  && prev.onPress === next.onPress
  && !!prev.marking?.selected === !!next.marking?.selected
  && sameSummary(prev.marking?.summary, next.marking?.summary)
));

const styles = StyleSheet.create({
  cell: { width: '100%', minHeight: 60, alignItems: 'center', paddingTop: 4, paddingBottom: 3, borderRadius: 10, marginVertical: 1 },
  dayCircle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  day: { fontSize: 14, fontWeight: '600' },
  info: { alignItems: 'center', marginTop: 2 },
  line: { fontSize: 9, lineHeight: 12, fontWeight: '500' },
  dots: { flexDirection: 'row', alignItems: 'center', height: 10, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3, marginLeft: 3 },
});
