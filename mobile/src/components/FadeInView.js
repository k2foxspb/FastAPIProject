import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

export default function FadeInView({
  children,
  style,
  visible = true,
  duration = 250,
  initialOpacity = 0,
  onShown,
}) {
  const opacity = useRef(new Animated.Value(visible ? 1 : initialOpacity)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: true,
      }).start(() => onShown && onShown());
    } else {
      opacity.setValue(initialOpacity);
    }
  }, [visible, duration, opacity, initialOpacity, onShown]);

  return (
    <Animated.View style={[styles.container, style, { opacity }]}> 
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 0,
  },
});
