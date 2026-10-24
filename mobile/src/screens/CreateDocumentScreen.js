import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  Alert, Platform, Modal, FlatList,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi, orgApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getRoleLabel } from '../constants/roles';

export default function CreateDocumentScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { categoryId: initialCategoryId, documentId } = route.params || {};
  const isEditing = !!documentId;

  const [categories, setCategories] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [categoryId, setCategoryId] = useState(initialCategoryId || null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [content, setContent] = useState('');
  const [confirmationButtonText, setConfirmationButtonText] = useState('Ознакомлен');
  const [approverIds, setApproverIds] = useState([]);
  const [status, setStatus] = useState('draft');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [approversModalVisible, setApproversModalVisible] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, empRes] = await Promise.all([
        documentsApi.getCategories(),
        orgApi.getEmployees().catch(() => ({ data: [] })),
      ]);
      setCategories(catRes.data || []);
      setEmployees(empRes.data || []);

      if (isEditing) {
        const docRes = await documentsApi.getDocument(documentId);
        const doc = docRes.data;
        setCategoryId(doc.category_id);
        setTitle(doc.title);
        setDescription(doc.description || '');
        setFileUrl(doc.file_url || '');
        setContent(doc.content || '');
        setConfirmationButtonText(doc.confirmation_button_text || 'Ознакомлен');
        setStatus(doc.status);
      }
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [isEditing, documentId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const toggleApprover = (userId) => {
    setApproverIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const validate = () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите название документа');
      return false;
    }
    if (!categoryId) {
      Alert.alert('Ошибка', 'Выберите категорию документа');
      return false;
    }
    if (!confirmationButtonText.trim()) {
      Alert.alert('Ошибка', 'Укажите текст кнопки подтверждения');
      return false;
    }
    return true;
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        category_id: categoryId,
        title: title.trim(),
        description: description.trim() || null,
        file_url: fileUrl.trim() || null,
        content: content.trim() || null,
        confirmation_button_text: confirmationButtonText.trim(),
      };
      let savedId = documentId;
      if (isEditing) {
        await documentsApi.updateDocument(documentId, payload);
      } else {
        payload.approver_ids = approverIds;
        const res = await documentsApi.createDocument(payload);
        savedId = res.data.id;
      }
      if (isEditing && approverIds.length > 0) {
        await documentsApi.setApprovers(documentId, approverIds);
      }
      Alert.alert('Готово', 'Документ сохранён', [
        { text: 'OK', onPress: () => navigation.replace('DocumentManage', { documentId: savedId }) },
      ]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось сохранить документ');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.label, { color: colors.text }]}>Категория</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {categories.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chip, { borderColor: colors.border, backgroundColor: categoryId === c.id ? colors.primary : colors.surface }]}
              onPress={() => setCategoryId(c.id)}
            >
              <Text style={[styles.chipText, { color: categoryId === c.id ? '#fff' : colors.text }]}>{c.title}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.label, { color: colors.text }]}>Название документа</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Например: Инструкция по технике безопасности"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>Описание</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Краткое описание документа"
          placeholderTextColor={colors.textSecondary}
          multiline
        />

        <Text style={[styles.label, { color: colors.text }]}>Ссылка на файл документа</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={fileUrl}
          onChangeText={setFileUrl}
          placeholder="https://..."
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
        />

        <Text style={[styles.label, { color: colors.text }]}>Текст документа (если без файла)</Text>
        <TextInput
          style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={content}
          onChangeText={setContent}
          placeholder="Текст документа"
          placeholderTextColor={colors.textSecondary}
          multiline
        />

        <Text style={[styles.label, { color: colors.text }]}>Текст кнопки подтверждения</Text>
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={confirmationButtonText}
          onChangeText={setConfirmationButtonText}
          placeholder="Ознакомлен"
          placeholderTextColor={colors.textSecondary}
        />

        {(!isEditing || status === 'draft' || status === 'rejected') && (
          <>
            <Text style={[styles.label, { color: colors.text }]}>Подписанты (необязательно)</Text>
            <TouchableOpacity
              style={[styles.pickerBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => setApproversModalVisible(true)}
            >
              <Icon name="people-outline" size={18} color={colors.primary} />
              <Text style={[styles.pickerBtnText, { color: colors.text }]}>
                {approverIds.length > 0 ? `Выбрано: ${approverIds.length}` : 'Выбрать подписантов для согласования'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary }]}
          onPress={handleSaveDraft}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitBtnText}>{isEditing ? 'Сохранить изменения' : 'Сохранить черновик'}</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={approversModalVisible} animationType="slide" onRequestClose={() => setApproversModalVisible(false)}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Выбор подписантов</Text>
            <TouchableOpacity onPress={() => setApproversModalVisible(false)}>
              <Icon name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={employees}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => {
              const selected = approverIds.includes(item.id);
              return (
                <TouchableOpacity
                  style={[styles.employeeRow, { borderBottomColor: colors.border }]}
                  onPress={() => toggleApprover(item.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.employeeName, { color: colors.text }]}>
                      {`${item.first_name || ''} ${item.last_name || ''}`.trim() || item.email}
                    </Text>
                    <Text style={[styles.employeeRole, { color: colors.textSecondary }]}>{getRoleLabel(item.role)}</Text>
                  </View>
                  <Icon
                    name={selected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={selected ? colors.primary : colors.textSecondary}
                  />
                </TouchableOpacity>
              );
            }}
          />
          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: colors.primary }]}
              onPress={() => setApproversModalVisible(false)}
            >
              <Text style={styles.submitBtnText}>Готово ({approverIds.length})</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 15, paddingBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', marginBottom: 5 },
  chip: { borderWidth: 1, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  chipText: { fontSize: 13, fontWeight: '600' },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12 },
  pickerBtnText: { marginLeft: 8, fontSize: 14 },
  footer: { padding: 15, borderTopWidth: 1 },
  submitBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, paddingTop: 50,
  },
  modalTitle: { fontSize: 17, fontWeight: 'bold' },
  employeeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  employeeName: { fontSize: 14, fontWeight: '600' },
  employeeRole: { fontSize: 12, marginTop: 2 },
});
