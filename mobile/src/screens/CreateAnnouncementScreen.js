import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { announcementsApi, orgApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { useNotifications } from '../context/NotificationContext';
import { getRoleScope } from '../constants/roles';

// Экран создания объявления. По умолчанию объявление уходит всем подчинённым
// автора по иерархии, но автор может сузить группу получателей до
// конкретного цеха/участка в пределах своей зоны ответственности
// (см. app/api/routers/announcements.py: target_workshop_id/target_section_id).
export default function CreateAnnouncementScreen({ navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [workshops, setWorkshops] = useState([]);
  const [sections, setSections] = useState([]);
  const [targetWorkshopId, setTargetWorkshopId] = useState(null);
  const [targetSectionId, setTargetSectionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const scope = currentUser ? getRoleScope(currentUser.role) : 'self';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (scope === 'global') {
        const res = await orgApi.getWorkshops();
        setWorkshops(res.data || []);
      } else if (scope === 'workshop' && currentUser?.workshop_id) {
        const res = await orgApi.getSections(currentUser.workshop_id);
        setSections(res.data || []);
      }
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить список цехов/участков');
    } finally {
      setLoading(false);
    }
  }, [scope, currentUser]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const selectWorkshop = async (workshopId) => {
    setTargetWorkshopId(workshopId);
    setTargetSectionId(null);
    setSections([]);
    if (workshopId == null) return;
    try {
      const res = await orgApi.getSections(workshopId);
      setSections(res.data || []);
    } catch (err) {
      // Список участков необязателен - объявление всё равно можно отправить на весь цех
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Ошибка', 'Введите заголовок объявления');
      return;
    }
    if (!content.trim()) {
      Alert.alert('Ошибка', 'Введите текст объявления');
      return;
    }

    const payload = { title: title.trim(), content: content.trim() };
    if (targetWorkshopId != null) payload.target_workshop_id = targetWorkshopId;
    if (targetSectionId != null) payload.target_section_id = targetSectionId;

    setSaving(true);
    try {
      await announcementsApi.createAnnouncement(payload);
      Alert.alert('Готово', 'Объявление опубликовано', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось опубликовать объявление');
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
        <Text style={[styles.label, { color: colors.text }]}>Заголовок</Text>
        <TextInput
          style={[styles.titleInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Короткий заголовок объявления"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Текст объявления</Text>
        <TextInput
          style={[styles.messageInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
          value={content}
          onChangeText={setContent}
          placeholder="Текст объявления"
          placeholderTextColor={colors.textSecondary}
          multiline
          textAlignVertical="top"
        />

        {scope === 'global' && (
          <>
            <Text style={[styles.label, { color: colors.text, marginTop: 20 }]}>Кого оповестить</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, { borderColor: colors.border, backgroundColor: targetWorkshopId == null ? colors.primary : colors.surface }]}
                onPress={() => selectWorkshop(null)}
              >
                <Text style={[styles.chipText, { color: targetWorkshopId == null ? '#fff' : colors.text }]}>Все цеха</Text>
              </TouchableOpacity>
              {workshops.map(w => (
                <TouchableOpacity
                  key={w.id}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: targetWorkshopId === w.id ? colors.primary : colors.surface }]}
                  onPress={() => selectWorkshop(w.id)}
                >
                  <Text style={[styles.chipText, { color: targetWorkshopId === w.id ? '#fff' : colors.text }]}>{w.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {(scope === 'global' || scope === 'workshop') && sections.length > 0 && (targetWorkshopId != null || scope === 'workshop') && (
          <>
            <Text style={[styles.label, { color: colors.text, marginTop: 15 }]}>Участок (необязательно)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, { borderColor: colors.border, backgroundColor: targetSectionId == null ? colors.primary : colors.surface }]}
                onPress={() => setTargetSectionId(null)}
              >
                <Text style={[styles.chipText, { color: targetSectionId == null ? '#fff' : colors.text }]}>Весь цех</Text>
              </TouchableOpacity>
              {sections.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: targetSectionId === s.id ? colors.primary : colors.surface }]}
                  onPress={() => setTargetSectionId(s.id)}
                >
                  <Text style={[styles.chipText, { color: targetSectionId === s.id ? '#fff' : colors.text }]}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {scope === 'section' && (
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Объявление будет отправлено всем сотрудникам вашего участка
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary }]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitBtnText}>Опубликовать</Text>
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
  titleInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  messageInput: { minHeight: 120, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  chipRow: { flexDirection: 'row' },
  chip: { borderWidth: 1, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  chipText: { fontSize: 13, fontWeight: '600' },
  infoBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 20 },
  infoText: { fontSize: 13, marginLeft: 8, flex: 1 },
  footer: { padding: 15, borderTopWidth: 1 },
  submitBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});
