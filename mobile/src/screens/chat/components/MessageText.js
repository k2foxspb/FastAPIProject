import React from 'react';
import { Text } from 'react-native';
import { styles } from '../styles';

// Текст сообщения с подсветкой совпадений при активном поиске
export default function MessageText({ message, isReceived, searchQuery, isSearching, colors }) {
  if (!searchQuery || !isSearching || !message) {
    return (
      <Text style={[
        styles.messageText,
        isReceived ? { color: colors.text } : { color: '#fff' }
      ]}>
        {message}
      </Text>
    );
  }

  const parts = message.split(new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <Text style={[
      styles.messageText,
      isReceived ? { color: colors.text } : { color: '#fff' }
    ]}>
      {parts.map((part, i) => (
        part.toLowerCase() === searchQuery.toLowerCase() ? (
          <Text key={i} style={{ backgroundColor: 'rgba(255, 255, 0, 0.4)', fontWeight: 'bold' }}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      ))}
    </Text>
  );
}
