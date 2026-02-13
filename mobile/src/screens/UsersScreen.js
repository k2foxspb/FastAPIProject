import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { usersApi } from '../api';

export default function UsersScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    usersApi.getUsers(search).then(res => setUsers(res.data)).catch(err => console.log(err));
  }, [search]);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        placeholder="Поиск пользователей..."
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={users}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.userItem}
            onPress={() => navigation.navigate('Messages', { 
              screen: 'Chat', 
              params: { userId: item.id, userName: item.email } 
            })}
          >
            <Text style={styles.userName}>{item.email}</Text>
            <Text style={styles.userRole}>{item.role}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 10 },
  searchInput: { height: 40, borderLineWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, marginBottom: 10 },
  userItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee' },
  userName: { fontSize: 16, fontWeight: '500' },
  userRole: { fontSize: 12, color: 'gray' },
});
