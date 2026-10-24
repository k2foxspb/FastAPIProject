import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getFullUrl } from '../utils/formatters';

const STATUS_INFO = {
  draft: { label: 'Черновик', color: '#9e9e9e' },
  pending_approval: { label: 'На согласовании', color: '#f59e0b' },
  approved: { label: 'Согласован', color: '#1e88e5' },
  rejected: { label: 'Отклонён', color: '#e53935' },
  sent: { label: 'Отправлен', color: '#43a047' },
  archived: { label: 'Архив', color: '#607d8b' },
};

export default function DocumentManageScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { documentId } = route.params;

  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const loadDocument = useCallback(async () => {
    try {
      const res = await documentsApi.getDocument(documentId);
      setDocument(res.data);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить документ');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useFocusEffect(useCallback(() => { loadDocument(); }, [loadDocument]));

  const handleSubmitForApproval = async () => {
    setActionLoading(true);
    try {
      const res = await documentsApi.submitForApproval(documentId);
      setDocument(res.data);
      Alert.alert('Готово', 'Документ отправлен на согласование');
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить на согласование');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemindApprovers = async () => {
    setActionLoading(true);
    try {
      const res = await documentsApi.remindApprovers(documentId);
      Alert.alert('Готово', `Напоминание отправлено: ${res.data.reminded_count}`);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить напоминание');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemindRecipients = async () => {
    setActionLoading(true);
    try {
      const res = await documentsApi.remindDocument(documentId);
      Alert.alert('Готово', `Напоминание отправлено: ${res.data.reminded_count}`);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отправить напоминание');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !document) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const statusInfo = STATUS_INFO[document.status] || { label: document.status, color: colors.textSecondary };
  const canEdit = document.status === 'draft' || document.status === 'rejected';
  const canAssign = document.status === 'approved' || document.status === 'sent' || (!document.approval_required && document.status === 'draft');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>{document.title}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
          <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
        </View>
      </View>

      {!!document.category_title && (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Категория: {document.category_title}</Text>
      )}
      {!!document.description && (
        <Text style={[styles.description, { color: colors.text }]}>{document.description}</Text>
      )}
      {!!document.file_url && (
        <TouchableOpacity onPress={() => Linking.openURL(document.file_url)}>
          <Text style={[styles.link, { color: colors.primary }]}>Открыть файл документа</Text>
        </TouchableOpacity>
      )}
      {!!document.content && (
        <Text style={[styles.contentText, { color: colors.text }]}>{document.content}</Text>
      )}

      {document.images?.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Фотографии / сканы</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
            {document.images.map((img) => (
              <TouchableOpacity key={img.id} onPress={() => Linking.openURL(getFullUrl(img.image_url))}>
                <Image source={{ uri: getFullUrl(img.thumbnail_url || img.image_url) }} style={styles.imageThumb} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </>
      )}

      {document.rejected_at && document.status === 'rejected' && (
        <View style={[styles.infoBox, { backgroundColor: '#e5393520', borderColor: '#e53935' }]}>
          <Icon name="close-circle-outline" size={18} color="#e53935" />
          <Text style={[styles.infoText, { color: '#e53935' }]}>
            Документ отклонён подписантом. Отредактируйте документ и отправьте его заново на согласование.
          </Text>
        </View>
      )}

      <View style={styles.actionsSection}>
        {canEdit && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => navigation.navigate('CreateDocument', { documentId })}
          >
            <Icon name="create-outline" size={18} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.text }]}>Редактировать документ</Text>
          </TouchableOpacity>
        )}

        {canEdit && document.approval_required && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={handleSubmitForApproval}
            disabled={actionLoading}
          >
            <Icon name="paper-plane-outline" size={18} color="#fff" />
            <Text style={[styles.actionBtnText, { color: '#fff' }]}>Отправить на согласование</Text>
          </TouchableOpacity>
        )}

        {document.approval_required && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => navigation.navigate('DocumentApprovalReport', { documentId })}
          >
            <Icon name="checkmark-done-outline" size={18} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.text }]}>
              Отчёт по согласованию ({document.approved_count}/{document.approvers_count})
            </Text>
          </TouchableOpacity>
        )}

        {document.status === 'pending_approval' && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={handleRemindApprovers}
            disabled={actionLoading}
          >
            <Icon name="notifications-outline" size={18} color="#f59e0b" />
            <Text style={[styles.actionBtnText, { color: colors.text }]}>Напомнить подписантам</Text>
          </TouchableOpacity>
        )}

        {canAssign && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('AssignDocument', { documentId })}
          >
            <Icon name="people-outline" size={18} color="#fff" />
            <Text style={[styles.actionBtnText, { color: '#fff' }]}>Отправить получателям</Text>
          </TouchableOpacity>
        )}

        {document.assignees_count > 0 && (
          <>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={() => navigation.navigate('DocumentReport', { documentId })}
            >
              <Icon name="stats-chart-outline" size={18} color={colors.primary} />
              <Text style={[styles.actionBtnText, { color: colors.text }]}>
                Отчёт по ознакомлению ({document.confirmed_count}/{document.assignees_count})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={handleRemindRecipients}
              disabled={actionLoading}
            >
              <Icon name="notifications-outline" size={18} color="#f59e0b" />
              <Text style={[styles.actionBtnText, { color: colors.text }]}>Отправить повторное уведомление</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: 'bold', flex: 1, marginRight: 10 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  meta: { fontSize: 13, marginTop: 6 },
  description: { fontSize: 15, marginTop: 12, lineHeight: 21 },
  link: { fontSize: 14, marginTop: 12, fontWeight: '600' },
  contentText: { fontSize: 14, marginTop: 12, lineHeight: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  imageRow: { marginBottom: 5 },
  imageThumb: { width: 110, height: 110, borderRadius: 10, marginRight: 10 },
  infoBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 16 },
  infoText: { fontSize: 13, marginLeft: 8, flex: 1 },
  actionsSection: { marginTop: 24 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'transparent', borderRadius: 10, paddingVertical: 13, marginBottom: 10,
  },
  actionBtnText: { marginLeft: 8, fontSize: 14, fontWeight: '600' },
});
