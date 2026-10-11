import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function TabelScreen() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Icon name="document-text-outline" size={64} color={colors.border} />
      <Text style={[styles.title, { color: colors.text }]}>Табель</Text>
      <Text style={[styles.placeholder, { color: colors.textSecondary }]}>
        Раздел в разработке
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
  },
  placeholder: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
  },
});
