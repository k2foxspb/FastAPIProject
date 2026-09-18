import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { formatFileSize } from '../../../utils/formatters';
import { styles } from '../styles';

// Полоса прогресса загрузки под шапкой (когда у загрузки нет превью)
export default function UploadProgressBanner({
  uploadingProgress,
  uploadingData,
  activeUploadId,
  batchMode,
  batchTotal,
  attachmentsLocalCount,
  onCancel,
  colors,
}) {
  if (uploadingProgress === null || uploadingData.uri) return null;

  return (
    <View style={[styles.uploadProgressContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.uploadProgressInfo}>
        <Text style={{ color: colors.text }}>
          {batchMode ? `Загрузка медиа (${attachmentsLocalCount + 1}/${batchTotal || 1}) - ${Math.round(uploadingProgress * 100)}%` : `Загрузка: ${formatFileSize(uploadingData.loaded)} / ${formatFileSize(uploadingData.total)} (${Math.round(uploadingProgress * 100)}%)`}
        </Text>
        <TouchableOpacity onPress={() => onCancel(activeUploadId)}>
          <MaterialIcons name="cancel" size={24} color={colors.error} />
        </TouchableOpacity>
      </View>
      <View style={styles.progressBarBackground}>
        <View style={[styles.progressBar, { width: `${uploadingProgress * 100}%`, backgroundColor: colors.primary }]} />
      </View>
    </View>
  );
}
