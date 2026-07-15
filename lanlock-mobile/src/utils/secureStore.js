import * as SecureStore from 'expo-secure-store';

// Key under which the JWT is persisted in the device keychain / keystore.
const TOKEN_KEY = 'lanlock.auth.token';

/**
 * Persist the JWT securely (Keychain on iOS, Keystore on Android).
 * @param {string} token
 */
export const saveToken = async (token) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
};

/**
 * Retrieve the stored JWT, or null if the user is not authenticated.
 * @returns {Promise<string | null>}
 */
export const getToken = async () => {
    return SecureStore.getItemAsync(TOKEN_KEY);
};

/**
 * Remove the stored JWT (e.g. on logout or a 401 response).
 */
export const deleteToken = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
};
