import React, { useEffect, useRef, useState } from 'react';
import {
    StyleSheet,
    Text,
    View,
    TouchableOpacity,
    Dimensions,
    Alert,
    ActivityIndicator,
} from 'react-native';
import {
    CameraView,
    useCameraPermissions,
    type BarcodeScanningResult,
} from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { linkPc, getApiErrorMessage } from '../api/auth';

const { width, height } = Dimensions.get('window');
const innerDimension = width * 0.7;

// How long the success screen lingers before we auto-dismiss back to Home.
const SUCCESS_DISMISS_MS = 1500;

// Shape of the QR payload produced by the desktop "Lock" client. venueId is
// additive — older desktop builds omit it and pairing still works (the
// session just gets no venue attribution: LanCoins stays off).
interface LinkPcPayload {
    action: string;
    pcId: string;
    venueId?: string;
}

// Minimal navigation contract so we avoid `any` without a typed navigator.
interface ScanScreenProps {
    navigation: {
        goBack: () => void;
        navigate: (screen: string, params?: { screen: string }) => void;
    };
}

export default function ScanScreen({ navigation }: ScanScreenProps): React.JSX.Element {
    const [permission, requestPermission] = useCameraPermissions();
    const [submitting, setSubmitting] = useState(false);
    const [linked, setLinked] = useState(false);

    // Guards against expo-camera firing onBarcodeScanned repeatedly for the
    // same frame while we are already handling a scan.
    const lockRef = useRef(false);
    // Hold the auto-dismiss timer so we can clear it if the screen unmounts
    // before it fires (avoids navigating on an unmounted component).
    const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!permission) {
            requestPermission();
        }
    }, [permission, requestPermission]);

    useEffect(() => {
        return () => {
            if (dismissTimer.current) {
                clearTimeout(dismissTimer.current);
            }
        };
    }, []);

    const resetScanLock = (): void => {
        lockRef.current = false;
    };

    const handleBarcodeScanned = async (
        result: BarcodeScanningResult,
    ): Promise<void> => {
        if (lockRef.current || submitting) {
            return;
        }
        lockRef.current = true;

        // 1. Parse the QR value as JSON.
        let payload: LinkPcPayload;
        try {
            payload = JSON.parse(result.data) as LinkPcPayload;
        } catch {
            Alert.alert(
                'Invalid QR code',
                'This does not look like a LanLock pairing code.',
                [{ text: 'Try again', onPress: resetScanLock }],
            );
            return;
        }

        // 2. Validate the action and pcId.
        if (payload.action !== 'LINK_PC' || !payload.pcId) {
            Alert.alert(
                'Unsupported QR code',
                'This QR code is not a valid PC pairing code.',
                [{ text: 'Try again', onPress: resetScanLock }],
            );
            return;
        }

        // 3. Send the pairing request (token attached by the API interceptor).
        setSubmitting(true);
        try {
            await linkPc(payload.pcId, payload.venueId);
            // Show the success state, then auto-dismiss back to Home so the
            // scanner cleanly gets out of the way without a tap.
            setLinked(true);
            dismissTimer.current = setTimeout(() => {
                // Home now lives inside the Main tab navigator.
                navigation.navigate('Main', { screen: 'Home' });
            }, SUCCESS_DISMISS_MS);
        } catch (error) {
            // Covers 409 Conflict ("already linked to another account"),
            // 401, network errors, etc.
            Alert.alert('Pairing failed', getApiErrorMessage(error, 'Could not link this PC.'), [
                { text: 'Try again', onPress: resetScanLock },
            ]);
        } finally {
            setSubmitting(false);
        }
    };

    // Permissions still loading.
    if (!permission) {
        return <View style={styles.container} />;
    }

    // Permissions not granted yet.
    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={styles.message}>We need your permission to show the camera</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                    <Text style={styles.permissionButtonText}>Grant Permission</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Ionicons name="arrow-back" size={24} color="white" />
                </TouchableOpacity>
            </View>
        );
    }

    // Success state — full-screen confirmation that auto-dismisses to Home.
    if (linked) {
        return (
            <View style={[styles.container, styles.successContainer]}>
                <Ionicons name="checkmark-circle" size={96} color="#22C55E" />
                <Text style={styles.successTitle}>PC Linked Successfully</Text>
                <Text style={styles.successSubtitle}>
                    This PC is now paired to your account.
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={submitting ? undefined : handleBarcodeScanned}
            >
                {/* Dimmed overlay with a transparent cutout in the middle */}
                <View style={styles.overlay}>
                    <View style={styles.unfilled} />
                    <View style={styles.row}>
                        <View style={styles.unfilled} />
                        <View style={styles.cutout} />
                        <View style={styles.unfilled} />
                    </View>
                    <View style={styles.unfilled} />
                </View>

                <View style={styles.topContent}>
                    <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
                        <Ionicons name="close" size={32} color="white" />
                    </TouchableOpacity>
                    <Text style={styles.headerText}>Scan to Pair</Text>
                </View>

                <View style={styles.bottomContent}>
                    {submitting ? (
                        <View style={styles.linkingRow}>
                            <ActivityIndicator color="#FF4655" />
                            <Text style={styles.hintText}>Linking PC…</Text>
                        </View>
                    ) : (
                        <Text style={styles.hintText}>
                            Point your camera at the QR code on the PC screen
                        </Text>
                    )}
                </View>
            </CameraView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0F1923',
    },
    camera: {
        flex: 1,
    },
    successContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
    },
    successTitle: {
        color: 'white',
        fontSize: 22,
        fontWeight: 'bold',
        marginTop: 24,
        textAlign: 'center',
    },
    successSubtitle: {
        color: 'rgba(255, 255, 255, 0.7)',
        fontSize: 15,
        marginTop: 8,
        textAlign: 'center',
    },
    message: {
        textAlign: 'center',
        paddingBottom: 10,
        color: 'white',
        fontSize: 16,
        marginTop: height * 0.4,
    },
    permissionButton: {
        backgroundColor: '#FF4655',
        padding: 12,
        borderRadius: 8,
        alignSelf: 'center',
    },
    permissionButtonText: {
        color: 'white',
        fontWeight: 'bold',
    },
    backButton: {
        position: 'absolute',
        top: 50,
        left: 20,
        padding: 8,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
    },
    row: {
        flexDirection: 'row',
        height: innerDimension,
    },
    unfilled: {
        flex: 1,
        backgroundColor: 'rgba(15, 25, 35, 0.7)',
    },
    cutout: {
        width: innerDimension,
        height: innerDimension,
        borderWidth: 2,
        borderColor: '#FF4655',
        backgroundColor: 'transparent',
    },
    topContent: {
        position: 'absolute',
        top: 50,
        width: '100%',
        alignItems: 'center',
    },
    closeButton: {
        position: 'absolute',
        left: 20,
        top: 0,
    },
    headerText: {
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
        textTransform: 'uppercase',
    },
    bottomContent: {
        position: 'absolute',
        bottom: 80,
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    linkingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    hintText: {
        color: 'white',
        fontSize: 16,
        textAlign: 'center',
        opacity: 0.9,
    },
});
