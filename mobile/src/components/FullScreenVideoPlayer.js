import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, PanResponder, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import VideoPlayer from './VideoPlayer';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const formatTime = (seconds) => {
  const totalSeconds = Math.floor(seconds || 0);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
};

// Видео с теми же кастомными контролами, что и в полноэкранном просмотре медиа в сообщениях:
// кнопка play/pause по центру, нижняя панель с таймлайном и переключателем скорости —
// всё скрывается/показывается по тапу на видео. Используется везде, где нужен единый
// вид плеера (профиль, админка), чтобы он не отличался от вида в чате.
export default function FullScreenVideoPlayer({
  uri,
  style,
  shouldPlay = false,
  isLooping = false,
  isMuted = false,
  resizeMode = 'contain',
  controlsEnabled = true,
  onPlayerReady,
}) {
  const [player, setPlayer] = useState(null);
  const [showControls, setShowControls] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sliderWidth, setSliderWidth] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekingPosition, setSeekingPosition] = useState(null);

  const sliderWidthRef = useRef(1);
  const durationRef = useRef(0);
  const positionRef = useRef(0);
  const seekingPosRef = useRef(null);
  const isSeekingRef = useRef(false);
  const subscriptionsRef = useRef([]);
  const playerRef = useRef(null);
  const seekToRatioRef = useRef(null);

  const cleanupSubscriptions = () => {
    try {
      (subscriptionsRef.current || []).forEach((sub) => {
        if (sub && typeof sub.remove === 'function') sub.remove();
      });
    } catch (e) {
      // no-op
    }
    subscriptionsRef.current = [];
  };

  const handlePlayerReady = (p) => {
    playerRef.current = p;
    setPlayer(p);
    if (typeof onPlayerReady === 'function') onPlayerReady(p);
  };

  useEffect(() => {
    if (!player) return undefined;

    cleanupSubscriptions();
    try {
      player.timeUpdateEventInterval = 0.25;
    } catch (e) {
      // no-op
    }

    positionRef.current = player.currentTime || 0;
    setPosition(player.currentTime || 0);
    durationRef.current = player.duration || 0;
    setDuration(player.duration || 0);
    setIsPlaying(!!player.playing);
    setPlaybackRate(player.playbackRate || 1);

    const subs = [];
    try {
      if (typeof player.addListener === 'function') {
        subs.push(
          player.addListener('timeUpdate', (payload) => {
            if (isSeekingRef.current) return;
            const ct = payload?.currentTime ?? player.currentTime;
            positionRef.current = ct || 0;
            setPosition(ct || 0);
          })
        );
        subs.push(
          player.addListener('sourceLoad', (payload) => {
            const dur = payload?.duration ?? player.duration;
            durationRef.current = dur || 0;
            setDuration(dur || 0);
          })
        );
        subs.push(
          player.addListener('playingChange', (payload) => {
            setIsPlaying(!!payload?.isPlaying);
          })
        );
        subs.push(
          player.addListener('playbackRateChange', (payload) => {
            setPlaybackRate(payload?.playbackRate ?? player.playbackRate);
          })
        );
      }
    } catch (e) {
      // no-op
    }
    subscriptionsRef.current = subs;

    return () => cleanupSubscriptions();
  }, [player]);

  const toggleControls = () => setShowControls((prev) => !prev);

  const handlePlayPause = () => {
    if (!player) return;
    try {
      if (player.playing) {
        player.pause();
        return;
      }

      const dur = player.duration || durationRef.current || 0;
      const pos = player.currentTime || positionRef.current || 0;
      if (dur > 0 && pos >= dur) {
        player.currentTime = 0;
      }
      setPlaybackAudioMode().finally(() => {
        try { player.play(); } catch (e) {}
      });
    } catch (e) {
      console.log('[FullScreenVideoPlayer] play/pause failed', e);
    }
  };

  const handleToggleRate = () => {
    if (!player) return;
    const nextRate = playbackRate === 1 ? 1.5 : (playbackRate === 1.5 ? 2 : 1);
    try {
      player.playbackRate = nextRate;
      setPlaybackRate(nextRate);
    } catch (e) {
      console.log('[FullScreenVideoPlayer] rate toggle failed', e);
    }
  };

  const seekToRatio = (ratio) => {
    const p = playerRef.current;
    if (!p) return;
    const dur = p.duration || durationRef.current || 0;
    if (!dur || dur <= 0) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const nextTime = clamped * dur;

    try {
      p.currentTime = nextTime;
    } catch (e) {
      try {
        p.seekBy(nextTime - (p.currentTime || 0));
      } catch (e2) {
        console.log('[FullScreenVideoPlayer] seek failed', e2);
      }
    }
    positionRef.current = nextTime;
    setPosition(nextTime);
  };
  seekToRatioRef.current = seekToRatio;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => {
        isSeekingRef.current = true;
        setIsSeeking(true);

        const p = playerRef.current;
        if (p) {
          try { p.pause(); } catch (e) {}
          setIsPlaying(false);
        }

        const x = evt?.nativeEvent?.locationX ?? 0;
        const w = sliderWidthRef.current;
        const ratio = w > 0 ? x / w : 0;
        const dur = durationRef.current || p?.duration || 0;
        const nextTime = Math.max(0, Math.min(dur, ratio * dur));
        seekingPosRef.current = nextTime;
        setSeekingPosition(nextTime);

        if (p) {
          try { p.currentTime = nextTime; } catch (e) {}
        }
      },
      onPanResponderMove: (evt) => {
        const x = evt?.nativeEvent?.locationX ?? 0;
        const w = sliderWidthRef.current;
        const ratio = w > 0 ? x / w : 0;
        const p = playerRef.current;
        const dur = durationRef.current || p?.duration || 0;
        const nextTime = Math.max(0, Math.min(dur, ratio * dur));
        seekingPosRef.current = nextTime;
        setSeekingPosition(nextTime);

        if (p) {
          try { p.currentTime = nextTime; } catch (e) {}
        }
      },
      onPanResponderRelease: () => {
        const p = playerRef.current;
        const dur = durationRef.current || p?.duration || 0;
        const nextTime = seekingPosRef.current ?? positionRef.current;
        if (dur > 0) {
          seekToRatioRef.current?.((nextTime || 0) / dur);
        }
        seekingPosRef.current = null;
        setIsSeeking(false);
        setSeekingPosition(null);
        setTimeout(() => { isSeekingRef.current = false; }, 600);
      },
      onPanResponderTerminate: () => {
        seekingPosRef.current = null;
        isSeekingRef.current = false;
        setIsSeeking(false);
        setSeekingPosition(null);
      },
    })
  ).current;

  const handleSliderLayout = (e) => {
    const w = e.nativeEvent.layout.width || 1;
    sliderWidthRef.current = w;
    setSliderWidth(w);
  };

  const displayedPosition = isSeeking ? (seekingPosition ?? position) : position;

  return (
    <View style={[styles.container, style]}>
      <VideoPlayer
        uri={uri}
        style={StyleSheet.absoluteFill}
        useNativeControls={false}
        isLooping={isLooping}
        isMuted={isMuted}
        shouldPlay={shouldPlay}
        resizeMode={resizeMode}
        onPlayerReady={handlePlayerReady}
      />

      {controlsEnabled && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={toggleControls}>
            {showControls && (
              <View style={styles.centerButtonContainer}>
                <TouchableOpacity style={styles.centerPlayButton} onPress={handlePlayPause}>
                  <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={50} color="white" />
                </TouchableOpacity>
              </View>
            )}
          </Pressable>

          {showControls && (
            <View style={styles.controlsBottom}>
              <View style={styles.rateButtonWrap}>
                <TouchableOpacity onPress={handleToggleRate} style={styles.rateButton}>
                  <Text style={styles.rateButtonText}>{playbackRate}x</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.timelineRow}>
                <Text style={styles.timeText}>
                  {formatTime(displayedPosition)}
                </Text>

                <View
                  style={styles.sliderContainer}
                  onLayout={handleSliderLayout}
                  {...panResponder.panHandlers}
                >
                  <View style={styles.sliderTrack} pointerEvents="none" />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.sliderFill,
                      {
                        width: `${
                          duration > 0
                            ? ((displayedPosition / duration) * 100).toFixed(2)
                            : 0
                        }%`,
                      },
                    ]}
                  />
                  <View
                    pointerEvents="none"
                    style={[
                      styles.sliderThumb,
                      {
                        left:
                          duration > 0
                            ? Math.max(
                                0,
                                Math.min(
                                  sliderWidth - 12,
                                  (displayedPosition / duration) * sliderWidth - 6
                                )
                              )
                            : 0,
                      },
                    ]}
                  />
                </View>

                <Text style={styles.timeText}>{formatTime(duration)}</Text>
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  centerButtonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerPlayButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlsBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 22,
    paddingTop: 20,
    zIndex: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  rateButtonWrap: {
    position: 'absolute',
    top: -50,
    right: 20,
  },
  rateButton: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  rateButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    color: '#fff',
    fontSize: 12,
    width: 48,
    textAlign: 'center',
  },
  sliderContainer: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
    marginHorizontal: 10,
  },
  sliderTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  sliderThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
});
