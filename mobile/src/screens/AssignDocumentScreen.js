import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi, orgApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getRoleLabel } from '../constants/roles';

export default function AssignDocumentScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { documentId } = route.params;

  const [workshops, setWorkshops] = useState([]);
  const [sections, setSections] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedWorkshops, setSelectedWorkshops] = useState([]);
  const [selectedSections, setSelectedSections] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [wsRes, secRes, empRes] = await Promise.all([
        orgApi.getWorkshops().catch(() => ({ data: [] })),
        orgApi.getSections().catch(() => ({ data: [] })),
        orgApi.getEmployees().catch(() => ({ data: [] })),
      ]);
      setWorkshops(wsRes.data || []);
      setSections(secRes.data || []);
      setEmployees(empRes.data || []);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить список получателей');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const toggle = (list, setList, id) => {
    setList((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAssign = async () => {
    if (selectedWorkshops.length === 0 && selectedSections.length === 0 && selectedUsers.length === 0) {
      Alert.alert('Ошибка', 'Выберите хотя бы одного получателя (цех, отдел или пользователя)');
      return;
    }
    setSaving(true);
    try {
      const res = await documentsApi.assignDocument(documentId, {
        workshop_ids: selectedWorkshops,
        section_ids: selectedSections,
        user_ids: selectedUsers,
      });
      Alert.alert('Готово', `Документ назначен на ознакомление: ${res.data.length} получателей`, [
        { text: 'OK', onPress: () => navigation.replace('DocumentManage', { documentId }) },
      ]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить документ получателям');
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Весь цех</Text>
        {workshops.map((w) => {
          const selected = selectedWorkshops.includes(w.id);
          return (
            <TouchableOpacity
              key={`ws-${w.id}`}
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => toggle(selectedWorkshops, setSelectedWorkshops, w.id)}
            >
              <Icon name="business-outline" size={18} color={colors.primary} />
              <Text style={[styles.rowText, { color: colors.text }]}>{w.name}</Text>
              <Icon name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Отдел / участок</Text>
        {sections.map((s) => {
          const selected = selectedSections.includes(s.id);
          return (
            <TouchableOpacity
              key={`sec-${s.id}`}
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => toggle(selectedSections, setSelectedSections, s.id)}
            >
              <Icon name="briefcase-outline" size={18} color={colors.primary} />
              <Text style={[styles.rowText, { color: colors.text }]}>{s.name}</Text>
              <Icon name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
          );
        })}

        <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 20 }]}>Конкретные пользователи</Text>
        {employees.map((e) => {
          const selected = selectedUsers.includes(e.id);
          return (
            <TouchableOpacity
              key={`user-${e.id}`}
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() => toggle(selectedUsers, setSelectedUsers, e.id)}
            >
              <Icon name="person-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.rowText, { color: colors.text, marginLeft: 0 }]}>
                  {`${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email}
                </Text>
                <Text style={[styles.rowSubText, { color: colors.textSecondary }]}>{getRoleLabel(e.role)}</Text>
              </View>
              <Icon name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? colors.primary : colors.textSecondary} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: colors.primary }]} onPress={handleAssign} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Отправить получателям</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 20 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', marginBottom: 6 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, marginLeft: 10, fontSize: 14 },
  rowSubText: { fontSize: 12, marginTop: 2 },
  footer: { padding: 15, borderTopWidth: 1 },
  submitBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
