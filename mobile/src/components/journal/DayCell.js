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
  return (
    <TouchableOpacity
      style={[styles.cell, selected && { backgroundColor: `${colors.primary}22` }]}
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
          {s.kcal > 0 && <Text style={[styles.line, { color: colors.textSecondary }]} numberOfLines={1}>{s.kcal}к</Text>}
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
  cell: { width: '100%', minHeight: 58, alignItems: 'center', paddingTop: 2, borderRadius: 8 },
  dayCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  day: { fontSize: 14, fontWeight: '500' },
  info: { alignItems: 'center', marginTop: 1 },
  line: { fontSize: 9, lineHeight: 11 },
  dots: { flexDirection: 'row', alignItems: 'center', height: 10, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3, marginLeft: 3 },
});
