import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { chatApi } from '../api';
import Constants from 'expo-constants';

export default function ChatScreen({ route }) {
  const { userId, userName } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const ws = useRef(null);
  const token = 'YOUR_JWT_TOKEN'; // В реальном приложении брать из хранилища

  useEffect(() => {
    // Загрузка истории
    chatApi.getHistory(userId, token).then(res => setMessages(res.data));

    // WebSocket соединение
    const wsUrl = `ws://${Constants.expoConfig.extra.apiUrl.replace('http://', '')}/chat/ws/${token}`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onmessage = (e) => {
      const message = JSON.parse(e.data);
      if (message.sender_id === userId || message.receiver_id === userId) {
        setMessages(prev => [...prev, message]);
      }
    };

    return () => ws.current.close();
  }, [userId]);

  const sendMessage = () => {
    if (inputText.trim()) {
      const msgData = {
        receiver_id: userId,
        message: inputText,
        message_type: 'text'
      };
      ws.current.send(JSON.stringify(msgData));
      setInputText('');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        keyExtractor={(item) => (item.id || Math.random()).toString()}
        renderItem={({ item }) => (
          <View style={[
            styles.messageBubble, 
            item.sender_id === userId ? styles.received : styles.sent
          ]}>
            <Text style={styles.messageText}>{item.message}</Text>
          </View>
        )}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Сообщение..."
        />
        <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
          <Text style={styles.sendButtonText}>Отправить</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  messageBubble: { padding: 10, borderRadius: 10, margin: 5, maxWidth: '80%' },
  sent: { alignSelf: 'flex-end', backgroundColor: '#007AFF' },
  received: { alignSelf: 'flex-start', backgroundColor: '#E5E5EA' },
  messageText: { color: '#fff' },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff' },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 15, height: 40 },
  sendButton: { justifyContent: 'center', marginLeft: 10 },
  sendButtonText: { color: '#007AFF', fontWeight: 'bold' },
});
