import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { styles } from '../styles';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Панель быстрых реакций-смайликов, показывается над выделенным сообщением
export default function ReactionBar({ colors, onSelect }) {
  return (
    <View style={[styles.reactionBarWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {QUICK_EMOJIS.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          style={styles.reactionBarEmojiButton}
          onPress={() => onSelect(emoji)}
        >
          <Text style={styles.reactionBarEmojiText}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
