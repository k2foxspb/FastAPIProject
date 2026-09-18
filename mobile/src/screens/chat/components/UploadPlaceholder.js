import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { formatFileSize } from '../../../utils/formatters';
import { styles } from '../styles';
import MediaPlaceholder from './MediaPlaceholder';

// Локальный плейсхолдер отправителя для текущей загрузки (ListHeaderComponent инвертированного списка)
export default function UploadPlaceholder({ uploadingProgress, uploadingData, activeUploadId, onCancel, colors }) {
  if (uploadingProgress === null || !uploadingData.uri) return null;

  const progressPercent = Math.round(uploadingProgress * 100);
  const progressText = (uploadingData.loaded !== undefined && uploadingData.total !== undefined && uploadingData.total > 0)
      ? `${formatFileSize(uploadingData.loaded)} / ${formatFileSize(uploadingData.total)}`
      : (progressPercent > 0 ? `${progressPercent}%` : '');

  // Определяем тип для плейсхолдера
  let type = uploadingData.type || 'file';
  // Если тип уже специфичный (например, video_note), не переопределяем его общим типом видео
  if (type !== 'video_note') {
      if (uploadingData.mimeType?.startsWith('image/')) type = 'image';
      else if (uploadingData.mimeType?.startsWith('video/')) type = 'video';
      else if (uploadingData.mimeType?.startsWith('audio/') || type === 'voice') type = 'voice';
  }

  const isMediaGroup = type === 'media_group';

  const isVideoNote = type === 'video_note';

  return (
    <View style={[styles.messageWrapper, styles.sentWrapper, { marginBottom: 10 }]}>
      <View style={[
          styles.messageBubble, 
          styles.sent, 
          { 
              backgroundColor: isVideoNote ? 'transparent' : colors.primary, 
              padding: isVideoNote ? 0 : 4,
              alignItems: isVideoNote ? 'center' : 'stretch'
          }
      ]}> 
        {/* Рендерим плейсхолдеры для медиа в процессе загрузки */}
        {isMediaGroup && uploadingData.attachments && uploadingData.attachments.map((att, idx) => (
          <View key={`upload_att_${idx}`} style={{ marginBottom: 4 }}>
            <MediaPlaceholder type={att.type} isReceived={false} uri={att.file_path || att.uri} colors={colors} />
          </View>
        ))}
        {!isMediaGroup && <MediaPlaceholder type={type} isReceived={false} uri={uploadingData.uri} colors={colors} />}
        
        <View style={{ 
            flexDirection: 'row', 
            alignItems: 'center', 
            padding: 8,
            backgroundColor: isVideoNote ? 'rgba(0,0,0,0.5)' : 'transparent',
            borderRadius: isVideoNote ? 20 : 0,
            marginTop: isVideoNote ? -40 : 0,
            marginBottom: isVideoNote ? 10 : 0
        }}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={[styles.messageText, { color: '#fff', marginLeft: 8, fontSize: 12 }]}>
            {progressPercent >= 100 ? "Обработка..." : (isVideoNote ? (progressPercent > 0 ? `${progressPercent}%` : "Загрузка...") : "Загрузка... " + progressText)}
          </Text>
          <TouchableOpacity 
            onPress={() => onCancel(activeUploadId)}
            style={{ marginLeft: 10 }}
          >
            <MaterialIcons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
