import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking, TextInput, Modal, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getFullUrl } from '../utils/formatters';

export default function DocumentApprovalScreen({ navigation, route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { documentId } = route.params;

  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [approveComment, setApproveComment] = useState('');

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

  const handleApprove = async () => {
    setActing(true);
    try {
      await documentsApi.approveDocument(documentId, approveComment.trim() || null);
      Alert.alert('Готово', 'Документ согласован', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось согласовать документ');
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    if (!rejectComment.trim()) {
      Alert.alert('Ошибка', 'При отклонении комментарий обязателен');
      return;
    }
    setActing(true);
    try {
      await documentsApi.rejectDocument(documentId, rejectComment.trim());
      setRejectModalVisible(false);
      Alert.alert('Готово', 'Документ отклонён', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось отклонить документ');
    } finally {
      setActing(false);
    }
  };

  if (loading || !document) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const authorName = document.author
    ? `${document.author.first_name || ''} ${document.author.last_name || ''}`.trim() || 'Руководитель'
    : 'Руководитель';
  const alreadyDecided = document.my_approval_status && document.my_approval_status !== 'pending';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{document.title}</Text>
        {!!document.category_title && (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>Категория: {document.category_title}</Text>
        )}
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Автор: {authorName}</Text>
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
            <Text style={[styles.label, { color: colors.text }]}>Фотографии / сканы</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageRow}>
              {document.images.map((img) => (
                <TouchableOpacity key={img.id} onPress={() => Linking.openURL(getFullUrl(img.image_url))}>
                  <Image source={{ uri: getFullUrl(img.thumbnail_url || img.image_url) }} style={styles.imageThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {!alreadyDecided && (
          <>
            <Text style={[styles.label, { color: colors.text }]}>Комментарий при согласовании (необязательно)</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              value={approveComment}
              onChangeText={setApproveComment}
              placeholder="Комментарий"
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          </>
        )}

        {alreadyDecided && (
          <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Вы уже приняли решение по этому документу: {document.my_approval_status === 'approved' ? 'согласовано' : 'отклонено'}
            </Text>
          </View>
        )}
      </ScrollView>

      {!alreadyDecided && (
        <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
          <TouchableOpacity
            style={[styles.rejectBtn, { borderColor: colors.error || '#e53935' }]}
            onPress={() => setRejectModalVisible(true)}
            disabled={acting}
          >
            <Text style={{ color: colors.error || '#e53935', fontWeight: 'bold' }}>Отклонить</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.approveBtn, { backgroundColor: colors.primary }]}
            onPress={handleApprove}
            disabled={acting}
          >
            {acting ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveBtnText}>Согласовать</Text>}
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={rejectModalVisible} transparent animationType="fade" onRequestClose={() => setRejectModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Отклонить документ</Text>
            <TextInput
              style={[styles.input, styles.textArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Укажите причину отклонения (обязательно)"
              placeholderTextColor={colors.textSecondary}
              value={rejectComment}
              onChangeText={setRejectComment}
              multiline
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.border }]} onPress={() => setRejectModalVisible(false)}>
                <Text style={{ color: colors.text }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.error || '#e53935', borderColor: colors.error || '#e53935' }]}
                onPress={handleReject}
                disabled={acting}
              >
                {acting ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: 'bold' }}>Отклонить</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 20 },
  title: { fontSize: 20, fontWeight: 'bold' },
  meta: { fontSize: 13, marginTop: 6 },
  description: { fontSize: 15, marginTop: 12, lineHeight: 21 },
  link: { fontSize: 14, marginTop: 12, fontWeight: '600' },
  contentText: { fontSize: 14, marginTop: 12, lineHeight: 20 },
  imageRow: { marginBottom: 5 },
  imageThumb: { width: 110, height: 110, borderRadius: 10, marginRight: 10 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 18, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  infoBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 18 },
  infoText: { fontSize: 13, marginLeft: 8, flex: 1 },
  footer: { flexDirection: 'row', padding: 15, borderTopWidth: 1 },
  rejectBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, padding: 13, alignItems: 'center', marginRight: 10 },
  approveBtn: { flex: 1, borderRadius: 10, padding: 13, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 16 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, marginLeft: 10 },
});
