import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { formatFileSize } from '../../../utils/formatters';

// Плейсхолдер загружаемого видео с прогрессом и кнопкой отмены
export default function VideoUploadPlaceholder({ progressPercent, activeUploadId, uri, loaded, total, onCancel }) {
  const isFinished = progressPercent >= 100;
  const progressText = isFinished ? "Обработка..." : ((loaded !== undefined && total !== undefined && total > 0) 
    ? `${formatFileSize(loaded)} / ${formatFileSize(total)}` 
    : `${progressPercent}%`);
    
  return (
    <View style={{ width: 200, height: 150, borderRadius: 10, backgroundColor: '#1a1a1a', overflow: 'hidden' }}>
      {uri && (
        <Image 
          source={{ uri }} 
          style={StyleSheet.absoluteFill} 
          resizeMode="cover" 
        />
      )}
      <View style={{
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: uri ? 'rgba(0,0,0,0.2)' : 'transparent'
      }}>
        {!uri && <MaterialIcons name="videocam" size={40} color="rgba(255,255,255,0.3)" />}
      </View>
      <View style={{
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 10,
      }}>
        <View style={{
          backgroundColor: 'rgba(0,0,0,0.6)',
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 15,
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>{progressText}</Text>
        </View>
        <TouchableOpacity
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.3)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
          onPress={() => onCancel(activeUploadId)}
        >
          <MaterialIcons name="close" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}
