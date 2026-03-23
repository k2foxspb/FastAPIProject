import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const VideoPlayer = ({
  uri,
  isMuted = false,
  isLooping = false,
  shouldPlay = false,
  style,
  useNativeControls = false,
  resizeMode = 'cover',
  onPlayerReady,
}) => {
  const [playerStatus, setPlayerStatus] = useState('idle');
  const playerSourceRef = useRef(null);
  
  const player = useVideoPlayer(uri, (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    if (shouldPlay) {
      setPlaybackAudioMode().finally(() => {
        p.play();
      });
    }
  });

  useEffect(() => {
    if (uri && uri !== playerSourceRef.current) {
      playerSourceRef.current = uri;
      if (player.replaceAsync) {
        player.replaceAsync(uri)
          .then(() => {
            if (shouldPlay) {
              setPlaybackAudioMode().finally(() => player.play());
            }
          })
          .catch(err => console.log('[VideoPlayer] replaceAsync error:', err));
      } else {
        player.replace(uri);
        if (shouldPlay) {
          setPlaybackAudioMode().finally(() => player.play());
        }
      }
    }
  }, [uri, player, shouldPlay]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    player.loop = isLooping;
  }, [isLooping, player]);

  useEffect(() => {
    if (shouldPlay) {
      setPlaybackAudioMode().finally(() => player.play());
    } else {
      player.pause();
    }
  }, [shouldPlay, player]);

  const playerReadyCalledRef = useRef(null);

  useEffect(() => {
    if (typeof onPlayerReady === 'function' && playerReadyCalledRef.current !== player) {
      playerReadyCalledRef.current = player;
      onPlayerReady(player);
    }
  }, [onPlayerReady, player]);

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      setPlayerStatus(status);
      if (status === 'readyToPlay' && shouldPlay) {
        setPlaybackAudioMode().finally(() => player.play());
      }
    });
    return () => sub.remove();
  }, [player, shouldPlay]);

  return (
    <View style={[styles.container, style]}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit={resizeMode === 'contain' ? 'contain' : (resizeMode === 'stretch' ? 'fill' : 'cover')}
        nativeControls={useNativeControls}
      />
      {(playerStatus === 'loading' || playerStatus === 'idle') && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size={style?.height > 100 ? "large" : "small"} color="#fff" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
  },
});

export default VideoPlayer;
