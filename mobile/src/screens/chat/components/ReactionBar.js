import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import Animated, { ZoomIn, useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring } from 'react-native-reanimated';
import { styles } from '../styles';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

// Одна кнопка-эмодзи: появляется с анимацией ZoomIn (по очереди), а при нажатии
// "подпрыгивает" — быстро увеличивается и пружинисто возвращается к исходному размеру.
function AnimatedEmojiButton({ emoji, index, onSelect }) {
  const scale = useSharedValue(1);

  const handlePress = () => {
    scale.value = withSequence(
      withTiming(1.7, { duration: 100 }),
      withSpring(1, { damping: 7, stiffness: 180 })
    );
    onSelect(emoji);
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View entering={ZoomIn.delay(index * 40).springify().damping(12)}>
      <TouchableOpacity style={styles.reactionBarEmojiButton} onPress={handlePress}>
        <Animated.Text style={[styles.reactionBarEmojiText, animatedStyle]}>{emoji}</Animated.Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// Панель быстрых реакций-смайликов, показывается над выделенным сообщением
export default function ReactionBar({ colors, onSelect }) {
  return (
    <View style={[styles.reactionBarWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {QUICK_EMOJIS.map((emoji, index) => (
        <AnimatedEmojiButton key={emoji} emoji={emoji} index={index} onSelect={onSelect} />
      ))}
    </View>
  );
}
