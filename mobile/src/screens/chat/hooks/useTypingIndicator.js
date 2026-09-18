import { useEffect, useMemo, useRef } from 'react';

// Отправка статуса "печатает..." собеседнику и вычисление, печатает ли он сам
export default function useTypingIndicator({ inputText, userId, sendTypingStatus, typingUsers }) {
  const typingTimerRef = useRef(null);
  const isCurrentlyTyping = useRef(false);

  useEffect(() => {
    if (inputText.length > 0) {
      if (!isCurrentlyTyping.current) {
        isCurrentlyTyping.current = true;
        sendTypingStatus(userId, true);
      }
      
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      
      typingTimerRef.current = setTimeout(() => {
        isCurrentlyTyping.current = false;
        sendTypingStatus(userId, false);
      }, 3000);
    } else if (isCurrentlyTyping.current) {
      isCurrentlyTyping.current = false;
      sendTypingStatus(userId, false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    }
    
    return () => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [inputText, userId, sendTypingStatus]);

  const isPartnerTyping = useMemo(() => {
    const timestamp = typingUsers[userId];
    if (!timestamp) return false;
    // Считаем, что печатает, если последнее событие было меньше 5 секунд назад
    return (Date.now() - timestamp) < 5000;
  }, [typingUsers, userId]);

  return isPartnerTyping;
}
