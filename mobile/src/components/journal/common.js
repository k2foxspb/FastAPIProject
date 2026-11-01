import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { theme as themeConstants } from '../../constants/theme';
import { useJournal } from '../../context/JournalContext';

export const useColors = () => {
  const { theme } = useTheme();
  return themeConstants[theme];
};

export const EmptyState = ({ icon = 'document-text-outline', title, subtitle, actionLabel, onAction }) => {
  const colors = useColors();
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={48} color={colors.textSecondary} />
      {!!title && <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>}
      {!!subtitle && <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
      {!!actionLabel && (
        <TouchableOpacity style={[styles.emptyButton, { backgroundColor: colors.primary }]} onPress={onAction}>
          <Text style={styles.emptyButtonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// Обёртка экранов журнала: загрузка БД, требуется вход, ошибка открытия.
export const JournalGate = ({ children, navigation }) => {
  const { status, error, retry } = useJournal();
  const colors = useColors();
  if (status === 'ready') return children;
  if (status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (status === 'auth') {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Войдите в аккаунт"
          subtitle="Журнал хранится на устройстве и синхронизируется с вашим аккаунтом"
          actionLabel="Войти"
          onAction={() => navigation?.navigate('Profile', { screen: 'Login' })}
        />
      </View>
    );
  }
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <EmptyState icon="alert-circle-outline" title={error || 'Ошибка'} actionLabel="Повторить" onAction={retry} />
    </View>
  );
};

// Индикатор синхронизации для заголовка экрана.
export const SyncBadge = ({ onPress }) => {
  const { syncState, syncNow } = useJournal();
  const colors = useColors();
  const { status, pending } = syncState;
  let icon = 'cloud-done-outline';
  let color = colors.textSecondary;
  if (status === 'syncing') {
    return <ActivityIndicator style={styles.badge} size="small" color={colors.primary} />;
  }
  if (status === 'offline') { icon = 'cloud-offline-outline'; color = colors.textSecondary; }
  if (status === 'error' || status === 'auth') { icon = 'warning-outline'; color = colors.error; }
  if (pending > 0 && status !== 'error') { icon = 'cloud-upload-outline'; color = colors.primary; }
  return (
    <TouchableOpacity style={styles.badge} onPress={onPress || syncNow} hitSlop={8}>
      <Icon name={icon} size={22} color={color} />
      {pending > 0 && (
        <View style={[styles.badgeDot, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeDotText}>{pending > 99 ? '99+' : pending}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// Метка «не синхронизировано» у конкретной записи
export const PendingMark = ({ visible }) => {
  const colors = useColors();
  if (!visible) return null;
  return <Icon name="cloud-upload-outline" size={14} color={colors.textSecondary} style={{ marginLeft: 6 }} />;
};

export const Section = ({ title, right, children, style }) => {
  const colors = useColors();
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {(!!title || right) && (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
          {right}
        </View>
      )}
      {children}
    </View>
  );
};

export const Field = ({ label, children }) => {
  const colors = useColors();
  return (
    <View style={styles.field}>
      {!!label && <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>}
      {children}
    </View>
  );
};

export const Input = React.forwardRef((props, ref) => {
  const colors = useColors();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.textSecondary}
      {...props}
      style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }, props.style]}
    />
  );
});

export const Chip = ({ label, selected, onPress, color, icon }) => {
  const colors = useColors();
  const active = color || colors.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, { borderColor: selected ? active : colors.border, backgroundColor: selected ? `${active}22` : 'transparent' }]}
    >
      {!!icon && <Icon name={icon} size={14} color={selected ? active : colors.textSecondary} style={{ marginRight: 4 }} />}
      <Text style={{ color: selected ? active : colors.text, fontSize: 14 }}>{label}</Text>
    </TouchableOpacity>
  );
};

export const PrimaryButton = ({ title, onPress, disabled, danger, style, loading }) => {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.button, { backgroundColor: danger ? colors.error : colors.primary, opacity: disabled ? 0.5 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </TouchableOpacity>
  );
};

export const HeaderButton = ({ icon, onPress, color }) => {
  const colors = useColors();
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} style={{ paddingHorizontal: 6 }}>
      <Icon name={icon} size={24} color={color || colors.text} />
    </TouchableOpacity>
  );
};

export const MOODS = [
  { value: 1, icon: 'sad-outline', label: 'Плохо', color: '#E53935' },
  { value: 2, icon: 'sad-outline', label: 'Так себе', color: '#FB8C00' },
  { value: 3, icon: 'remove-circle-outline', label: 'Нормально', color: '#FDD835' },
  { value: 4, icon: 'happy-outline', label: 'Хорошо', color: '#7CB342' },
  { value: 5, icon: 'happy-outline', label: 'Отлично', color: '#43A047' },
];

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, marginTop: 6, textAlign: 'center' },
  emptyButton: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyButtonText: { color: '#fff', fontWeight: '600' },
  badge: { paddingHorizontal: 8, justifyContent: 'center' },
  badgeDot: { position: 'absolute', top: -4, right: 0, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeDotText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  section: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginHorizontal: 12, marginTop: 12, paddingVertical: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  field: { marginHorizontal: 16, marginTop: 14 },
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginHorizontal: 16, marginTop: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
