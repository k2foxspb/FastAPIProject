import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { isProductionRole, getRoleIcon } from '../constants/roles';

// Переиспользуемая аватарка со значком должности (для производственных ролей),
// чтобы не дублировать разметку бейджа на каждом экране со списком пользователей.
export default function AvatarWithBadge({ uri, role, size = 40, style, imageStyle }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const badgeSize = Math.max(14, Math.round(size * 0.42));
  const iconSize = Math.round(badgeSize * 0.55);

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={{ uri: uri || 'https://via.placeholder.com/150' }}
        style={[{ width: size, height: size, borderRadius: size / 2 }, imageStyle]}
      />
      {isProductionRole(role) && (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: colors.primary,
              borderColor: colors.background,
            },
          ]}
        >
          <Icon name={getRoleIcon(role)} size={iconSize} color="#fff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
  },
});
