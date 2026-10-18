import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator,
  Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView, Switch, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { statementsApi } from '../api';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

// CRUD шаблонов заявлений: название, необязательный текст по умолчанию и,
// галочками, обязательные согласующие ("Согласование") и просто
// уведомляемые ("Уведомление") - сотрудник потом выбирает готовый шаблон
// при подаче заявления в табеле вместо ручного выбора руководителей.
export default function AdminStatementTemplatesScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const [templates, setTemplates] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [name, setName] = useState('');
  const [defaultMessage, setDefaultMessage] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [recipientModes, setRecipientModes] = useState({});
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [templatesRes, candidatesRes] = await Promise.all([
        statementsApi.getTemplates(true),
        statementsApi.getTemplateCandidates(),
      ]);
      setTemplates(templatesRes.data);
      setCandidates(candidatesRes.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить шаблоны заявлений');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  const openCreateForm = () => {
    setEditingTemplate(null);
    setName('');
    setDefaultMessage('');
    setIsActive(true);
    setRecipientModes({});
    setFormVisible(true);
  };

  const openEditForm = (template) => {
    setEditingTemplate(template);
    setName(template.name);
    setDefaultMessage(template.default_message || '');
    setIsActive(template.is_active);
    const modes = {};
    (template.recipients || []).forEach(r => { modes[r.user_id] = r.role; });
    setRecipientModes(modes);
    setFormVisible(true);
  };

  const setRecipientMode = (userId, mode) => {
    setRecipientModes(prev => {
      const next = { ...prev };
      if (next[userId] === mode) {
        delete next[userId];
      } else {
        next[userId] = mode;
      }
      return next;
    });
  };

  const saveTemplate = async () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название шаблона');
      return;
    }
    const approverUserIds = Object.keys(recipientModes)
      .filter(id => recipientModes[id] === 'approve')
      .map(Number);
    const notifyUserIds = Object.keys(recipientModes)
      .filter(id => recipientModes[id] === 'notify')
      .map(Number);
    if (approverUserIds.length === 0) {
      Alert.alert('Ошибка', 'Выберите хотя бы одного обязательного согласующего');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        default_message: defaultMessage.trim() || null,
        is_active: isActive,
        approver_user_ids: approverUserIds,
        notify_user_ids: notifyUserIds,
      };
      if (editingTemplate) {
        await statementsApi.updateTemplate(editingTemplate.id, payload);
      } else {
        await statementsApi.createTemplate(payload);
      }
      setFormVisible(false);
      await fetchData();
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить шаблон');
    } finally {
      setSaving(false);
    }
  };

  const deactivateTemplate = (template) => {
    Alert.alert(
      'Деактивация шаблона',
      `Деактивировать "${template.name}"? История уже поданных по нему заявлений сохранится.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Деактивировать',
          style: 'destructive',
          onPress: async () => {
            try {
              await statementsApi.deleteTemplate(template.id);
              await fetchData();
            } catch (err) {
              Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось деактивировать шаблон');
            }
          },
        },
      ]
    );
  };

  const renderTemplate = ({ item }) => {
    const approversCount = (item.recipients || []).filter(r => r.role === 'approve').length;
    const notifyCount = (item.recipients || []).filter(r => r.role === 'notify').length;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: item.is_active ? 1 : 0.5 }]}>
        <View style={[styles.iconWrap, { backgroundColor: colors.background }]}>
          <Icon name="document-text-outline" size={20} color={colors.primary} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name}</Text>
          <Text style={[styles.cardSubtitle, { color: colors.textSecondary }]}>
            Согласующих: {approversCount} · Уведомляемых: {notifyCount}{!item.is_active ? ' · Неактивен' : ''}
          </Text>
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.iconButton} onPress={() => openEditForm(item)}>
            <Icon name="create-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
          {item.is_active && (
            <TouchableOpacity style={styles.iconButton} onPress={() => deactivateTemplate(item)}>
              <Icon name="trash-outline" size={20} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (loading && templates.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={templates}
        keyExtractor={item => item.id.toString()}
        renderItem={renderTemplate}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={fetchData}
        ListEmptyComponent={
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Шаблоны заявлений пока не добавлены</Text>
        }
      />

      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]} onPress={openCreateForm}>
        <Icon name="add" size={28} color="#fff" />
      </TouchableOpacity>

      <Modal visible={formVisible} transparent animationType="slide" onRequestClose={() => setFormVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setFormVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior="padding" style={{ width: '100%', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>
                      {editingTemplate ? 'Редактировать шаблон' : 'Новый шаблон заявления'}
                    </Text>
                    <TouchableOpacity onPress={() => setFormVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ maxHeight: 420 }}>
                    <Text style={[styles.label, { color: colors.text }]}>Название *</Text>
                    <TextInput
                      style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                      value={name}
                      onChangeText={setName}
                      placeholder="Например, Заявление на отпуск"
                      placeholderTextColor={colors.textSecondary}
                      autoFocus
                    />

                    <Text style={[styles.label, { color: colors.text }]}>Текст по умолчанию</Text>
                    <TextInput
                      style={[styles.input, styles.messageInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                      value={defaultMessage}
                      onChangeText={setDefaultMessage}
                      placeholder="Необязательно - сотрудник сможет изменить текст при подаче"
                      placeholderTextColor={colors.textSecondary}
                      multiline
                      textAlignVertical="top"
                    />

                    <View style={styles.switchRow}>
                      <Text style={[styles.label, { color: colors.text, marginTop: 0 }]}>Активен</Text>
                      <Switch
                        value={isActive}
                        onValueChange={setIsActive}
                        trackColor={{ false: colors.border, true: colors.primary + '80' }}
                        thumbColor={isActive ? colors.primary : '#f4f3f4'}
                      />
                    </View>

                    <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Сотрудники</Text>
                    {candidates.length === 0 ? (
                      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Сотрудники не найдены</Text>
                    ) : (
                      candidates.map(candidate => {
                        const candidateName = `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim() || `#${candidate.id}`;
                        const mode = recipientModes[candidate.id];
                        return (
                          <View key={candidate.id} style={[styles.recipientRow, { borderColor: colors.border }]}>
                            <Text style={[styles.recipientName, { color: colors.text }]}>{candidateName}</Text>
                            <View style={styles.recipientModeOptions}>
                              <TouchableOpacity
                                style={styles.recipientModeOption}
                                onPress={() => setRecipientMode(candidate.id, 'approve')}
                              >
                                <Icon
                                  name={mode === 'approve' ? 'checkbox' : 'square-outline'}
                                  size={20}
                                  color={mode === 'approve' ? colors.primary : colors.textSecondary}
                                />
                                <Text style={[styles.recipientModeLabel, { color: colors.textSecondary }]}>Согласование</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={styles.recipientModeOption}
                                onPress={() => setRecipientMode(candidate.id, 'notify')}
                              >
                                <Icon
                                  name={mode === 'notify' ? 'checkbox' : 'square-outline'}
                                  size={20}
                                  color={mode === 'notify' ? colors.primary : colors.textSecondary}
                                />
                                <Text style={[styles.recipientModeLabel, { color: colors.textSecondary }]}>Уведомление</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })
                    )}
                  </ScrollView>

                  <TouchableOpacity
                    style={[styles.saveButton, { backgroundColor: colors.primary }]}
                    onPress={saveTemplate}
                    disabled={saving}
                  >
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
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
  list: { padding: 15, paddingBottom: 90 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 'bold' },
  cardSubtitle: { fontSize: 13, marginTop: 4 },
  cardActions: { flexDirection: 'row', marginLeft: 8 },
  iconButton: { padding: 6, marginLeft: 4 },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { width: '100%', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 15 },
  messageInput: { minHeight: 80 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 },
  recipientRow: { paddingVertical: 10, borderBottomWidth: 1 },
  recipientName: { fontSize: 14, marginBottom: 6 },
  recipientModeOptions: { flexDirection: 'row' },
  recipientModeOption: { flexDirection: 'row', alignItems: 'center', marginRight: 20 },
  recipientModeLabel: { fontSize: 13, marginLeft: 6 },
  saveButton: { marginTop: 15, padding: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
