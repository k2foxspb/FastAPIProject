import React from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

// Нижняя панель ввода: текстовое поле + кнопка отправки.
// Кнопка блокируется, пока уже выполняется запрос (isSending) или поле пустое.
export default function ChatInput({ value, onChangeText, onSend, isSending, colors }) {
  const canSend = value.trim().length > 0 && !isSending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
      <TextInput
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
        value={value}
        onChangeText={onChangeText}
        placeholder="Напишите сообщение..."
        placeholderTextColor={colors.textSecondary}
        multiline
        editable={!isSending}
      />
      <TouchableOpacity
        style={[styles.sendButton, { backgroundColor: canSend ? colors.primary : colors.border }]}
        onPress={onSend}
        disabled={!canSend}
      >
        {isSending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MaterialIcons name="send" size={20} color="#fff" />
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    marginRight: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
