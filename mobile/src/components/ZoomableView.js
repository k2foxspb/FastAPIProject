import React, { useEffect, useState } from 'react';
import { Dimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const MIN_GESTURE_SCALE = 0.8;

const ZoomableView = ({ children, style, isActive, onZoomChange }) => {
  const scale = useSharedValue(MIN_SCALE);
  const savedScale = useSharedValue(MIN_SCALE);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);

  const notifyZoom = (value) => {
    setZoomed(value);
    onZoomChange?.(value);
  };

  const resetTransform = () => {
    scale.value = withTiming(MIN_SCALE);
    savedScale.value = MIN_SCALE;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    notifyZoom(false);
  };

  useEffect(() => {
    if (!isActive) {
      resetTransform();
    }
  }, [isActive]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_GESTURE_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      const next = scale.value <= MIN_SCALE + 0.01 ? MIN_SCALE : Math.min(MAX_SCALE, scale.value);
      scale.value = withTiming(next);
      savedScale.value = next;
      if (next === MIN_SCALE) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
      runOnJS(notifyZoom)(next > MIN_SCALE);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      const maxX = (width * (scale.value - MIN_SCALE)) / 2;
      const maxY = (height * (scale.value - MIN_SCALE)) / 2;
      const x = savedTranslateX.value + e.translationX;
      const y = savedTranslateY.value + e.translationY;
      translateX.value = Math.min(maxX, Math.max(-maxX, x));
      translateY.value = Math.min(maxY, Math.max(-maxY, y));
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const gesture = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[style, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
};

export default ZoomableView;
