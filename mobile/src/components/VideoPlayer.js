import React, { useEffect, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Pressable } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MaterialIcons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { setPlaybackAudioMode } from '../utils/audioSettings';

const VideoPlayer = ({ uri, isMuted = false, isLooping = false, shouldPlay = false, style, useNativeControls = false, resizeMode = 'cover' }) => {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = isLooping;
    p.muted = isMuted;
    if (shouldPlay) {
      p.play();
    }
  });

  const playingStatus = useEvent(player, 'playingChange');
  const isPlaying = playingStatus?.isPlaying ?? player.playing;
  
  const [showControls, setShowControls] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (shouldPlay && !isMuted) {
      setPlaybackAudioMode();
    }
    if (shouldPlay) {
      player.play();
    } else {
      player.pause();
    }
  }, [shouldPlay, isMuted, player]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    player.loop = isLooping;
  }, [isLooping, player]);

  useEffect(() => {
    let timer;
    if (showControls && isPlaying) {
      timer = setTimeout(() => setShowControls(false), 3000);
    }
    return () => clearTimeout(timer);
  }, [showControls, isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    setShowControls(true);
  };

  const cyclePlaybackRate = () => {
    const rates = [1, 1.25, 1.5, 2];
    const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    player.playbackRate = nextRate;
    setPlaybackRate(nextRate);
    setShowControls(true);
  };

  return (
    <Pressable 
      style={[styles.container, style]} 
      onPress={() => setShowControls(!showControls)}
    >
      <VideoView
        player={player}
        style={styles.video}
        contentFit={resizeMode === 'contain' ? 'contain' : (resizeMode === 'stretch' ? 'fill' : 'cover')}
        nativeControls={false}
      />
      
      {useNativeControls && showControls && (
        <View style={styles.controlsOverlay}>
          <TouchableOpacity style={styles.playButton} onPress={togglePlay}>
            <MaterialIcons 
              name={isPlaying ? "pause" : "play-arrow"} 
              size={50} 
              color="white" 
            />
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.speedButton} onPress={cyclePlaybackRate}>
            <Text style={styles.speedText}>{playbackRate}x</Text>
          </TouchableOpacity>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  speedButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  speedText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

export default VideoPlayer;
