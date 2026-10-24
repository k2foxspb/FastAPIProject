import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { APP_LINK_PATTERN, navigateToAppSection } from '../../../constants/appSections';

// Разбивает текст ответа ассистента на обычные фрагменты и ссылки на разделы
// приложения вида [Текст](app://key), чтобы отрисовать ссылки кликабельными.
function parseMessageContent(content) {
  const parts = [];
  let lastIndex = 0;
  let match;
  APP_LINK_PATTERN.lastIndex = 0;
  while ((match = APP_LINK_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'link', label: match[1], key: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return parts;
}

// Один пузырь сообщения в чате с ИИ: справа - сообщения пользователя,
// слева - ответы ассистента. Поддерживает выделение по долгому нажатию (для пересылки).
// Ответы ассистента могут содержать ссылки на разделы приложения - они
// показываются как кликабельный текст, переходящий на нужный экран.
export default function MessageBubble({ message, colors, isSelected, onPress, onLongPress, navigation }) {
  const isUser = message.role === 'user';
  const parts = isUser ? null : parseMessageContent(message.content);

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
        {isUser ? (
          <Text style={[styles.text, { color: '#fff' }]}>{message.content}</Text>
        ) : (
          <Text style={[styles.text, { color: colors.text }]}>
            {parts.map((part, idx) =>
              part.type === 'link' ? (
                <Text
                  key={idx}
                  style={[styles.link, { color: colors.primary }]}
                  onPress={() => navigateToAppSection(navigation, part.key)}
                >
                  {part.label}
                </Text>
              ) : (
                <Text key={idx}>{part.value}</Text>
              )
            )}
          </Text>
        )}
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
  link: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
});
