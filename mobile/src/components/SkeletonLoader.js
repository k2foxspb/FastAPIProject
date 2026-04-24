import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getShadow } from '../utils/shadowStyles';

export function SkeletonItem({
  width = '100%',
  height = 16,
  borderRadius = 8,
  style,
}) {
  const { theme, isDark } = useTheme();
  const colors = themeConstants[theme];

  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [opacity]);

  const backgroundColor = useMemo(() => {
    // A slightly different base for dark theme helps avoid “too strong” blocks.
    return isDark ? colors.border : colors.border;
  }, [colors.border, isDark]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor,
          opacity,
        },
        style,
      ]}
    />
  );
}

export function NewsSkeleton() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  return (
    <View style={[styles.newsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.newsHeaderRow}>
        <SkeletonItem width={36} height={36} borderRadius={18} />
        <View style={styles.newsHeaderText}>
          <SkeletonItem width="55%" height={14} borderRadius={7} />
          <SkeletonItem width="35%" height={12} borderRadius={6} style={{ marginTop: 8 }} />
        </View>
      </View>

      <View style={{ padding: 12, paddingTop: 0 }}>
        <SkeletonItem width="100%" height={90} borderRadius={10} style={{ marginTop: 12 }} />
        <SkeletonItem width="85%" height={16} borderRadius={8} style={{ marginTop: 12 }} />
        <SkeletonItem width="65%" height={16} borderRadius={8} style={{ marginTop: 8 }} />

        <View style={styles.newsFooterRow}>
          <SkeletonItem width={90} height={12} borderRadius={6} />
          <View style={{ flexDirection: 'row' }}>
            <SkeletonItem width={34} height={12} borderRadius={6} style={{ marginLeft: 10 }} />
            <SkeletonItem width={34} height={12} borderRadius={6} style={{ marginLeft: 10 }} />
          </View>
        </View>
      </View>
    </View>
  );
}

export function ProductSkeleton() {
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  return (
    <View style={[styles.productCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SkeletonItem width="100%" height={150} borderRadius={10} />
      <View style={{ padding: 10 }}>
        <SkeletonItem width="85%" height={14} borderRadius={7} />
        <SkeletonItem width="60%" height={14} borderRadius={7} style={{ marginTop: 8 }} />
        <View style={styles.productFooterRow}>
          <SkeletonItem width={70} height={18} borderRadius={9} />
          <SkeletonItem width={34} height={34} borderRadius={17} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  newsCard: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    borderWidth: 1,
    ...getShadow('#000', { width: 0, height: 2 }, 0.1, 4, 4),
  },
  newsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  newsHeaderText: {
    flex: 1,
    marginLeft: 10,
  },
  newsFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  productCard: {
    flex: 0.5,
    margin: 5,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    ...getShadow('#000', { width: 0, height: 1 }, 0.1, 2, 2),
  },
  productFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
});
