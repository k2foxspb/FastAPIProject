import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { styles } from '../styles';

// Анимированный бейдж реакции под сообщением: при первом появлении плавно проявляется (FadeIn),
// без дополнительных эффектов при изменении счётчика.
export default function ReactionBadge({ emoji, count, isMine, isReceived, colors, onPress, onLongPress }) {
  return (
    <Animated.View entering={FadeIn}>
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
        <Text style={styles.reactionBadgeEmoji}>{emoji}</Text>
        {count > 1 && (
          <Text style={[styles.reactionBadgeCount, { color: isReceived ? colors.textSecondary : 'rgba(255,255,255,0.9)' }]}>
            {count}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}
