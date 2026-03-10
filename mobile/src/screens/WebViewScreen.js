import React from 'react';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';

export default function WebViewScreen({ route, navigation }) {
  const { url, title } = route.params;
  const { theme } = useTheme();
  const colors = themeConstants[theme];

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: title || '' });
  }, [navigation, title]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <WebView 
        source={{ uri: url }} 
        style={{ flex: 1, backgroundColor: colors.background }}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={[styles.loading, { backgroundColor: colors.background }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    position: 'absolute',
    height: '100%',
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
