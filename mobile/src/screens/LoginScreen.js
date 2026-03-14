import React, {useState, useEffect, useRef} from 'react';
import {getShadow} from '../utils/shadowStyles';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    Animated,
    Dimensions,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    Image
} from 'react-native';
import {
    getApp,
    getApps,
    getAuth,
    initializeApp,
    signInWithPhoneNumber,
    isSignInWithEmailLink,
    signInWithEmailLink,
    sendSignInLinkToEmail
} from '@react-native-firebase/auth';
import * as Linking from 'expo-linking';
import {usersApi, setAuthToken} from '../api';
import {API_BASE_URL} from '../constants';
import {useNotifications} from '../context/NotificationContext';
import {updateServerFcmToken} from '../utils/notifications';
import {storage} from '../utils/storage';
import {useTheme} from '../context/ThemeContext';
import {theme as themeConstants} from '../constants/theme';
import {Ionicons} from '@expo/vector-icons';
import ReCaptcha from '../components/ReCaptcha';

const {width} = Dimensions.get('window');

export default function LoginScreen({navigation}) {
    const {theme} = useTheme();
    const colors = themeConstants[theme];
    const [loading, setLoading] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [loginMethod, setLoginMethod] = useState('phone'); // 'phone' or 'email'
    const [code, setCode] = useState('');
    const [confirm, setConfirm] = useState(null);
    const {connect, loadUser} = useNotifications();
    const recaptchaRef = useRef(null);
    const pendingAuthUser = useRef(null);
    const lastHandledLink = useRef(null);
    const recaptchaTimeout = useRef(null);

    // Animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(30)).current;
    const logoScale = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            }),
            Animated.spring(logoScale, {
                toValue: 1,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            })
        ]).start();

        // Обработка входящей ссылки для входа по email
        const handleInitialLink = async () => {
            const initialUrl = await Linking.getInitialURL();
            console.log('[LoginScreen] Initial URL:', initialUrl);
            if (initialUrl) {
                // Добавляем небольшую задержку, чтобы Firebase успел инициализироваться
                setTimeout(() => handleSignInLink(initialUrl), 1000);
            }
        };

        handleInitialLink();

        const subscription = Linking.addEventListener('url', ({url}) => {
            console.log('[LoginScreen] Incoming URL:', url);
            handleSignInLink(url);
        });

        return () => subscription.remove();
    }, []);

    const handleAfterLogin = async (user, recaptchaToken = null) => {
        console.log('handleAfterLogin called for user:', user?.uid, 'with recaptchaToken:', recaptchaToken ? 'PRESENT' : 'MISSING');
        if (user) {
            // Если мы входим по email-ссылке, Firebase уже подтвердил нас.
            // Пропускаем принудительную reCAPTCHA, чтобы избежать зависания.
            const isEmailLinkLogin = !confirm; // confirm есть только при входе по телефону
            
            if (!recaptchaToken && recaptchaRef.current && !isEmailLinkLogin) {
                console.log('Starting reCAPTCHA verification before backend auth...');
                pendingAuthUser.current = user;
                
                // Устанавливаем таймаут: если reCAPTCHA не ответит за 10 секунд, 
                // продолжаем без нее (бэкенд сам решит, принимать ли запрос)
                if (recaptchaTimeout.current) clearTimeout(recaptchaTimeout.current);
                recaptchaTimeout.current = setTimeout(() => {
                    if (pendingAuthUser.current === user) {
                        console.log('reCAPTCHA timeout reached, proceeding without token...');
                        handleAfterLogin(user, 'timeout_token');
                    }
                }, 10000);

                recaptchaRef.current.refreshToken();
                return;
            }

            // Очищаем таймаут при получении токена
            if (recaptchaTimeout.current) {
                clearTimeout(recaptchaTimeout.current);
                recaptchaTimeout.current = null;
            }

            setLoading(true);
            try {
                console.log('Getting Firebase ID Token...');
                const idToken = await user.getIdToken(true);
                console.log('ID Token acquired, sending to backend...');
                const fcmToken = await storage.getItem('fcm_token');
                
                const res = await usersApi.firebaseAuth(idToken, fcmToken, recaptchaToken);
                console.log('Backend response received:', res.data ? 'SUCCESS' : 'NO DATA');

                const {access_token, refresh_token, needs_phone, needs_email} = res.data;

                if (!access_token) {
                    throw new Error('Токен не получен от сервера');
                }

                console.log('Saving tokens to storage...');
                await storage.saveTokens(access_token, refresh_token);
                setAuthToken(access_token);

                console.log('Loading user data and connecting to notification socket...');
                await loadUser();
                connect(access_token);

                if (needs_phone || needs_email) {
                    console.log('User needs to complete profile (phone/email)');
                    // Получаем свежего юзера для перехода в EditProfile
                    const userRes = await usersApi.getMe();
                    const userData = userRes.data;

                    Alert.alert(
                        'Завершение профиля',
                        'Пожалуйста, укажите ваш ' + (needs_phone ? 'номер телефона' : 'email') + ' для продолжения.',
                        [{
                            text: 'ОК',
                            onPress: () => navigation.replace('EditProfile', {user: userData, isInitialSetup: true})
                        }],
                        {cancelable: false}
                    );
                } else {
                    console.log('Login complete, navigating to ProfileMain');
                    navigation.reset({
                        index: 0,
                        routes: [{ name: 'ProfileMain' }],
                    });
                }
            } catch (error) {
                console.error('Firebase Auth Error (Backend Sync):', error);
                const detail = error.response?.data?.detail;
                const message = typeof detail === 'string' ? detail : (error.message || 'Ошибка авторизации');
                Alert.alert('Ошибка сервера', message);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleSignInWithPhoneNumber = async () => {
        if (!phoneNumber || phoneNumber.length < 10) {
            Alert.alert('Ошибка', 'Пожалуйста, введите корректный номер телефона');
            return;
        }

        try {
            setLoading(true);
            // Форматируем номер телефона (должен быть в формате +79991234567)
            let formattedPhone = phoneNumber;
            if (!formattedPhone.startsWith('+')) {
                if (formattedPhone.startsWith('8')) {
                    formattedPhone = '+7' + formattedPhone.substring(1);
                } else if (formattedPhone.startsWith('7')) {
                    formattedPhone = '+' + formattedPhone;
                } else {
                    formattedPhone = '+7' + formattedPhone;
                }
            }

            console.log('Attempting custom backend phone auth for:', formattedPhone);
            await usersApi.requestPhoneCode(formattedPhone);
            setConfirm({ phone: formattedPhone }); // Имитируем объект confirmation
            console.log('Code requested successfully via backend');
            
            Alert.alert(
                'Код подтверждения', 
                'Вам поступит звонок. Введите последние 4 цифры номера этого звонка.'
            );
        } catch (error) {
            console.error('Phone Auth Error:', error);
            const detail = error.response?.data?.detail;
            const message = typeof detail === 'string' ? detail : (error.message || 'Не удалось отправить код');
            Alert.alert('Ошибка', message);
        } finally {
            setLoading(false);
        }
    };

    const confirmCode = async () => {
        if (!code || code.length < 4) {
            Alert.alert('Ошибка', 'Введите код подтверждения (4 или 6 цифр)');
            return;
        }

        try {
            setLoading(true);
            const res = await usersApi.verifyPhoneCode(confirm.phone, code);
            console.log('Verification success, handling login...');
            
            const {access_token, refresh_token, needs_phone, needs_email} = res.data;
            
            await storage.saveTokens(access_token, refresh_token);
            setAuthToken(access_token);
            await loadUser();
            connect(access_token);

            if (needs_email) {
                const userRes = await usersApi.getMe();
                navigation.replace('EditProfile', {user: userRes.data, isInitialSetup: true});
            } else {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'ProfileMain' }],
                });
            }
        } catch (error) {
            console.error('Confirm Code Error:', error);
            const detail = error.response?.data?.detail;
            const message = typeof detail === 'string' ? detail : (error.message || 'Неверный код подтверждения');
            Alert.alert('Ошибка', message);
        } finally {
            setLoading(false);
        }
    };

    const handleSendSignInLinkToEmail = async () => {
        const trimmedEmail = email.trim();
        if (!trimmedEmail || !trimmedEmail.includes('@')) {
            Alert.alert('Ошибка', 'Пожалуйста, введите корректный адрес электронной почты');
            return;
        }

        try {
            setLoading(true);
            console.log('Saving email for sign in:', trimmedEmail);
            await storage.saveItem('email_for_sign_in', trimmedEmail);

            const actionCodeSettings = {
                url: `https://fokin.fun/verify-email?email=${encodeURIComponent(trimmedEmail)}&ts=${Date.now()}`,
                handleCodeInApp: true,
                android: {
                    packageName: 'com.k2foxspb.fokinfun',
                    installApp: true,
                },
                ios: {
                    bundleId: 'com.k2foxspb.fokinfun',
                },
                iOS: {
                    bundleId: 'com.k2foxspb.fokinfun',
                },
            };

            const authInstance = getAuth();
            console.log('Sending signInLink with URL:', actionCodeSettings.url);
            await sendSignInLinkToEmail(authInstance, trimmedEmail, actionCodeSettings);
            console.log('Sign in link sent successfully to:', trimmedEmail);
            Alert.alert('Ссылка отправлена', 'Проверьте свою почту для завершения входа');
        } catch (error) {
            console.error('Email Link Send Error:', error);
            Alert.alert('Ошибка', error.message || 'Не удалось отправить ссылку на почту');
        } finally {
            setLoading(false);
        }
    };

    const handleSignInLink = async (link) => {
        console.log('Attempting to handle link:', link);
        if (!link) return;
        
        // Предотвращаем повторную обработку одной и той же ссылки
        if (lastHandledLink.current === link) {
            console.log('Link already handled recently, skipping duplicate call');
            return;
        }
        lastHandledLink.current = link;

        try {
            const authInstance = getAuth();
            if (isSignInWithEmailLink(authInstance, link)) {
                console.log('Link IS a sign-in email link');
                setLoading(true);
                
                let storedEmail = await storage.getItem('email_for_sign_in');
                console.log('Email from storage:', storedEmail);
                
                // Если в хранилище пусто, пробуем достать из URL любым способом
                if (!storedEmail) {
                    try {
                        console.log('Storage is empty, parsing email from link...');
                        // 1. Пытаемся декодировать URL несколько раз (Firebase часто вкладывает один URL в другой)
                        let currentLink = link;
                        for (let i = 0; i < 3; i++) {
                            currentLink = decodeURIComponent(currentLink);
                            console.log(`Decoding level ${i + 1}:`, currentLink);
                            
                            // Пробуем найти регуляркой email=...
                            const emailMatch = currentLink.match(/email=([^&?]+)/);
                            if (emailMatch && emailMatch[1]) {
                                storedEmail = decodeURIComponent(emailMatch[1]);
                                console.log('Email found by regex at level', i + 1, ':', storedEmail);
                                break;
                            }
                        }
                    } catch (e) {
                        console.log('Failed to parse email from URL:', e);
                    }
                }
                
                console.log('Final email to use:', storedEmail);

                if (!storedEmail) {
                    console.log('No stored email found, asking user to enter it');
                    setLoginMethod('email');
                    Alert.alert(
                        'Подтвердите email',
                        'Пожалуйста, введите ваш адрес электронной почты в поле ввода для завершения входа.'
                    );
                    setLoading(false);
                    return;
                }

                console.log('Calling signInWithEmailLink with email:', storedEmail);
                const result = await signInWithEmailLink(authInstance, storedEmail, link);
                console.log('Sign in with email link SUCCESS:', result.user.uid);
                await handleAfterLogin(result.user);
                await storage.removeItem('email_for_sign_in');
            } else {
                console.log('Link is NOT a sign-in email link according to SDK');
            }
        } catch (error) {
            console.error('Email Link Auth Error details:', error);
            console.log('Error code:', error.code);
            console.log('Error message:', error.message);
            
            if (error.code === 'auth/invalid-action-code') {
                 Alert.alert(
                    'Ссылка недействительна', 
                    'Этот код уже был использован или истек. Пожалуйста, запросите новую ссылку из приложения.'
                 );
            } else {
                 Alert.alert('Ошибка входа по ссылке', error.message || 'Не удалось завершить вход');
            }
        } finally {
            setLoading(false);
        }
    };

    const onPrivacyPolicy = () => {
        navigation.navigate('WebView', {
            url: `${API_BASE_URL}/privacy-policy`,
            title: 'Политика конфиденциальности'
        });
    };

    const onTermsOfUse = () => {
        navigation.navigate('WebView', {
            url: `${API_BASE_URL}/terms`,
            title: 'Правила использования'
        });
    };

    const handleRecaptchaVerify = (token) => {
        if (pendingAuthUser.current) {
            handleAfterLogin(pendingAuthUser.current, token);
            pendingAuthUser.current = null;
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, {backgroundColor: colors.background}]}
        >
            <ReCaptcha ref={recaptchaRef} onVerify={handleRecaptchaVerify}/>
            <Animated.View
                style={[
                    styles.inner,
                    {
                        opacity: fadeAnim,
                        transform: [{translateY: slideAnim}]
                    }
                ]}
            >
                <Animated.View style={{transform: [{scale: logoScale}], alignSelf: 'center', marginBottom: 16}}>
                    <View style={styles.logoContainer}>
                        <Image
                            source={require('../../assets/logo120.png')}
                            style={{width: 100, height: 100}}
                            resizeMode="contain"
                        />
                    </View>
                </Animated.View>

                <Text style={[styles.title, {color: colors.text}]}>FokinShop</Text>
                <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
                    {loginMethod === 'phone' ? 'Вход по номеру телефона' : 'Вход по адресу почты'}
                </Text>

                {loginMethod === 'phone' ? (
                    !confirm ? (
                        <>
                            <View style={[styles.inputContainer, {
                                backgroundColor: colors.surface,
                                borderColor: colors.border
                            }]}>
                                <Ionicons name="call-outline" size={20} color={colors.textSecondary}
                                          style={{marginRight: 12}}/>
                                <TextInput
                                    style={[styles.input, {color: colors.text}]}
                                    placeholder="Номер телефона (+7...)"
                                    placeholderTextColor={colors.textSecondary + '80'}
                                    keyboardType="phone-pad"
                                    value={phoneNumber}
                                    onChangeText={setPhoneNumber}
                                    disabled={loading}
                                />
                            </View>

                            <TouchableOpacity
                                style={[
                                    styles.primaryButton,
                                    {backgroundColor: colors.primary},
                                    loading && styles.buttonDisabled
                                ]}
                                onPress={handleSignInWithPhoneNumber}
                                disabled={loading}
                                activeOpacity={0.8}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff"/>
                                ) : (
                                    <Text style={styles.primaryButtonText}>Получить код</Text>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={() => setLoginMethod('email')}
                                style={{marginTop: 16, alignItems: 'center'}}
                            >
                                <Text style={{color: colors.primary}}>Использовать почту</Text>
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            <View style={[styles.inputContainer, {
                                backgroundColor: colors.surface,
                                borderColor: colors.border
                            }]}>
                                <Ionicons name="keypad-outline" size={20} color={colors.textSecondary}
                                          style={{marginRight: 12}}/>
                                <TextInput
                                    style={[styles.input, {color: colors.text}]}
                                    placeholder="Код подтверждения"
                                    placeholderTextColor={colors.textSecondary + '80'}
                                    keyboardType="number-pad"
                                    value={code}
                                    onChangeText={setCode}
                                    maxLength={6}
                                    disabled={loading}
                                />
                            </View>

                            <TouchableOpacity
                                style={[
                                    styles.primaryButton,
                                    {backgroundColor: colors.primary},
                                    loading && styles.buttonDisabled
                                ]}
                                onPress={confirmCode}
                                disabled={loading}
                                activeOpacity={0.8}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff"/>
                                ) : (
                                    <Text style={styles.primaryButtonText}>Войти</Text>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={() => setConfirm(null)}
                                style={{marginTop: 16, alignItems: 'center'}}
                            >
                                <Text style={{color: colors.primary}}>Изменить номер</Text>
                            </TouchableOpacity>
                        </>
                    )
                ) : (
                    <>
                        <View style={[styles.inputContainer, {
                            backgroundColor: colors.surface,
                            borderColor: colors.border
                        }]}>
                            <Ionicons name="mail-outline" size={20} color={colors.textSecondary}
                                      style={{marginRight: 12}}/>
                            <TextInput
                                style={[styles.input, {color: colors.text}]}
                                placeholder="Ваша почта (email@domain.com)"
                                placeholderTextColor={colors.textSecondary + '80'}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                value={email}
                                onChangeText={setEmail}
                                disabled={loading}
                            />
                        </View>

                        <TouchableOpacity
                            style={[
                                styles.primaryButton,
                                {backgroundColor: colors.primary},
                                loading && styles.buttonDisabled
                            ]}
                            onPress={handleSendSignInLinkToEmail}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff"/>
                            ) : (
                                <Text style={styles.primaryButtonText}>Отправить ссылку</Text>
                            )}
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => setLoginMethod('phone')}
                            style={{marginTop: 16, alignItems: 'center'}}
                        >
                            <Text style={{color: colors.primary}}>Использовать телефон</Text>
                        </TouchableOpacity>
                    </>
                )}

                <View style={styles.features}>
                    <View style={styles.featureItem}>
                        <Ionicons name="flash-outline" size={20} color={colors.primary}/>
                        <Text style={[styles.featureText, {color: colors.textSecondary}]}>Быстрый вход</Text>
                    </View>
                    <View style={styles.featureItem}>
                        <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary}/>
                        <Text style={[styles.featureText, {color: colors.textSecondary}]}>Безопасно</Text>
                    </View>
                    <View style={styles.featureItem}>
                        <Ionicons name="sync-outline" size={20} color={colors.primary}/>
                        <Text style={[styles.featureText, {color: colors.textSecondary}]}>Синхронизация</Text>
                    </View>
                </View>

                <View style={styles.footer}>
                    <Text style={[styles.footerText, {color: colors.textSecondary}]}>
                        Используя приложение, вы соглашаетесь с{' '}
                        <Text
                            style={{textDecorationLine: 'underline', color: colors.primary}}
                            onPress={onTermsOfUse}
                        >
                            правилами использования
                        </Text>
                        {' '}и{' '}
                        <Text
                            style={{textDecorationLine: 'underline', color: colors.primary}}
                            onPress={onPrivacyPolicy}
                        >
                            политикой конфиденциальности
                        </Text>
                    </Text>
                </View>
            </Animated.View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {flex: 1},
    inner: {flex: 1, justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 16},
    logoContainer: {
        width: 100,
        height: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {fontSize: 32, fontWeight: '900', marginBottom: 8, textAlign: 'center', letterSpacing: -1.5},
    subtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 24,
        paddingHorizontal: 30,
        opacity: 0.8
    },
    googleButton: {
        height: 60,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        ...getShadow('#000', {width: 0, height: 4}, 0.05, 10, 2)
    },
    buttonContent: {flexDirection: 'row', alignItems: 'center'},
    buttonDisabled: {opacity: 0.7},
    buttonText: {fontWeight: '600', fontSize: 17},
    features: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 32,
        paddingHorizontal: 10
    },
    featureItem: {alignItems: 'center'},
    featureText: {fontSize: 12, marginTop: 8, fontWeight: '500'},
    footer: {marginTop: 'auto', paddingHorizontal: 40, paddingTop: 20, paddingBottom: 20},
    footerText: {fontSize: 12, textAlign: 'center', opacity: 0.6},
    inputContainer: {
        height: 52,
        borderRadius: 16,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
        ...getShadow('#000', {width: 0, height: 2}, 0.05, 5, 1),
    },
    input: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    primaryButton: {
        height: 52,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        ...getShadow('#000', {width: 0, height: 4}, 0.1, 10, 2),
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
});
