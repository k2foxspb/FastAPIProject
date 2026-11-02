import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

const INTRO_DURATION_MS = 7500;

export default function FoxlyIntro() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), INTRO_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Image
        source={require('../../assets/foxly.gif')}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  image: {
    width: '90%',
    aspectRatio: 480 / 270,
  },
});
