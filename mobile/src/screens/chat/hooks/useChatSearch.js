import { useEffect, useRef, useState } from 'react';

// Глобальный поиск по сообщениям чата (через WS) и навигация по результатам/ответам
export default function useChatSearch({
  userId,
  messages,
  hasMore,
  loadingMore,
  loadMoreMessages,
  chatFlatListRef,
  onSearchResultsReceived,
  searchMessagesWs,
}) {
  const [globalSearchResults, setGlobalSearchResults] = useState([]); // [{id, message, ...}]
  const [currentGlobalSearchIdx, setCurrentGlobalSearchIdx] = useState(-1);
  const [isLoadingSearchResults, setIsLoadingSearchResults] = useState(false);
  const pendingScrollToId = useRef(null);
  const [replyHighlightId, setReplyHighlightId] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchTimeoutRef = useRef(null);

  const scrollToMessage = (index) => {
    if (index < 0 || index >= messages.length) return;
    
    // Ensure the index is within range for the current list
    const safeIndex = Math.min(index, messages.length - 1);
    
    // Use a small delay to ensure the list is ready
    setTimeout(() => {
      if (chatFlatListRef.current) {
        try {
          chatFlatListRef.current.scrollToIndex({
            index: safeIndex,
            animated: true,
            viewPosition: 0.5
          });
        } catch (e) {
          console.warn('scrollToIndex failed, falling back to scrollToOffset', e);
          // Fallback: estimate offset based on average item height (approx 100 in chat)
          // Since it is inverted, offset 0 is at the bottom (latest message)
          chatFlatListRef.current.scrollToOffset({
            offset: safeIndex * 100,
            animated: true
          });
        }
      }
    }, 100);
  };

  const scrollToMessageById = (messageId) => {
    // Check if we have this message loaded
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      setReplyHighlightId(messageId);
      scrollToMessage(index);
      setTimeout(() => setReplyHighlightId(null), 2000);
    } else {
      // Message not loaded yet, need to fetch more history
      console.log(`[ChatScreen] Message ${messageId} not in local list, requesting more history...`);
      pendingScrollToId.current = messageId;
      loadMoreMessages();
    }
  };

  useEffect(() => {
    const unsubscribe = onSearchResultsReceived((payload) => {
      if (Number(payload.other_user_id) === Number(userId)) {
        console.log('[ChatScreen] Global search results received:', payload.data?.length);
        setGlobalSearchResults(payload.data || []);
        setIsLoadingSearchResults(false);
        if (payload.data && payload.data.length > 0) {
          setCurrentGlobalSearchIdx(0);
          scrollToMessageById(payload.data[0].id);
        } else {
          setCurrentGlobalSearchIdx(-1);
        }
      }
    });
    return () => unsubscribe();
  }, [userId, onSearchResultsReceived]);

  useEffect(() => {
    if (pendingScrollToId.current) {
      const index = messages.findIndex(m => m.id === pendingScrollToId.current);
      if (index !== -1) {
        console.log(`[ChatScreen] Found pending message ${pendingScrollToId.current} at index ${index}`);
        const id = pendingScrollToId.current;
        pendingScrollToId.current = null;
        setReplyHighlightId(id);
        scrollToMessage(index);
        setTimeout(() => setReplyHighlightId(null), 2000);
      } else if (!hasMore && !loadingMore) {
        // We reached the end of history and still didn't find the message
        console.log(`[ChatScreen] Could not find message ${pendingScrollToId.current} in full history`);
        pendingScrollToId.current = null;
      } else if (!loadingMore) {
        // Keep loading more if we have more
        loadMoreMessages();
      }
    }
  }, [messages, loadingMore, hasMore]);

  const performSearch = (text) => {
    if (!text.trim()) {
      setGlobalSearchResults([]);
      setCurrentGlobalSearchIdx(-1);
      return;
    }

    setIsLoadingSearchResults(true);
    searchMessagesWs(userId, text.trim());
  };

  const handleSearch = (text) => {
    setSearchQuery(text);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(text);
    }, 400);
  };

  const prevSearchResult = () => {
    if (globalSearchResults.length === 0) return;
    const prevIdx = (currentGlobalSearchIdx - 1 + globalSearchResults.length) % globalSearchResults.length;
    setCurrentGlobalSearchIdx(prevIdx);
    scrollToMessageById(globalSearchResults[prevIdx].id);
  };

  const nextSearchResult = () => {
    if (globalSearchResults.length === 0) return;
    const nextIdx = (currentGlobalSearchIdx + 1) % globalSearchResults.length;
    setCurrentGlobalSearchIdx(nextIdx);
    scrollToMessageById(globalSearchResults[nextIdx].id);
  };

  const toggleSearch = () => {
    if (isSearching) {
      setIsSearching(false);
      setSearchQuery('');
      setGlobalSearchResults([]);
      setCurrentGlobalSearchIdx(-1);
      pendingScrollToId.current = null;
    } else {
      setIsSearching(true);
    }
  };

  return {
    searchQuery,
    isSearching,
    globalSearchResults,
    currentGlobalSearchIdx,
    isLoadingSearchResults,
    replyHighlightId,
    handleSearch,
    prevSearchResult,
    nextSearchResult,
    toggleSearch,
    scrollToMessageById,
  };
}
