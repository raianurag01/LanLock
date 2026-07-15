import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { signup, getApiErrorMessage } from '../api/auth';
import { saveToken } from '../utils/secureStore';

export default function SignupScreen({ navigation }) {
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSignup = async () => {
        if (!email.trim() || !username.trim() || !password) {
            Alert.alert('Missing details', 'Please fill in every field.');
            return;
        }
        if (password.length < 8) {
            Alert.alert('Weak password', 'Password must be at least 8 characters.');
            return;
        }

        setSubmitting(true);
        try {
            const { accessToken } = await signup({
                email: email.trim(),
                username: username.trim(),
                password,
            });
            await saveToken(accessToken);

            // Only reached on a 2xx response.
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        } catch (error) {
            Alert.alert(
                'Sign up failed',
                getApiErrorMessage(error, 'Could not create your account'),
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView
            className="flex-1 bg-background"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerClassName="flex-grow justify-center px-6 py-12"
                keyboardShouldPersistTaps="handled"
            >
                {/* Brand header */}
                <View className="mb-10">
                    <View className="h-1 w-10 bg-primary mb-4" />
                    <Text className="text-4xl font-extrabold uppercase tracking-widest text-white">
                        Create Account
                    </Text>
                    <Text className="mt-2 text-base text-gray-400">
                        Join the LanLock network
                    </Text>
                </View>

                {/* Email */}
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Email
                </Text>
                <TextInput
                    className="mb-5 rounded-lg border border-white/10 bg-surface px-4 py-3.5 text-base text-white"
                    placeholder="you@example.com"
                    placeholderTextColor="#718096"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    value={email}
                    onChangeText={setEmail}
                    editable={!submitting}
                />

                {/* Username */}
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Username
                </Text>
                <TextInput
                    className="mb-5 rounded-lg border border-white/10 bg-surface px-4 py-3.5 text-base text-white"
                    placeholder="agent47"
                    placeholderTextColor="#718096"
                    autoCapitalize="none"
                    autoComplete="username"
                    value={username}
                    onChangeText={setUsername}
                    editable={!submitting}
                />

                {/* Password */}
                <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Password
                </Text>
                <TextInput
                    className="mb-2 rounded-lg border border-white/10 bg-surface px-4 py-3.5 text-base text-white"
                    placeholder="At least 8 characters"
                    placeholderTextColor="#718096"
                    autoCapitalize="none"
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    editable={!submitting}
                />
                <Text className="mb-8 text-xs text-gray-500">
                    Use 8 or more characters.
                </Text>

                {/* Submit */}
                <TouchableOpacity
                    className={`items-center rounded-lg py-4 ${submitting ? 'bg-primary/60' : 'bg-primary'}`}
                    activeOpacity={0.85}
                    onPress={handleSignup}
                    disabled={submitting}
                >
                    {submitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                    ) : (
                        <Text className="text-base font-bold uppercase tracking-wider text-white">
                            Create Account
                        </Text>
                    )}
                </TouchableOpacity>

                {/* Link to login */}
                <View className="mt-6 flex-row justify-center">
                    <Text className="text-gray-400">Already have an account? </Text>
                    <TouchableOpacity
                        onPress={() => navigation.navigate('Login')}
                        disabled={submitting}
                    >
                        <Text className="font-semibold text-action">Sign in</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}
