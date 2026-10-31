import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { isAdminOrOwner, getRoleIcon, getRoleColor } from '../constants/roles';

// Значок роли (корона - владелец, щит - администратор) поверх аватарки.
// Располагается в правом ВЕРХНЕМ углу, чтобы не перекрываться с зелёным
// индикатором онлайн-статуса, который находится в правом нижнем углу.
export default function RoleBadge({ role, size = 24, borderColor = '#fff', style }) {
  if (!isAdminOrOwner(role)) return null;

  return (
    <View
      style={[
        styles.badge,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: getRoleColor(role),
          borderColor,
        },
        style,
      ]}
    >
      <MaterialCommunityIcons name={getRoleIcon(role)} size={Math.round(size * 0.6)} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    zIndex: 2,
  },
});
