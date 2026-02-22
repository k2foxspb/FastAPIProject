import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Image, Modal, FlatList, TouchableWithoutFeedback } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { productsApi, usersApi } from '../api';
import { useTheme } from '../context/ThemeContext';
import { theme as themeConstants } from '../constants/theme';
import { getFullUrl } from '../utils/urlHelper';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useNotifications } from '../context/NotificationContext';

export default function EditProductScreen({ route, navigation }) {
  const { theme } = useTheme();
  const colors = themeConstants[theme];
  const { currentUser } = useNotifications();
  const product = route.params?.product;
  const isEditing = !!product;

  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [price, setPrice] = useState(product?.price?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() || '');
  const [categoryId, setCategoryId] = useState(product?.category_id || '');
  const [categories, setCategories] = useState([]);
  const [images, setImages] = useState([]); // Изменено на список
  const [loading, setLoading] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [user, setUser] = useState(null);
  const [newCategoryVisible, setNewCategoryVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);

  const selectedCategory = categories.find(cat => cat.id === categoryId);
  const isAdminOrOwner = user?.role === 'admin' || user?.role === 'owner';

  useEffect(() => {
    navigation.setOptions({
      title: isEditing ? 'Редактировать товар' : 'Добавить товар'
    });
    loadInitialData();
  }, [isEditing, navigation]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const promises = [
        productsApi.getCategories(),
      ];
      
      let userData = currentUser;
      const [categoriesRes] = await Promise.all(promises);
      
      if (!userData) {
        try {
          const uRes = await usersApi.getMe();
          userData = uRes.data;
        } catch (e) {}
      }
      
      setCategories(categoriesRes.data);
      if (userData) setUser(userData);

      if (!isEditing && categoriesRes.data.length > 0 && !categoryId) {
        setCategoryId(categoriesRes.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load initial data', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await productsApi.getCategories();
      setCategories(res.data);
    } catch (err) {
      console.error('Failed to load categories', err);
    }
  };

  const handleCreateCategory = async () => {
    if (newCategoryName.trim().length < 3) {
      Alert.alert('Ошибка', 'Название категории должно содержать минимум 3 символа');
      return;
    }

    setCreatingCategory(true);
    try {
      const res = await productsApi.createCategory({ name: newCategoryName.trim() });
      Alert.alert('Успех', `Категория "${res.data.name}" создана`);
      setNewCategoryName('');
      setNewCategoryVisible(false);
      await loadCategories();
      setCategoryId(res.data.id);
    } catch (err) {
      console.error(err);
      let errorMessage = 'Не удалось создать категорию';
      if (err.response?.status === 422) {
        errorMessage = 'Некорректные данные (минимум 3 символа)';
      } else if (err.response?.status === 403) {
        errorMessage = 'Недостаточно прав';
      }
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setCreatingCategory(false);
    }
  };

  const pickImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      setImages([...images, ...result.assets]);
    }
  };

  const removeImage = (index) => {
    const newImages = [...images];
    newImages.splice(index, 1);
    setImages(newImages);
  };

  const handleSave = async () => {
    if (!name || !price || !stock || !categoryId) {
      Alert.alert('Ошибка', 'Заполните обязательные поля');
      return;
    }

    if (name.length < 3) {
      Alert.alert('Ошибка', 'Название товара должно содержать минимум 3 символа');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      Alert.alert('Ошибка', 'Цена должна быть больше 0');
      return;
    }

    const stockNum = parseInt(stock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      Alert.alert('Ошибка', 'Количество на складе не может быть отрицательным');
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    formData.append('price', price);
    formData.append('stock', stock);
    formData.append('category_id', categoryId);

    if (images.length > 0) {
      images.forEach((img, index) => {
        const uri = img.uri;
        const uriParts = uri.split('.');
        const fileType = uriParts[uriParts.length - 1];
        const fileName = uri.split('/').pop();
        formData.append('images', {
          uri: uri,
          name: fileName || `photo_${index}.${fileType}`,
          type: `image/${fileType}`,
        });
      });
    }

    setLoading(true);
    try {
      if (isEditing) {
        await productsApi.updateProduct(product.id, formData);
        Alert.alert('Успех', 'Товар обновлен');
      } else {
        await productsApi.createProduct(formData);
        Alert.alert('Успех', 'Товар создан');
      }
      navigation.goBack();
    } catch (err) {
      console.error(err);
      let errorMessage = 'Не удалось сохранить товар';
      if (err.response?.status === 422) {
        const details = err.response.data?.detail;
        if (Array.isArray(details)) {
          errorMessage = details.map(d => {
            const field = d.loc[d.loc.length - 1];
            return `${field}: ${d.msg}`;
          }).join('\n');
        } else if (typeof details === 'string') {
          errorMessage = details;
        }
      }
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(
      'Удаление',
      'Вы уверены, что хотите удалить этот товар?',
      [
        { text: 'Отмена', style: 'cancel' },
        { 
          text: 'Удалить', 
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await productsApi.deleteProduct(product.id);
              navigation.goBack();
            } catch (err) {
              Alert.alert('Ошибка', 'Не удалось удалить товар');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.text }]}>Фотографии товара</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagesScroll}>
          {images.map((img, index) => (
            <View key={index} style={styles.imageWrapper}>
              <Image source={{ uri: img.uri }} style={styles.imageThumb} />
              <TouchableOpacity style={styles.removeImageBtn} onPress={() => removeImage(index)}>
                <Icon name="close-circle" size={24} color={colors.error} />
              </TouchableOpacity>
            </View>
          ))}
          {isEditing && product?.images?.map((img, index) => (
            <View key={`old-${index}`} style={styles.imageWrapper}>
              <Image source={{ uri: getFullUrl(img.thumbnail_url) }} style={styles.imageThumb} />
              <Text style={styles.oldImageLabel}>Уже загружено</Text>
            </View>
          ))}
          <TouchableOpacity style={[styles.addImageBtn, { borderColor: colors.border }]} onPress={pickImages}>
            <Icon name="add" size={40} color={colors.textSecondary} />
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Добавить</Text>
          </TouchableOpacity>
        </ScrollView>

        <Text style={[styles.label, { color: colors.text }]}>Название *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={name}
          onChangeText={setName}
          placeholder="Название товара"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>Категория *</Text>
        <TouchableOpacity 
          style={[styles.pickerButton, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setPickerVisible(true)}
        >
          <Text style={[styles.pickerButtonText, { color: selectedCategory ? colors.text : colors.textSecondary }]}>
            {selectedCategory ? selectedCategory.name : 'Выберите категорию'}
          </Text>
          <Icon name="chevron-down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>

        <Modal
          visible={pickerVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setPickerVisible(false)}
        >
          <TouchableWithoutFeedback onPress={() => setPickerVisible(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>Выберите категорию</Text>
                    <TouchableOpacity onPress={() => setPickerVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                  
                  {isAdminOrOwner && (
                    <TouchableOpacity 
                      style={[styles.addCategoryButton, { borderColor: colors.primary }]}
                      onPress={() => setNewCategoryVisible(true)}
                    >
                      <Icon name="add-circle-outline" size={20} color={colors.primary} />
                      <Text style={[styles.addCategoryButtonText, { color: colors.primary }]}>Создать новую категорию</Text>
                    </TouchableOpacity>
                  )}

                  <FlatList
                    data={categories}
                    keyExtractor={(item) => item.id.toString()}
                    renderItem={({ item }) => (
                      <TouchableOpacity 
                        style={[
                          styles.categoryItem, 
                          { borderBottomColor: colors.border },
                          item.id === categoryId && { backgroundColor: colors.primary + '20' }
                        ]}
                        onPress={() => {
                          setCategoryId(item.id);
                          setPickerVisible(false);
                        }}
                      >
                        <Text style={[
                          styles.categoryItemText, 
                          { color: colors.text },
                          item.id === categoryId && { color: colors.primary, fontWeight: 'bold' }
                        ]}>
                          {item.name}
                        </Text>
                        {item.id === categoryId && (
                          <Icon name="checkmark" size={20} color={colors.primary} />
                        )}
                      </TouchableOpacity>
                    )}
                  />
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        <Modal
          visible={newCategoryVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setNewCategoryVisible(false)}
        >
          <TouchableWithoutFeedback onPress={() => setNewCategoryVisible(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>Новая категория</Text>
                    <TouchableOpacity onPress={() => setNewCategoryVisible(false)}>
                      <Icon name="close" size={24} color={colors.text} />
                    </TouchableOpacity>
                  </View>
                  
                  <Text style={[styles.label, { color: colors.text }]}>Название категории *</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
                    value={newCategoryName}
                    onChangeText={setNewCategoryName}
                    placeholder="Минимум 3 символа"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />

                  <TouchableOpacity 
                    style={[styles.saveButton, { backgroundColor: colors.primary }]} 
                    onPress={handleCreateCategory}
                    disabled={creatingCategory}
                  >
                    {creatingCategory ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveButtonText}>Создать</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        <Text style={[styles.label, { color: colors.text }]}>Цена *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={price}
          onChangeText={setPrice}
          placeholder="Цена"
          keyboardType="numeric"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>В наличии (шт) *</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={stock}
          onChangeText={setStock}
          placeholder="Количество"
          keyboardType="numeric"
          placeholderTextColor={colors.textSecondary}
        />

        <Text style={[styles.label, { color: colors.text }]}>Описание</Text>
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Описание товара"
          placeholderTextColor={colors.textSecondary}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <TouchableOpacity 
          style={[styles.saveButton, { backgroundColor: colors.primary }]} 
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Сохранить</Text>}
        </TouchableOpacity>

        {isEditing && (
          <TouchableOpacity 
            style={[styles.deleteButton, { borderColor: colors.error }]} 
            onPress={handleDelete}
            disabled={loading}
          >
            <Text style={[styles.deleteButtonText, { color: colors.error }]}>Удалить</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: 20 },
  imageContainer: { alignItems: 'center', marginBottom: 20 },
  image: { width: 200, height: 200, borderRadius: 10 },
  imagePlaceholder: { width: 200, height: 200, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  imageThumb: { width: 100, height: 100, borderRadius: 8 },
  imagesScroll: { marginBottom: 20 },
  imageWrapper: { marginRight: 10, position: 'relative' },
  removeImageBtn: { position: 'absolute', top: -10, right: -10, backgroundColor: '#fff', borderRadius: 12 },
  addImageBtn: { width: 100, height: 100, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  oldImageLabel: { fontSize: 10, textAlign: 'center', marginTop: 2 },
  label: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 15, fontSize: 16 },
  pickerButton: { 
    borderWidth: 1, 
    borderRadius: 8, 
    padding: 12, 
    marginBottom: 15, 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  pickerButtonText: { fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 15,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  categoryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  categoryItemText: {
    fontSize: 16,
  },
  addCategoryButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 12, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderStyle: 'dashed', 
    marginBottom: 15, 
    justifyContent: 'center' 
  },
  addCategoryButtonText: { 
    marginLeft: 10, 
    fontSize: 16, 
    fontWeight: 'bold' 
  },
  textArea: { height: 100 },
  saveButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  deleteButton: { padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, borderWidth: 1 },
  deleteButtonText: { fontSize: 16, fontWeight: 'bold' },
});
