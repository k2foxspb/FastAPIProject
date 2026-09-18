import { useState } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';

// Режим множественного выделения сообщений и их удаление
export default function useMessageSelection({
  messages,
  setMessages,
  setSkip,
  userId,
  currentUserId,
  deleteMessageWs,
  bulkDeleteMessagesWs,
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const toggleSelection = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) {
        const next = prev.filter(x => x !== id);
        if (next.length === 0) setSelectionMode(false);
        return next;
      } else {
        return [...prev, id];
      }
    });
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const handlePressMessage = (id) => {
    if (selectionMode) {
      toggleSelection(id);
    }
  };

  const handleLongPressMessage = (id) => {
    if (!selectionMode) {
      setSelectionMode(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    toggleSelection(id);
  };

  const handleDeleteMessage = (messageId) => {
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const isOwner = Number(message.sender_id) === Number(currentUserId);
    
    Alert.alert(
      'Удалить сообщение?',
      isOwner 
        ? 'Удалить это сообщение для всех участников?' 
        : 'Удалить это сообщение для себя? У собеседника оно останется.',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const sent = deleteMessageWs(messageId);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              // Локально обновляем список сообщений
              setMessages(prev => prev.filter(m => String(m.id) !== String(messageId)));
              setSkip(prev => Math.max(0, prev - 1));
            } catch (error) {
              console.error('Failed to delete message', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщение');
            }
          }
        }
      ]
    );
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    
    const ownCount = messages.filter(m => selectedIds.includes(m.id) && m.sender_id !== userId).length;
    const othersCount = selectedIds.length - ownCount;
    
    let message = `Удалить выбранные сообщения (${selectedIds.length})?`;
    if (ownCount > 0 && othersCount > 0) {
      message = `Удалить ${selectedIds.length} сообщений? Ваши сообщения (${ownCount}) удалятся у всех, а чужие (${othersCount}) — только у вас.`;
    } else if (ownCount > 0) {
      message = `Удалить ваши сообщения (${ownCount}) для всех участников?`;
    } else {
      message = `Удалить чужие сообщения (${othersCount}) для себя? У собеседника они останутся.`;
    }

    Alert.alert(
      'Удалить сообщения?',
      message,
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive', 
          onPress: async () => {
            try {
              const sent = bulkDeleteMessagesWs(selectedIds);
              if (!sent) {
                Alert.alert('Ошибка', 'Не удалось отправить запрос на удаление. Проверьте соединение.');
                return;
              }

              // Локально обновляем список сообщений, чтобы чат сразу отразил удаление
              const removedCount = selectedIds.length;
              const idsToDelete = selectedIds.map(id => String(id));
              setMessages(prev => prev.filter(m => !idsToDelete.includes(String(m.id))));
              setSkip(prev => Math.max(0, prev - removedCount));

              setSelectionMode(false);
              setSelectedIds([]);
            } catch (error) {
              console.error('Failed to bulk delete messages', error);
              Alert.alert('Ошибка', 'Не удалось удалить сообщения');
            }
          }
        }
      ]
    );
  };

  return {
    selectionMode,
    selectedIds,
    toggleSelection,
    clearSelection,
    handlePressMessage,
    handleLongPressMessage,
    handleDeleteMessage,
    handleBulkDelete,
  };
}
