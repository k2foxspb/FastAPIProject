import React, { useCallback, useRef, useState } from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import { JournalGate, PrimaryButton, useColors } from '../../components/journal/common';
import { getFoodByBarcode } from '../../journal/db/repos/diet';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'];

const Content = ({ navigation, route }) => {
  const colors = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const lockRef = useRef(false);
  const date = route?.params?.date;
  const mealTypeUuid = route?.params?.mealTypeUuid;

  useFocusEffect(useCallback(() => {
    lockRef.current = false;
    setActive(true);
    return () => setActive(false);
  }, []));

  const onScanned = async ({ data }) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setActive(false);
    const code = String(data || '').trim();
    try {
      const found = await getFoodByBarcode(code);
      if (found) {
        navigation.replace('FoodEntryEdit', { date, mealTypeUuid, foodUuid: found.uuid });
        return;
      }
      Alert.alert(
        'Продукт не найден',
        `Штрихкод ${code} отсутствует в вашей базе. Создать продукт с этим штрихкодом?`,
        [
          { text: 'Отмена', style: 'cancel', onPress: () => navigation.goBack() },
          {
            text: 'Создать',
            onPress: () => navigation.replace('FoodEdit', { barcode: code }),
          },
        ],
      );
    } catch (e) {
      Alert.alert('Ошибка', e?.message || 'Не удалось найти продукт');
      lockRef.current = false;
      setActive(true);
    }
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background }}>
        <Text style={{ color: colors.text, textAlign: 'center', marginBottom: 16 }}>
          Для сканирования штрихкодов нужен доступ к камере
        </Text>
        <PrimaryButton
          title="Разрешить камеру"
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={active ? onScanned : undefined}
      />
      <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: '#fff', marginBottom: 12 }}>Наведите камеру на штрихкод</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Отмена</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default function BarcodeScanScreen({ navigation, route }) {
  return (
    <JournalGate navigation={navigation}>
      <Content navigation={navigation} route={route} />
    </JournalGate>
  );
}
