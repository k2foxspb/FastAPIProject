import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function ChatListScreen() {
  return (
    <View style={styles.center}>
      <Text>Здесь будет список ваших чатов.</Text>
      <Text style={styles.hint}>Используйте поиск пользователей, чтобы начать общение.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  hint: { color: 'gray', marginTop: 10, textAlign: 'center' }
});
