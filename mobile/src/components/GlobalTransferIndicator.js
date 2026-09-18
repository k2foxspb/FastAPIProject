import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { uploadManager } from '../utils/uploadManager';
import { subscribeGlobal as subscribeGlobalDownloads } from '../utils/downloadManager';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { formatFileSize } from '../utils/formatters';

// Глобальная "шторка" с индикатором загрузки/выгрузки медиафайлов.
// Отображается поверх любого экрана приложения, пока идет передача файла,
// даже если пользователь уже вышел из чата (загрузка продолжается в фоне).
export default function GlobalTransferIndicator() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [uploads, setUploads] = useState([]);
  const [downloads, setDownloads] = useState([]);

  useEffect(() => {
    const unsubscribeUploads = uploadManager.subscribeGlobal((list) => {
      setUploads(list);
    });
    const unsubscribeDownloads = subscribeGlobalDownloads((list) => {
      setDownloads(list);
    });

    return () => {
      unsubscribeUploads();
      unsubscribeDownloads();
    };
  }, []);

  const items = [...uploads, ...downloads];

  if (items.length === 0) return null;

  // Показываем самую свежую активную передачу, но упоминаем, если их несколько
  const active = items[items.length - 1];
  const isUpload = active.direction === 'upload';
  const progressPercent = Math.round((active.progress || 0) * 100);
  const hasSize = active.total > 0;

  return (
    <View pointerEvents="box-none" style={styles.overlayContainer}>
      <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <MaterialIcons
          name={isUpload ? 'cloud-upload' : 'cloud-download'}
          size={18}
          color={colors.primary}
        />
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {isUpload ? 'Отправка файла' : 'Загрузка файла'}
            {items.length > 1 ? ` (+${items.length - 1})` : ''}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {hasSize
              ? `${formatFileSize(active.loaded || 0)} / ${formatFileSize(active.total)} · ${progressPercent}%`
              : `${progressPercent}%`}
          </Text>
        </View>
        <View style={styles.progressBarBackground}>
          <View style={[styles.progressBar, { width: `${progressPercent}%`, backgroundColor: colors.primary }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 44,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  banner: {
    marginTop: 6,
    width: '92%',
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  textContainer: {
    flex: 1,
    marginLeft: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  progressBarBackground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'transparent',
  },
  progressBar: {
    height: 2,
  },
});
