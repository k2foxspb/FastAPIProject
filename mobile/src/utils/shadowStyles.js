import { Platform } from 'react-native';

/**
 * Helper to generate shadow styles compatible with iOS, Android and Web
 * @param {string} color - Shadow color (hex)
 * @param {object} offset - Shadow offset {width, height}
 * @param {number} opacity - Shadow opacity (0-1)
 * @param {number} radius - Shadow radius
 * @param {number} elevation - Android elevation
 */
export const getShadow = (color = '#000', offset = { width: 0, height: 2 }, opacity = 0.1, radius = 4, elevation = 4) => {
  if (Platform.OS === 'web') {
    let r = 0, g = 0, b = 0;
    if (color.startsWith('#')) {
      if (color.length === 4) {
        r = parseInt(color[1] + color[1], 16);
        g = parseInt(color[2] + color[2], 16);
        b = parseInt(color[3] + color[3], 16);
      } else if (color.length === 7) {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
      }
    }
    return {
      boxShadow: `${offset.width}px ${offset.height}px ${radius}px rgba(${r}, ${g}, ${b}, ${opacity})`,
    };
  }

  // Only return shadow* props for non-web platforms to avoid deprecation warnings
  const shadowStyle = {
    shadowColor: color,
    shadowOffset: offset,
    shadowOpacity: opacity,
    shadowRadius: radius,
  };

  if (Platform.OS === 'android') {
    return {
      elevation,
      ...shadowStyle,
    };
  }

  return shadowStyle;
};
