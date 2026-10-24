import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { documentsApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function DocumentViewScreen({ route }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { documentId } = route.params;

  const [document, setDocument] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [docRes, myDocsRes] = await Promise.all([
        documentsApi.getDocument(documentId),
        documentsApi.getMyDocuments(),
      ]);
      setDocument(docRes.data);
      const myAssignment = (myDocsRes.data || []).find((a) => a.document_id === documentId);
      setAssignment(myAssignment || null);
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить документ');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const res = await documentsApi.confirmDocument(documentId);
      setAssignment(res.data);
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.detail || 'Не удалось подтвердить ознакомление');
    } finally {
      setConfirming(false);
    }
  };

  if (loading || !document) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const confirmed = assignment?.status === 'confirmed';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{document.title}</Text>
        {!!document.category_title && (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>Категория: {document.category_title}</Text>
        )}
        {!!document.description && (
          <Text style={[styles.description, { color: colors.text }]}>{document.description}</Text>
        )}
        {!!document.file_url && (
          <TouchableOpacity onPress={() => Linking.openURL(document.file_url)} style={styles.fileBtn}>
            <Icon name="document-attach-outline" size={20} color={colors.primary} />
            <Text style={[styles.link, { color: colors.primary }]}>Открыть файл документа</Text>
          </TouchableOpacity>
        )}
        {!!document.content && (
          <Text style={[styles.contentText, { color: colors.text }]}>{document.content}</Text>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
        {confirmed ? (
          <View style={[styles.confirmedBox, { backgroundColor: '#43a04720' }]}>
            <Icon name="checkmark-circle" size={20} color="#43a047" />
            <Text style={[styles.confirmedText, { color: '#43a047' }]}>
              Ознакомлен {assignment.confirmed_at ? new Date(assignment.confirmed_at).toLocaleString('ru-RU') : ''}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.primary }]}
            onPress={handleConfirm}
            disabled={confirming}
          >
            {confirming ? <ActivityIndicator color="#fff" /> : (
              <Text style={styles.submitBtnText}>{document.confirmation_button_text || 'Ознакомлен'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: 'bold' },
  meta: { fontSize: 13, marginTop: 6 },
  description: { fontSize: 15, marginTop: 12, lineHeight: 21 },
  fileBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  link: { fontSize: 14, marginLeft: 8, fontWeight: '600' },
  contentText: { fontSize: 14, marginTop: 14, lineHeight: 20 },
  footer: { padding: 15, borderTopWidth: 1 },
  submitBtn: { padding: 14, borderRadius: 10, alignItems: 'center' },
  submitBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  confirmedBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 10 },
  confirmedText: { marginLeft: 8, fontWeight: '600', fontSize: 14 },
});
