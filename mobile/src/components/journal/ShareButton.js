import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { PrimaryButton, useColors } from './common';

// Единая кнопка «поделиться»: открывает экран отправки сводки в личные сообщения.
// variant: 'primary' — широкая кнопка, 'action' — компактная плитка в ряду действий.
export const ShareButton = ({ navigation, text, label = 'Поделиться', icon = 'share-social-outline', variant = 'primary', style }) => {
  const colors = useColors();
  const onPress = () => navigation.navigate('ShareSummary', { text });

  if (variant === 'action') {
    return (
      <TouchableOpacity
        style={[styles.action, { borderColor: colors.border, backgroundColor: colors.card }, style]}
        onPress={onPress}
      >
        <Icon name={icon} size={20} color={colors.primary} />
        <Text style={{ color: colors.text, marginTop: 4, fontSize: 13 }}>{label}</Text>
      </TouchableOpacity>
    );
  }

  return <PrimaryButton title={label} onPress={onPress} style={style} />;
};

const styles = StyleSheet.create({
  action: { flex: 1, marginHorizontal: 3, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
});

export default ShareButton;
