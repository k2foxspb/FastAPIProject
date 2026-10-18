import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { timesheetApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatTimesheetDate, formatName, parseISODate } from '../utils/formatters';

const STATUS_LABELS = {
  draft: 'Черновик',
  pending: 'На согласовании',
  approved: 'Подтверждено',
  rejected: 'Отклонено',
  notified: 'Уведомлён',
};

const ROUND_ACTION_LABELS = {
  submitted: 'Отправлено на согласование',
  resubmitted: 'Повторно отправлено на согласование',
  updated_by_supervisor: 'Изменено руководителем (без согласования)',
};

// Дата/время события истории согласования - например "18.10.2026 14:32".
const formatDateTime = (value) => {
  const d = parseISODate(value);
  if (!d) return '';
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Частые текстовые отметки, которые можно поставить вместо часов за день
// (например больничный лист, отпуск и т.п.) - свободный ввод текста тоже доступен.
const TEXT_VALUE_PRESETS = ['Больничный лист', 'Отпуск', 'Отгул', 'Выходной'];

// Экран одного дня в календаре табеля: позволяет выставить часы за день и,
// если это собственный табель сотрудника, добавить/отредактировать позиции
// сданной продукции (см. POST /timesheet/production и PUT /timesheet/{user_id}).
export default function ProductionEntryFormScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { date, entryId, userId, isOwnTimesheet = true, canEditHours = true } = route.params;

  const [products, setProducts] = useState([]);
  const [items, setItems] = useState([]); // [{ product_id, product_name, unit, quantity, comment }]
  const [status, setStatus] = useState('draft');
  const [reviewerComment, setReviewerComment] = useState(null);
  const [canEdit, setCanEdit] = useState(true);
  const [baseHours, setBaseHours] = useState(String(route.params.baseHours ?? ''));
  const [overtimeHours, setOvertimeHours] = useState(String(route.params.overtimeHours ?? ''));
  const [textValue, setTextValue] = useState(route.params.textValue || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [supervisors, setSupervisors] = useState([]);
  // Режим по каждому дополнительному руководителю: 'approve' - обязательное
  // согласование наравне с ближайшим руководителем, 'notify' - просто
  // уведомление без необходимости согласовывать. Ключ отсутствует, если
  // руководитель не выбран вовсе.
  const [supervisorModes, setSupervisorModes] = useState({});
  const [timesheetEntryId, setTimesheetEntryId] = useState(route.params.timesheetEntryId || null);
  const [timesheetStatus, setTimesheetStatus] = useState(null);
  const [timesheetReviewerComment, setTimesheetReviewerComment] = useState(null);
  const [timesheetPendingApprovers, setTimesheetPendingApprovers] = useState([]);
  const [timesheetHistory, setTimesheetHistory] = useState([]);

  const loadTimesheetDetail = useCallback(async (id) => {
    if (!id) return;
    try {
      const detailRes = await timesheetApi.getTimesheetEntryDetail(id);
      const detail = detailRes.data;
      setTimesheetStatus(detail.status);
      setTimesheetReviewerComment(detail.reviewer_comment);
      setTimesheetPendingApprovers(detail.pending_approvers || []);
      setTimesheetHistory(detail.history || []);
    } catch (e) {
      // история согласования часов не критична для работы экрана - молча игнорируем
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (isOwnTimesheet) {
        const productsRes = await timesheetApi.getProducts();
        setProducts(productsRes.data);
      }

      if (isOwnTimesheet && canEditHours) {
        try {
          const supervisorsRes = await timesheetApi.getTimesheetSupervisors(userId);
          setSupervisors(supervisorsRes.data);
        } catch (e) {
          // список руководителей не критичен для работы экрана - молча игнорируем
        }
      }

      if (isOwnTimesheet && timesheetEntryId) {
        await loadTimesheetDetail(timesheetEntryId);
      }

      if (entryId) {
        const entryRes = await timesheetApi.getProductionEntry(entryId);
        const entry = entryRes.data;
        setStatus(entry.status);
        setReviewerComment(entry.reviewer_comment);
        setCanEdit(entry.can_edit);
        setBaseHours(String(entry.base_hours ?? ''));
        setOvertimeHours(String(entry.overtime_hours ?? ''));
        setTextValue(entry.text_value || '');
        setItems(entry.items.map(i => ({
          product_id: i.product_id,
          product_name: i.product?.name || '',
          unit: i.product?.unit || '',
          quantity: String(i.quantity),
          comment: i.comment || '',
        })));
      } else {
        setItems([]);
        setStatus('draft');
        setCanEdit(true);
      }
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [entryId, isOwnTimesheet, canEditHours, userId, timesheetEntryId, loadTimesheetDetail]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const chooseProduct = (index) => {
    if (products.length === 0) {
      Alert.alert('Нет продукции', 'Справочник продукции пуст - обратитесь к администратору');
      return;
    }
    Alert.alert(
      'Выберите продукцию',
      undefined,
      [
        ...products.map(p => ({
          text: `${p.name} (${p.unit})`,
          onPress: () => setItems(prev => prev.map((it, i) => i === index
            ? { ...it, product_id: p.id, product_name: p.name, unit: p.unit }
            : it)),
        })),
        { text: 'Отмена', style: 'cancel' },
      ]
    );
  };

  const addItem = () => {
    setItems(prev => [...prev, { product_id: null, product_name: '', unit: '', quantity: '', comment: '' }]);
  };

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index, field, value) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it));
  };

  const buildPayload = () => {
    const validItems = items.filter(it => it.product_id != null);
    return {
      date,
      items: validItems.map(it => ({
        product_id: it.product_id,
        quantity: parseFloat((it.quantity || '0').replace(',', '.')) || 0,
        comment: it.comment || null,
      })),
    };
  };

  const validate = () => {
    if (items.length === 0) {
      Alert.alert('Ошибка', 'Добавьте хотя бы одну позицию продукции');
      return false;
    }
    for (const it of items) {
      if (it.product_id == null) {
        Alert.alert('Ошибка', 'Выберите продукцию для каждой позиции');
        return false;
      }
      const q = parseFloat((it.quantity || '').replace(',', '.'));
      if (isNaN(q) || q < 0) {
        Alert.alert('Ошибка', 'Количество должно быть числом не меньше 0');
        return false;
      }
    }
    return true;
  };

  const setSupervisorMode = (supervisorId, mode) => {
    setSupervisorModes(prev => {
      const next = { ...prev };
      if (next[supervisorId] === mode) {
        delete next[supervisorId];
      } else {
        next[supervisorId] = mode;
      }
      return next;
    });
  };

  const saveHours = async () => {
    const baseValue = baseHours.replace(',', '.').trim();
    const overtimeValue = overtimeHours.replace(',', '.').trim();
    const parsedBase = baseValue === '' ? 0 : parseFloat(baseValue);
    const parsedOvertime = overtimeValue === '' ? 0 : parseFloat(overtimeValue);
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
      const extraApproverUserIds = Object.keys(supervisorModes)
        .filter(id => supervisorModes[id] === 'approve')
        .map(Number);
      const extraNotifyUserIds = Object.keys(supervisorModes)
        .filter(id => supervisorModes[id] === 'notify')
        .map(Number);
      const res = await timesheetApi.upsertTimesheetDay(userId, {
        date, hours: parsedBase, overtime_hours: parsedOvertime, text_value: textValue || null, comment: '',
        extra_approver_user_ids: extraApproverUserIds,
        extra_notify_user_ids: extraNotifyUserIds,
      });
      setTimesheetEntryId(res.data.id);
      setTimesheetStatus(res.data.status);
      setTimesheetReviewerComment(res.data.reviewer_comment);
      setTimesheetPendingApprovers(res.data.pending_approvers || []);
      await loadTimesheetDetail(res.data.id);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить часы');
    } finally {
      setSavingHours(false);
    }
  };

  const chooseTextPreset = () => {
    Alert.alert(
      'Текстовая отметка',
      'Выберите вариант или введите свой',
      [
        ...TEXT_VALUE_PRESETS.map(preset => ({ text: preset, onPress: () => setTextValue(preset) })),
        { text: 'Очистить', onPress: () => setTextValue(''), style: 'destructive' },
        { text: 'Отмена', style: 'cancel' },
      ]
    );
  };

  const handleSave = async (submit) => {
    if (submit && !validate()) return;
    setSaving(true);
    try {
      if (canEditHours) await saveHours();
      await timesheetApi.upsertProductionEntry(buildPayload(), submit);
      navigation.goBack();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить запись');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const readOnly = !isOwnTimesheet || !canEdit;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.dateLabel, { color: colors.text }]}>{formatTimesheetDate(date)}</Text>

        <View style={styles.hoursRow}>
          <Text style={[styles.hoursLabel, { color: colors.textSecondary }]}>Основное время:</Text>
          <TextInput
            style={[
              styles.hoursInput,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            value={baseHours}
            onChangeText={setBaseHours}
            onBlur={saveHours}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            editable={canEditHours}
          />
          {savingHours && <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />}
        </View>

        <View style={styles.hoursRow}>
          <Text style={[styles.hoursLabel, { color: colors.textSecondary }]}>Сверхурочное:</Text>
          <TextInput
            style={[
              styles.hoursInput,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            value={overtimeHours}
            onChangeText={setOvertimeHours}
            onBlur={saveHours}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            editable={canEditHours}
          />
        </View>

        <View style={styles.hoursRow}>
          <Text style={[styles.hoursLabel, { color: colors.textSecondary }]}>Отметка вместо часов:</Text>
          <TextInput
            style={[
              styles.textValueInput,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
            ]}
            value={textValue}
            onChangeText={setTextValue}
            onBlur={saveHours}
            placeholder="Например, больничный лист"
            placeholderTextColor={colors.textSecondary}
            editable={canEditHours}
          />
          {canEditHours && (
            <TouchableOpacity onPress={chooseTextPreset} style={{ marginLeft: 8 }}>
              <Icon name="list" size={22} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>

        {isOwnTimesheet && canEditHours && timesheetStatus && (
          <Text style={[styles.statusLabel, { color: colors.primary }]}>
            Часы: {STATUS_LABELS[timesheetStatus] || timesheetStatus}
            {timesheetStatus === 'pending' && timesheetPendingApprovers.length > 0
              ? ` (ожидает: ${timesheetPendingApprovers.map(a => formatName(a) || `#${a.id}`).join(', ')})`
              : ''}
          </Text>
        )}
        {isOwnTimesheet && timesheetStatus === 'rejected' && timesheetReviewerComment ? (
          <Text style={[styles.rejectComment, { color: colors.error }]}>Причина отклонения часов: {timesheetReviewerComment}</Text>
        ) : null}

        {isOwnTimesheet && (
          <Text style={[styles.statusLabel, { color: colors.primary }]}>Продукция: {STATUS_LABELS[status] || status}</Text>
        )}
        {isOwnTimesheet && status === 'rejected' && reviewerComment ? (
          <Text style={[styles.rejectComment, { color: colors.error }]}>Причина отклонения: {reviewerComment}</Text>
        ) : null}
        {isOwnTimesheet && readOnly && (
          <Text style={[styles.readOnlyHint, { color: colors.textSecondary }]}>
            Запись подтверждена или отклонена - редактирование доступно только руководителю
          </Text>
        )}
      </View>

      {isOwnTimesheet ? (
        <FlatList
          data={items}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <View style={[styles.itemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.productSelector, { borderColor: colors.border }]}
                onPress={() => !readOnly && chooseProduct(index)}
                disabled={readOnly}
              >
                <Text style={[styles.productSelectorText, { color: item.product_id ? colors.text : colors.textSecondary }]}>
                  {item.product_name || 'Выберите продукцию'}
                </Text>
                {!readOnly && <Icon name="chevron-down" size={18} color={colors.textSecondary} />}
              </TouchableOpacity>

              <View style={styles.row}>
                <TextInput
                  style={[styles.qtyInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                  value={item.quantity}
                  onChangeText={(v) => updateItem(index, 'quantity', v)}
                  keyboardType="decimal-pad"
                  placeholder="Количество"
                  placeholderTextColor={colors.textSecondary}
                  editable={!readOnly}
                />
                {item.unit ? <Text style={[styles.unitLabel, { color: colors.textSecondary }]}>{item.unit}</Text> : null}
                {!readOnly && (
                  <TouchableOpacity onPress={() => removeItem(index)} style={styles.removeBtn}>
                    <Icon name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                )}
              </View>

              <TextInput
                style={[styles.commentInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                value={item.comment}
                onChangeText={(v) => updateItem(index, 'comment', v)}
                placeholder="Комментарий (необязательно)"
                placeholderTextColor={colors.textSecondary}
                editable={!readOnly}
              />
            </View>
          )}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Позиций пока нет</Text>
          }
          ListFooterComponent={
            <>
              {!readOnly && (
                <TouchableOpacity style={[styles.addBtn, { borderColor: colors.primary }]} onPress={addItem}>
                  <Icon name="add" size={20} color={colors.primary} />
                  <Text style={[styles.addBtnText, { color: colors.primary }]}>Добавить продукцию</Text>
                </TouchableOpacity>
              )}
              {!readOnly && supervisors.length > 0 && (
                <View style={[styles.supervisorsBlock, { borderColor: colors.border }]}>
                  <Text style={[styles.supervisorsTitle, { color: colors.text }]}>
                    Дополнительные вышестоящие руководители:
                  </Text>
                  {supervisors.map(supervisor => {
                    const supervisorName = `${supervisor.first_name || ''} ${supervisor.last_name || ''}`.trim() || `#${supervisor.id}`;
                    const mode = supervisorModes[supervisor.id];
                    return (
                      <View key={supervisor.id} style={styles.supervisorRow}>
                        <Text style={[styles.supervisorName, { color: colors.text }]}>{supervisorName}</Text>
                        <View style={styles.supervisorModeOptions}>
                          <TouchableOpacity
                            style={styles.supervisorModeOption}
                            onPress={() => setSupervisorMode(supervisor.id, 'approve')}
                          >
                            <Icon
                              name={mode === 'approve' ? 'checkbox' : 'square-outline'}
                              size={20}
                              color={mode === 'approve' ? colors.primary : colors.textSecondary}
                            />
                            <Text style={[styles.supervisorModeLabel, { color: colors.textSecondary }]}>Согласование</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.supervisorModeOption}
                            onPress={() => setSupervisorMode(supervisor.id, 'notify')}
                          >
                            <Icon
                              name={mode === 'notify' ? 'checkbox' : 'square-outline'}
                              size={20}
                              color={mode === 'notify' ? colors.primary : colors.textSecondary}
                            />
                            <Text style={[styles.supervisorModeLabel, { color: colors.textSecondary }]}>Уведомление</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
              {timesheetHistory.length > 0 && (
                <View style={[styles.historyBlock, { borderColor: colors.border }]}>
                  <Text style={[styles.historyTitle, { color: colors.text }]}>История согласования часов:</Text>
                  {timesheetHistory.map(round => (
                    <View key={round.round} style={[styles.historyRound, { borderColor: colors.border }]}>
                      <Text style={[styles.historyRoundTitle, { color: colors.text }]}>
                        {ROUND_ACTION_LABELS[round.action] || round.action}
                      </Text>
                      <Text style={[styles.historyMeta, { color: colors.textSecondary }]}>
                        {formatName(round.actor) || `#${round.actor_id}`} · {formatDateTime(round.created_at)}
                      </Text>
                      {round.approvals.map(a => (
                        <Text key={a.approver_id} style={[styles.historyApproval, { color: colors.textSecondary }]}>
                          {'  '}{formatName(a.approver) || `#${a.approver_id}`}: {STATUS_LABELS[a.status] || a.status}
                          {a.decided_at ? ` (${formatDateTime(a.decided_at)})` : ''}
                          {a.status === 'rejected' && a.comment ? ` - ${a.comment}` : ''}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </>
          }
        />
      ) : (
        <View style={styles.list}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            У сотрудника нет сданной продукции за этот день
          </Text>
        </View>
      )}

      {isOwnTimesheet && !readOnly && (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
            onPress={() => handleSave(false)}
            disabled={saving}
          >
            <Text style={[styles.footerBtnText, { color: colors.text }]}>Сохранить черновик</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: colors.primary }]}
            onPress={() => handleSave(true)}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <Text style={[styles.footerBtnText, { color: '#fff' }]}>
                {status === 'rejected' ? 'Отправить повторно' : 'Отправить на согласование'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { padding: 15, borderBottomWidth: 1 },
  dateLabel: { fontSize: 18, fontWeight: '700' },
  hoursRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, flexWrap: 'wrap' },
  hoursLabel: { fontSize: 13, marginRight: 8 },
  hoursInput: { width: 70, height: 38, borderWidth: 1, borderRadius: 8, textAlign: 'center' },
  textValueInput: { flex: 1, height: 38, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10 },
  statusLabel: { fontSize: 13, fontWeight: 'bold', marginTop: 8 },
  rejectComment: { fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  readOnlyHint: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  list: { padding: 15, paddingBottom: 30 },
  itemCard: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  productSelector: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8,
  },
  productSelectorText: { fontSize: 14, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  qtyInput: { flex: 1, height: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10 },
  unitLabel: { marginLeft: 8, fontSize: 13 },
  removeBtn: { marginLeft: 10, padding: 4 },
  commentInput: { height: 40, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, fontSize: 13 },
  addBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, padding: 12, marginTop: 5,
  },
  addBtnText: { marginLeft: 8, fontWeight: '600' },
  supervisorsBlock: { borderTopWidth: 1, marginTop: 15, paddingTop: 12 },
  supervisorsTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  supervisorRow: { paddingVertical: 8 },
  supervisorName: { fontSize: 14, marginBottom: 4 },
  supervisorModeOptions: { flexDirection: 'row' },
  supervisorModeOption: { flexDirection: 'row', alignItems: 'center', marginRight: 20 },
  supervisorModeLabel: { fontSize: 13, marginLeft: 6 },
  historyBlock: { borderTopWidth: 1, marginTop: 15, paddingTop: 12 },
  historyTitle: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  historyRound: { borderLeftWidth: 2, paddingLeft: 10, marginBottom: 12 },
  historyRoundTitle: { fontSize: 13, fontWeight: '600' },
  historyMeta: { fontSize: 12, marginTop: 2 },
  historyApproval: { fontSize: 12, marginTop: 4 },
  emptyText: { textAlign: 'center', marginTop: 20, fontStyle: 'italic' },
  footer: { flexDirection: 'row', padding: 15, borderTopWidth: 1 },
  footerBtn: { flex: 1, padding: 14, borderRadius: 10, alignItems: 'center', marginHorizontal: 5, borderWidth: 1, borderColor: 'transparent' },
  footerBtnText: { fontWeight: 'bold', fontSize: 14 },
});
