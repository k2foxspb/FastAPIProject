import React, { useMemo, useState, useEffect } from 'react';
import { getShadow } from '../utils/shadowStyles';
import { Pressable, StyleSheet, View, Image } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { cacheDirectory, getInfoAsync, downloadAsync } from 'expo-file-system/legacy';

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

export default function VideoNoteMessage({ item, isReceived, isParentVisible = true }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(true);

  const remoteUri = useMemo(() => {
    return resolveRemoteUri(item?.file_path || item?.video_url || item?.uri);
  }, [item?.file_path, item?.uri, item?.video_url]);

  useEffect(() => {
    if (!remoteUri) {
      setLoading(false);
      return;
    }

    const fileName = remoteUri.split('/').pop() || `vnote_${item.id}.mp4`;
    const localFileUri = `${cacheDirectory}${fileName}`;

    const loadMedia = async () => {
      try {
        if (remoteUri.startsWith('file://') || remoteUri.startsWith('content://')) {
          setLocalUri(remoteUri);
          setLoading(false);
          return;
        }

        const fileInfo = await getInfoAsync(localFileUri);
        if (fileInfo.exists) {
          setLocalUri(fileInfo.uri);
        } else {
          const downloadRes = await downloadAsync(remoteUri, localFileUri);
          setLocalUri(downloadRes.uri);
        }
      } catch (error) {
        console.error('Error loading video note:', error);
        setLocalUri(remoteUri);
      } finally {
        setLoading(false);
      }
    };

    loadMedia();
  }, [remoteUri]);

  if (!remoteUri) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: 'transparent',
        },
      ]}
    >
      <Pressable onPress={null} style={styles.videoWrapper}>
        <Image
          source={{ uri: localUri || remoteUri }}
          style={styles.video}
        />
        <View style={styles.playOverlay}>
          <View style={styles.playButtonCircle}>
            <MaterialIcons
              name="play-arrow"
              size={34}
              color="#fff"
            />
          </View>
        </View>
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
    marginVertical: 2,
  },
  videoWrapper: {
    width: '100%',
    height: '100%',
  },
  video: {
    width: '100%',
    height: '100%',
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: '#000',
  },
  playOverlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
});
