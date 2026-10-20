import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { statementsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

// Экран создания заявления: текст сообщения и либо готовый шаблон (заранее
// настроенный администратором - согласующие и уведомляемые фиксированы),
// либо (если шаблон не выбран) ручной выбор галочками, кто из вышестоящих
// руководителей должен его согласовать ("Согласование" - все выбранные
// обязаны согласовать, отказ любого отклоняет заявление целиком), а кого
// просто поставить в известность ("Уведомление").
export default function StatementFormScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  const editingStatement = route.params?.statement || null;

  const [message, setMessage] = useState(editingStatement?.message || '');
  const [supervisors, setSupervisors] = useState([]);
  const [supervisorModes, setSupervisorModes] = useState({});
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState(editingStatement?.template_id || null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [supervisorsRes, templatesRes] = await Promise.all([
        statementsApi.getSupervisors(),
        statementsApi.getTemplates(),
      ]);
      setSupervisors(supervisorsRes.data);
      setTemplates(templatesRes.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить данные для заявления');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || null;

  const selectTemplate = (template) => {
    if (selectedTemplateId === template.id) {
      setSelectedTemplateId(null);
      return;
    }
    setSelectedTemplateId(template.id);
    if (template.default_message) {
      setMessage(template.default_message);
    }
  };

  const clearTemplate = () => setSelectedTemplateId(null);

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

  const handleSubmit = async (isDraft = false) => {
    if (!message.trim()) {
      Alert.alert('Ошибка', 'Введите текст заявления');
      return;
    }

    if (editingStatement) {
      setSaving(true);
      try {
        await statementsApi.updateStatement(editingStatement.id, { message: message.trim() });
        Alert.alert('Готово', 'Изменения сохранены', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } catch (err) {
        Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить изменения');
      } finally {
        setSaving(false);
      }
      return;
    }

    const payload = { message: message.trim(), is_draft: isDraft };

    if (selectedTemplate) {
      payload.template_id = selectedTemplate.id;
    } else {
      const approverUserIds = Object.keys(supervisorModes)
        .filter(id => supervisorModes[id] === 'approve')
        .map(Number);
      const notifyUserIds = Object.keys(supervisorModes)
        .filter(id => supervisorModes[id] === 'notify')
        .map(Number);
      if (!isDraft && approverUserIds.length === 0) {
        Alert.alert('Ошибка', 'Выберите хотя бы одного согласующего руководителя');
        return;
      }
      payload.approver_user_ids = approverUserIds;
      payload.notify_user_ids = notifyUserIds;
    }

    setSaving(true);
    try {
      await statementsApi.createStatement(payload);
      Alert.alert('Готово', isDraft ? 'Черновик заявления сохранён' : 'Заявление отправлено на согласование', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить заявление');
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {templates.length > 0 && (
          <>
            <Text style={[styles.label, { color: colors.text }]}>Шаблон заявления</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateRow}>
              <TouchableOpacity
                style={[
                  styles.templateChip,
                  { borderColor: colors.border, backgroundColor: !selectedTemplate ? colors.primary : colors.surface },
                ]}
                onPress={clearTemplate}
              >
                <Text style={[styles.templateChipText, { color: !selectedTemplate ? '#fff' : colors.text }]}>Без шаблона</Text>
              </TouchableOpacity>
              {templates.map(template => (
                <TouchableOpacity
                  key={template.id}
                  style={[
                    styles.templateChip,
                    { borderColor: colors.border, backgroundColor: selectedTemplateId === template.id ? colors.primary : colors.surface },
                  ]}
                  onPress={() => selectTemplate(template)}
                >
                  <Text style={[styles.templateChipText, { color: selectedTemplateId === template.id ? '#fff' : colors.text }]}>
                    {template.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Текст заявления</Text>
        <TextInput
          style={[
            styles.messageInput,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
          value={message}
          onChangeText={setMessage}
          placeholder="Опишите суть заявления"
          placeholderTextColor={colors.textSecondary}
          multiline
          textAlignVertical="top"
        />

        {selectedTemplate ? (
          <View style={{ marginTop: 20 }}>
            <Text style={[styles.label, { color: colors.text }]}>Согласующие и уведомляемые по шаблону</Text>
            {(selectedTemplate.recipients || []).length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>В шаблоне не настроены получатели</Text>
            ) : (
              (selectedTemplate.recipients || []).map(recipient => {
                const user = recipient.user || {};
                const recipientName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || `#${recipient.user_id}`;
                return (
                  <View key={recipient.user_id} style={[styles.supervisorRow, { borderColor: colors.border }]}>
                    <Text style={[styles.supervisorName, { color: colors.text }]}>{recipientName}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {recipient.role === 'approve' ? 'Согласование' : 'Уведомление'}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.text, marginTop: 20 }]}>Руководители</Text>
            {supervisors.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Вышестоящих руководителей не найдено
              </Text>
            ) : (
              supervisors.map(supervisor => {
                const supervisorName = `${supervisor.first_name || ''} ${supervisor.last_name || ''}`.trim() || `#${supervisor.id}`;
                const mode = supervisorModes[supervisor.id];
                return (
                  <View key={supervisor.id} style={[styles.supervisorRow, { borderColor: colors.border }]}>
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
              })
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        {!editingStatement && (
          <TouchableOpacity
            style={[styles.draftBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
            onPress={() => handleSubmit(true)}
            disabled={saving}
          >
            <Text style={[styles.draftBtnText, { color: colors.text }]}>Сохранить как черновик</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary, marginTop: !editingStatement ? 8 : 0 }]}
          onPress={() => handleSubmit(false)}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitBtnText}>
              {editingStatement ? 'Сохранить изменения' : 'Отправить на согласование'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 15, paddingBottom: 30 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  templateRow: { flexDirection: 'row' },
  templateChip: {
    borderWidth: 1, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8,
  },
  templateChipText: { fontSize: 13, fontWeight: '600' },
  messageInput: {
    minHeight: 120, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14,
  },
  emptyText: { fontStyle: 'italic', fontSize: 13 },
  supervisorRow: { paddingVertical: 10, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  supervisorName: { fontSize: 14, marginBottom: 6 },
  supervisorModeOptions: { flexDirection: 'row' },
  supervisorModeOption: { flexDirection: 'row', alignItems: 'center', marginRight: 20 },
  supervisorModeLabel: { fontSize: 13, marginLeft: 6 },
  footer: { padding: 15, borderTopWidth: 1 },
  draftBtn: { padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  draftBtnText: { fontWeight: '600', fontSize: 14 },
  submitBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
