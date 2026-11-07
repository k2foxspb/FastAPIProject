import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import LottieView from 'lottie-react-native';

const burstSource = require('../../../../assets/lottie/reaction_burst.json');

// Lottie-анимация "вспышки" над эмодзи: проигрывается один раз каждый раз, когда меняется trigger
// (нажатие на эмодзи или изменение счётчика реакции).
export default function ReactionBurst({ trigger, size = 56 }) {
  const ref = useRef(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    ref.current?.reset();
    ref.current?.play();
  }, [trigger]);

  return (
    <LottieView
      ref={ref}
      source={burstSource}
      autoPlay={false}
      loop={false}
      pointerEvents="none"
      style={[styles.burst, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }]}
    />
  );
}

const styles = StyleSheet.create({
  burst: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
});
