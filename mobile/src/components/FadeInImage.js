import React, { useRef, useState } from 'react';
import { Animated, ActivityIndicator, View, StyleSheet } from 'react-native';

export default function FadeInImage({
  source,
  style,
  resizeMode = 'cover',
  duration = 250,
  placeholderColor = '#e1e1e1',
  ...rest
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [loaded, setLoaded] = useState(false);

  const onLoad = () => {
    setLoaded(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[styles.root, style]}> 
      {!loaded && (
        <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: placeholderColor }]}>
          <ActivityIndicator color="#999" />
        </View>
      )}
      <Animated.Image
        {...rest}
        resizeMode={resizeMode}
        source={source}
        onLoad={onLoad}
        style={[StyleSheet.absoluteFill, style, { opacity }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  }
});
