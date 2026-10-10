import React, { useEffect, useRef } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import Animated, { ZoomIn, useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring } from 'react-native-reanimated';
import { styles } from '../styles';

// Анимированный бейдж реакции под сообщением: при первом появлении "выезжает" (ZoomIn),
// а при изменении счётчика (постановке/снятии реакции) эмодзи "подлетает" вверх с увеличением,
// имитируя анимированную реакцию.
export default function ReactionBadge({ emoji, count, isMine, isReceived, colors, onPress, onLongPress }) {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    scale.value = withSequence(
      withTiming(1.5, { duration: 120 }),
      withSpring(1, { damping: 6, stiffness: 200 })
    );
    translateY.value = withSequence(
      withTiming(-6, { duration: 120 }),
      withSpring(0, { damping: 6, stiffness: 200 })
    );
  }, [count, isMine]);

  const animatedEmojiStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  return (
    <Animated.View entering={ZoomIn.springify().damping(12)}>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[
          styles.reactionBadge,
          {
            backgroundColor: isMine ? colors.primary + '30' : (isReceived ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.15)'),
            borderWidth: isMine ? 1 : 0,
            borderColor: colors.primary,
          }
        ]}
      >
        <Animated.Text style={[styles.reactionBadgeEmoji, animatedEmojiStyle]}>{emoji}</Animated.Text>
        {count > 1 && (
          <Text style={[styles.reactionBadgeCount, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.9)' }]}>
            {count}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}
