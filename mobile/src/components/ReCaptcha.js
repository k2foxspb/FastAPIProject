import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { WebView } from 'react-native-webview';

const RECAPTCHA_KEYS = {
  android: '6LeQ5oksAAAAAHzVvCQbMnOgGw85gdW7Uv5ijKWk',
  ios: '6LfuyoksAAAAABc7rd5Rp5N43BtOdisvkdJzH47d',
  default: '6LfQ5IksAAAAABlQKWZ2z3-u4O9X29Z3mlLmq4A4',
};

const siteKey = RECAPTCHA_KEYS[Platform.OS] || RECAPTCHA_KEYS.default;
const baseUrl = 'https://fokin.fun'; // Домен вашего сайта

const ReCaptcha = forwardRef(({ onVerify, action = 'LOGIN' }, ref) => {
  const webViewRef = useRef(null);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://www.google.com/recaptcha/enterprise.js?render=${siteKey}"></script>
        <style>
          body { display: none; }
        </style>
      </head>
      <body>
        <script>
          function executeRecaptcha() {
            grecaptcha.enterprise.ready(function() {
              grecaptcha.enterprise.execute('${siteKey}', { action: '${action}' })
                .then(function(token) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'token',
                    token: token
                  }));
                })
                .catch(function(error) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'error',
                    error: error.message
                  }));
                });
            });
          }
          // Вызываем сразу при загрузке, так как мы будем создавать WebView динамически
          // или по команде
        </script>
      </body>
    </html>
  `;

  useImperativeHandle(ref, () => ({
    refreshToken: () => {
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript('executeRecaptcha();');
      }
    }
  }));

  const onMessage = (event) => {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'token') {
      onVerify(data.token);
    } else if (data.type === 'error') {
      console.error('reCAPTCHA Error:', data.error);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html, baseUrl }}
        onMessage={onMessage}
        javaScriptEnabled={true}
        style={{ width: 0, height: 0, opacity: 0 }}
        containerStyle={{ width: 0, height: 0, overflow: 'hidden' }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: 0,
    height: 0,
  },
});

export default ReCaptcha;
