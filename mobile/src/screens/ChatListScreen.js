import React, { useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image } from 'react-native';
import { useNotifications } from '../context/NotificationContext';
import { useFocusEffect } from '@react-navigation/native';

export default function ChatListScreen({ navigation }) {
  const { dialogs, fetchDialogs } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      fetchDialogs();
    }, [])
  );

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.dialogItem}
      onPress={() => navigation.navigate('Chat', { userId: item.user_id, userName: item.email })}
    >
      <Image 
        source={{ uri: item.avatar_url || 'https://via.placeholder.com/50' }} 
        style={styles.avatar} 
      />
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.email} numberOfLines={1}>{item.email}</Text>
          <Text style={styles.time}>
            {new Date(item.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        <View style={styles.footer}>
          <Text style={styles.lastMessage} numberOfLines={1}>{item.last_message}</Text>
          {item.unread_count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unread_count}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  if (dialogs.length === 0) {
    return (
      <View style={styles.center}>
        <Text>У вас пока нет активных чатов.</Text>
        <Text style={styles.hint}>Используйте поиск пользователей, чтобы начать общение.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={dialogs}
        keyExtractor={(item) => item.user_id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  list: { paddingVertical: 10 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  hint: { color: 'gray', marginTop: 10, textAlign: 'center' },
  dialogItem: { 
    flexDirection: 'row', 
    padding: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: '#f0f0f0',
    alignItems: 'center' 
  },
  avatar: { width: 50, height: 50, borderRadius: 25, marginRight: 15 },
  content: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  email: { fontWeight: 'bold', fontSize: 16, flex: 1, marginRight: 10 },
  time: { color: 'gray', fontSize: 12 },
  lastMessage: { color: 'gray', flex: 1, marginRight: 10 },
  badge: { 
    backgroundColor: '#007AFF', 
    borderRadius: 10, 
    minWidth: 20, 
    height: 20, 
    justifyContent: 'center', 
    alignItems: 'center',
    paddingHorizontal: 5
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' }
});
