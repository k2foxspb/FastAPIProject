import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

// Один пузырь сообщения в чате с ИИ: справа - сообщения пользователя,
// слева - ответы ассистента. Поддерживает выделение по долгому нажатию (для пересылки).
export default function MessageBubble({ message, colors, isSelected, onPress, onLongPress }) {
  const isUser = message.role === 'user';

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.wrapper, isUser ? styles.wrapperUser : styles.wrapperAssistant]}
    >
      {isSelected && (
        <View style={styles.selectionIcon}>
          <MaterialIcons name="check-circle" size={18} color={colors.primary} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser
            ? [styles.bubbleUser, { backgroundColor: colors.primary }]
            : [styles.bubbleAssistant, { backgroundColor: colors.surface, borderColor: colors.border }],
          isSelected && { borderWidth: 1, borderColor: colors.primary },
        ]}
      >
        <Text style={[styles.text, { color: isUser ? '#fff' : colors.text }]}>
          {message.content}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    marginVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  wrapperUser: {
    justifyContent: 'flex-end',
  },
  wrapperAssistant: {
    justifyContent: 'flex-start',
  },
  selectionIcon: {
    marginHorizontal: 6,
  },
  bubble: {
    maxWidth: '80%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  bubbleUser: {
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    borderWidth: 1,
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 20,
  },
});
