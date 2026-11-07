import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { styles } from '../styles';
import { REACTION_EMOJIS } from '../emojis';

// Одна кнопка-эмодзи: плавно проявляется (FadeIn, по очереди), без дополнительных эффектов при нажатии.
function AnimatedEmojiButton({ emoji, index, onSelect }) {
  const handlePress = () => {
    onSelect(emoji);
  };

  return (
    <Animated.View entering={FadeIn.delay(index * 40)}>
      <TouchableOpacity style={styles.reactionBarEmojiButton} onPress={handlePress}>
        <Text style={styles.reactionBarEmojiText}>{emoji}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// Панель быстрых реакций-смайликов, показывается над выделенным сообщением
export default function ReactionBar({ colors, onSelect }) {
  return (
    <View style={[styles.reactionBarWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {REACTION_EMOJIS.map((emoji, index) => (
        <AnimatedEmojiButton key={emoji} emoji={emoji} index={index} onSelect={onSelect} />
      ))}
    </View>
  );
}
