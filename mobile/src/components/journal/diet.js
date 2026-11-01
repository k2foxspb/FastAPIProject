import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Chip, Input, PrimaryButton, useColors } from './common';
import { addWater, removeLastWater, WATER_PORTIONS } from '../../journal/db/repos/diet';
import { formatAmount, parseAmount, per100Of, portion } from '../../journal/utils/nutrition';

export const MACROS = [
  { key: 'protein', goalKey: 'protein_g_goal', label: 'Белки', short: 'Б', color: '#43A047' },
  { key: 'fat', goalKey: 'fat_g_goal', label: 'Жиры', short: 'Ж', color: '#FB8C00' },
  { key: 'carbs', goalKey: 'carbs_g_goal', label: 'Углеводы', short: 'У', color: '#1E88E5' },
];
export const KCAL_COLOR = '#E53935';
export const WATER_COLOR = '#039BE5';

// Полоса прогресса «съедено / цель». Превышение цели подсвечивается.
export const ProgressRow = ({ label, value, goal, unit, color, digits = 0 }) => {
  const colors = useColors();
  const ratio = goal ? Math.min(1, value / goal) : 0;
  const over = goal && value > goal;
  return (
    <View style={styles.progress}>
      <View style={styles.progressHead}>
        <Text style={[styles.progressLabel, { color: colors.text }]}>{label}</Text>
        <Text style={{ color: over ? colors.error : colors.textSecondary, fontSize: 13 }}>
          {formatAmount(value, digits)}{goal ? ` / ${goal}` : ''} {unit}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.bar, { width: `${goal ? ratio * 100 : 0}%`, backgroundColor: over ? colors.error : color }]} />
      </View>
    </View>
  );
};

// Итоги КБЖУ против целей
export const NutritionSummary = ({ totals, settings }) => (
  <View>
    <ProgressRow label="Калории" value={totals.kcal} goal={settings?.kcal_goal} unit="ккал" color={KCAL_COLOR} />
    {MACROS.map((m) => (
      <ProgressRow key={m.key} label={m.label} value={totals[m.key]} goal={settings?.[m.goalKey]} unit="г" color={m.color} digits={1} />
    ))}
  </View>
);

// Строка «Б 12 · Ж 5 · У 30»
export const macrosLine = (item) => MACROS.map((m) => `${m.short} ${formatAmount(item[m.key])}`).join(' · ');

// Быстрый счётчик воды: один тап - одна порция (append-only), «−» отменяет последнюю.
export const WaterCard = ({ date, waterMl, goal }) => {
  const colors = useColors();
  const [portionMl, setPortionMl] = useState(250);
  const add = async (ml) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    await addWater(date, ml);
  };
  const ratio = goal ? Math.min(1, waterMl / goal) : 0;
  return (
    <View style={styles.water}>
      <View style={styles.waterHead}>
        <Icon name="water" size={22} color={WATER_COLOR} />
        <Text style={[styles.waterValue, { color: colors.text }]}>
          {(waterMl / 1000).toFixed(2).replace('.', ',')} л
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>{goal ? ` из ${(goal / 1000).toFixed(1).replace('.', ',')} л` : ''}</Text>
        </Text>
        <TouchableOpacity
          onPress={() => removeLastWater(date)}
          disabled={!waterMl}
          hitSlop={8}
          style={[styles.waterBtn, { borderColor: colors.border, opacity: waterMl ? 1 : 0.4 }]}
        >
          <Icon name="remove" size={20} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => add(portionMl)} hitSlop={8} style={[styles.waterBtn, { backgroundColor: WATER_COLOR, borderColor: WATER_COLOR }]}>
          <Icon name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      {!!goal && (
        <View style={[styles.track, { backgroundColor: colors.border, marginTop: 8 }]}>
          <View style={[styles.bar, { width: `${ratio * 100}%`, backgroundColor: WATER_COLOR }]} />
        </View>
      )}
      <View style={styles.wrap}>
        {WATER_PORTIONS.map((ml) => (
          <Chip key={ml} label={`${ml} мл`} selected={portionMl === ml} onPress={() => setPortionMl(ml)} color={WATER_COLOR} />
        ))}
      </View>
    </View>
  );
};

// Ввод четырёх значений КБЖУ (строки, чтобы не терять запятую при вводе)
export const NutrientInputs = ({ values, onChange, suffix = '' }) => {
  const colors = useColors();
  const fields = [
    { key: 'kcal', label: `Ккал${suffix}` },
    { key: 'protein', label: `Белки, г${suffix}` },
    { key: 'fat', label: `Жиры, г${suffix}` },
    { key: 'carbs', label: `Углеводы, г${suffix}` },
  ];
  return (
    <View style={styles.grid}>
      {fields.map((f) => (
        <View key={f.key} style={styles.gridCell}>
          <Text style={[styles.gridLabel, { color: colors.textSecondary }]}>{f.label}</Text>
          <Input
            value={values[f.key]}
            onChangeText={(t) => onChange({ ...values, [f.key]: t.replace(/[^\d.,]/g, '') })}
            keyboardType="decimal-pad"
            placeholder="0"
            maxLength={8}
          />
        </View>
      ))}
    </View>
  );
};

// Выбор порции продукта из базы: граммы (или порции) -> предпросмотр КБЖУ -> «Добавить».
export const PortionModal = ({ visible, food, onClose, onSave, title = 'Добавить' }) => {
  const colors = useColors();
  const [gramsText, setGramsText] = useState('');
  useEffect(() => {
    if (visible && food) setGramsText(String(food.serving_g || 100).replace('.', ','));
  }, [visible, food]);
  if (!food) return null;
  const grams = parseAmount(gramsText);
  const values = grams ? portion(per100Of(food), grams) : null;
  const presets = [...new Set([food.serving_g, 50, 100, 150, 200, 300].filter(Boolean).map(Number))].slice(0, 6);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={2}>{food.name}</Text>
          <Text style={{ color: colors.textSecondary, marginBottom: 12 }}>
            На 100 г: {formatAmount(food.kcal_100, 0)} ккал · {macrosLine({ protein: food.protein_100, fat: food.fat_100, carbs: food.carbs_100 })}
          </Text>
          <Input value={gramsText} onChangeText={setGramsText} keyboardType="decimal-pad" placeholder="Вес, г" autoFocus maxLength={7} />
          <View style={[styles.wrap, { marginTop: 10 }]}>
            {presets.map((g) => (
              <Chip key={g} label={`${formatAmount(g, 0)} г`} selected={grams === g} onPress={() => setGramsText(String(g))} />
            ))}
          </View>
          {values && (
            <Text style={[styles.preview, { color: colors.text }]}>
              {formatAmount(values.kcal, 0)} ккал · {macrosLine(values)}
            </Text>
          )}
          <PrimaryButton title={title} disabled={!grams} onPress={() => onSave(grams)} style={{ marginHorizontal: 0, marginTop: 12 }} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  progress: { paddingHorizontal: 12, paddingVertical: 5 },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  progressLabel: { fontSize: 14 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  water: { paddingHorizontal: 12, paddingVertical: 4 },
  waterHead: { flexDirection: 'row', alignItems: 'center' },
  waterValue: { flex: 1, fontSize: 18, fontWeight: '600', marginLeft: 8 },
  waterBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridCell: { width: '48%', marginBottom: 10 },
  gridLabel: { fontSize: 13, marginBottom: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  preview: { fontSize: 15, fontWeight: '600', marginTop: 4 },
});
