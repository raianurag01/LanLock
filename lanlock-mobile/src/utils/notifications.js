import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Local notifications only. Remote push is deliberately out of scope: the app
 * runs in Expo Go, which no longer supports remote push on Android (SDK 53+).
 * Socket events fire these while the app is open or backgrounded.
 */

// Foreground presentation — without this, notifications fired while the app
// is open are silently swallowed.
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
    }),
});

let initialized = false;

/** Idempotent setup: Android channel + runtime permission (Android 13+). */
export const initNotifications = async () => {
    if (initialized) return;
    initialized = true;
    try {
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('default', {
                name: 'LanLock',
                importance: Notifications.AndroidImportance.MAX,
                lightColor: '#FACC15',
            });
        }
        await Notifications.requestPermissionsAsync();
    } catch (err) {
        // Notifications are decoration on top of the in-app UI — never let a
        // permission/channel failure break sign-in.
        console.log('notification setup failed:', err?.message);
    }
};

/** Fire an immediate local notification (no-op if permission was denied). */
export const notify = async (title, body) => {
    try {
        await Notifications.scheduleNotificationAsync({
            content: { title, body },
            trigger: null,
        });
    } catch (err) {
        console.log('notify failed:', err?.message);
    }
};
