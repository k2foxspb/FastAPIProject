import React from 'react';
import { View, Image } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import RoleBadge from './RoleBadge';

// Переиспользуемая аватарка со значком роли (admin/owner),
// чтобы не дублировать разметку бейджа на каждом экране со списком пользователей.
// Значок роли находится в правом верхнем углу и не мешает индикатору онлайна.
export default function AvatarWithBadge({ uri, role, size = 40, style, imageStyle }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const badgeSize = Math.max(16, Math.round(size * 0.42));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={{ uri: uri || 'https://via.placeholder.com/150' }}
        style={[{ width: size, height: size, borderRadius: size / 2 }, imageStyle]}
      />
      <RoleBadge
        role={role}
        size={badgeSize}
        borderColor={colors.background}
        style={{ top: -2, right: -2, borderWidth: 1.5 }}
      />
    </View>
  );
}
