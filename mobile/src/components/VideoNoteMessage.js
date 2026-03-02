import React, { useMemo, useState } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { API_BASE_URL } from '../constants';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import VideoPlayer from './VideoPlayer';

const resolveRemoteUri = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const base = API_BASE_URL.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
};

export default function VideoNoteMessage({ item, isReceived }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [isPlaying, setIsPlaying] = useState(false);

  const uri = useMemo(() => {
    return resolveRemoteUri(item?.file_path || item?.video_url || item?.uri);
  }, [item?.file_path, item?.uri, item?.video_url]);

  if (!uri) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isReceived ? colors.surface : colors.primary,
          borderColor: isReceived ? colors.border : 'rgba(255,255,255,0.2)',
        },
      ]}
    >
      <Pressable onPress={() => setIsPlaying((p) => !p)} style={styles.videoWrapper}>
        <VideoPlayer
          uri={uri}
          isMuted={!isPlaying}
          isLooping={true}
          shouldPlay={isPlaying}
          resizeMode="cover"
          style={styles.video}
        />

        {!isPlaying && (
          <View
            style={[
              styles.playOverlay,
              {
                backgroundColor: isReceived
                  ? colors.primary + '35'
                  : 'rgba(255,255,255,0.25)',
              },
            ]}
          >
            <MaterialIcons
              name="play-arrow"
              size={34}
              color={isReceived ? colors.primary : '#fff'}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

const SIZE = 170;

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
    borderWidth: 1,
    marginVertical: 2,
    ...getShadow('#000', { width: 0, height: 2 }, 0.15, 4, 3),
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
  },
  video: {
    width: '100%',
    height: '100%',
    borderRadius: SIZE / 2,
  },
  playOverlay: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -26 }, { translateY: -26 }],
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
