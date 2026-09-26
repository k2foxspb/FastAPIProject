import React from 'react';
import { View, Text, TextInput, TouchableOpacity, Animated, Vibration, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { styles } from '../styles';
import { formatRecordingTime, getReplyPreviewText } from '../utils';

// Нижняя панель: превью ответа, отправка текста/вложений, запись голосовых и видеосообщений
export default function ChatInputBar({
  colors,
  insets,
  isKeyboardVisible,
  currentUserId,
  interlocutor,
  // текст
  inputText,
  onChangeText,
  textInputRef,
  onSendMessage,
  // ответ
  replyingToMessage,
  onCancelReply,
  // пересылка
  pendingForwardMessages,
  onCancelForward,
  // вложения
  onPickDocument,
  onPickMedia,
  // режим кнопки записи
  inputMode,
  onToggleInputMode,
  // голосовое
  isRecording,
  recordedUri,
  recordingDuration,
  recorderStatus,
  recordingDotOpacity,
  onStartRecording,
  onStopRecording,
  onDeleteRecording,
  onSendVoice,
  // видеосообщение
  isVideoRecording,
  pendingVideoNoteUri,
  onStartVideoRecording,
  onStopVideoRecording,
  onDiscardVideoNote,
  onSendVideoNote,
}) {
  const isAnyRecording = isRecording || isVideoRecording;

  return (
    <View style={[
      styles.inputContainer, 
      { 
        backgroundColor: colors.background, 
        borderTopColor: colors.border, 
        borderTopWidth: 1,
        paddingBottom: Platform.OS === 'web' 
          ? 20 
          : (isKeyboardVisible ? (Platform.OS === 'ios' ? 10 : 8) : Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 10)),
        flexDirection: 'column'
      }
    ]}>
      {pendingForwardMessages && pendingForwardMessages.length > 0 && (
        <View style={styles.replyPreviewContainer}>
          <MaterialIcons name="forward" size={20} color={colors.primary} style={{ marginRight: 10 }} />
          <View style={styles.replyPreviewContent}>
            <Text style={[styles.replyPreviewSender, { color: colors.primary }]} numberOfLines={1}>
              Пересылка
            </Text>
            <Text style={[styles.replyPreviewText, { color: colors.textSecondary }]} numberOfLines={1}>
              {pendingForwardMessages.length === 1
                ? getReplyPreviewText(pendingForwardMessages[0])
                : `${pendingForwardMessages.length} сообщений`}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelForward} style={styles.replyPreviewClose}>
            <MaterialIcons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
      {replyingToMessage && (
        <View style={styles.replyPreviewContainer}>
          <View style={[styles.replyPreviewBorder, { backgroundColor: colors.primary }]} />
          <View style={styles.replyPreviewContent}>
            <Text style={[styles.replyPreviewSender, { color: colors.primary }]} numberOfLines={1}>
              {Number(replyingToMessage.sender_id) === Number(currentUserId) ? 'Вы' : (interlocutor?.first_name || 'Собеседник')}
            </Text>
            <Text style={[styles.replyPreviewText, { color: colors.textSecondary }]} numberOfLines={1}>
              {getReplyPreviewText(replyingToMessage)}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelReply} style={styles.replyPreviewClose}>
            <MaterialIcons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
        {pendingVideoNoteUri ? (
        <View style={styles.recordedContainer}>
          <TouchableOpacity onPress={onDiscardVideoNote} style={styles.deleteRecordingButton}>
            <MaterialIcons name="delete" size={24} color={colors.error} />
          </TouchableOpacity>
          <View style={styles.recordingWaveformPlaceholder}>
            <MaterialIcons name="videocam" size={20} color={colors.primary} />
            <Text style={[styles.recordingTimeText, { color: colors.text }]}>Видеосообщение</Text>
          </View>
          <TouchableOpacity onPress={onSendVideoNote} style={[styles.sendButton, { marginRight: 10 }]}>
            <MaterialIcons name="send" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
      ) : recordedUri ? (
        <View style={styles.recordedContainer}>
          <TouchableOpacity onPress={onDeleteRecording} style={styles.deleteRecordingButton}>
            <MaterialIcons name="delete" size={24} color={colors.error} />
          </TouchableOpacity>
          <View style={styles.recordingWaveformPlaceholder}>
            <MaterialIcons name="mic" size={20} color={colors.primary} />
            <Text style={[styles.recordingTimeText, { color: colors.text }]}>Голосовое сообщение ({formatRecordingTime(recordingDuration)})</Text>
          </View>
          <TouchableOpacity onPress={onSendVoice} style={[styles.sendButton, { marginRight: 10 }]}>
            <MaterialIcons name="send" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {!isRecording && (
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity 
                onPress={onPickDocument} 
                style={styles.attachButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="insert-drive-file" size={24} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={onPickMedia} 
                style={styles.attachButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialIcons name="image" size={24} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}
          
          {isAnyRecording ? (
            <View style={styles.recordingContainer}>
              <View style={styles.recordingIndicator}>
                <Animated.View style={[styles.recordingDot, { opacity: recordingDotOpacity }]} />
                <Text style={[styles.recordingTimeText, { color: colors.error }]}>
                  {isVideoRecording ? "Запись видео..." : formatRecordingTime(recorderStatus.durationMillis || recordingDuration)}
                </Text>
              </View>
              <Text style={[styles.recordingHint, { color: colors.textSecondary }]}>Отпустите для завершения</Text>
            </View>
          ) : (
            <TextInput
              ref={textInputRef}
              style={[styles.input, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              value={inputText}
              onChangeText={onChangeText}
              placeholder="Сообщение..."
              placeholderTextColor={colors.textSecondary}
              multiline
            />
          )}

          {((inputText.trim() || (pendingForwardMessages && pendingForwardMessages.length > 0)) && !isAnyRecording) ? (
            <TouchableOpacity onPress={onSendMessage} style={[styles.sendButton, { marginRight: 10 }]}>
              <MaterialIcons name="send" size={24} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              onLongPress={inputMode === 'audio' ? onStartRecording : onStartVideoRecording} 
              onPressOut={inputMode === 'audio' ? onStopRecording : onStopVideoRecording}
              onPress={() => {
                Vibration.vibrate(50);
                onToggleInputMode();
              }}
              delayLongPress={200}
              style={[
                styles.sendButton, 
                { marginRight: 10 },
                isAnyRecording && { backgroundColor: colors.primary + '20', borderRadius: 20 }
              ]}
            >
              <MaterialIcons 
                name={inputMode === 'audio' ? (isRecording ? "mic" : "mic-none") : "videocam"} 
                size={24} 
                color={isAnyRecording ? colors.error : colors.primary} 
              />
            </TouchableOpacity>
          )}
        </>
      )}
      </View>
    </View>
  );
}
