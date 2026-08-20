import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Keyboard,
    Linking,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { getApiErrorMessage } from '../api/auth';
import { fetchVenues, reserveVenuePc } from '../api/venues';
import { VENUES } from '../data/venues';

const YELLOW = '#FACC15';
const BG = '#121212';
const CARD_BG = '#1C1C1E';
const ONLINE_GREEN = '#22C55E';

const CARD_HIDDEN_Y = 560;

// Leaflet map rendered inside a WebView (react-native-maps is broken in Expo
// Go on Android since SDK 53, so the map lives in web-land). CARTO dark tiles
// match the app's #121212 system; venues are injected as JSON at build time.
const buildMapHtml = (venues) => `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; background: ${BG}; }
  .leaflet-control-attribution { background: rgba(18,18,18,0.7) !important; color: #6B7280 !important; }
  .leaflet-control-attribution a { color: #9CA3AF !important; }
</style>
</head>
<body>
<div id="map"></div>
<script>
  var venues = ${JSON.stringify(venues)};

  var map = L.map('map', { zoomControl: false });
  var bounds = L.latLngBounds(venues.map(function (v) { return [v.lat, v.lng]; }));
  map.fitBounds(bounds, { padding: [70, 70] });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);

  var pinHtml =
    '<div style="width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
    'background:${YELLOW};border:2px solid #0e0e0e;box-shadow:0 0 14px rgba(250,204,21,0.55);' +
    'display:flex;align-items:center;justify-content:center">' +
    '<span style="transform:rotate(45deg);font-size:17px">🎮</span></div>';
  var pinIcon = L.divIcon({ className: '', html: pinHtml, iconSize: [36, 36], iconAnchor: [18, 36] });

  function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }

  venues.forEach(function (v) {
    L.marker([v.lat, v.lng], { icon: pinIcon })
      .addTo(map)
      .on('click', function () {
        map.flyTo([v.lat, v.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
        post({ type: 'venue', id: v.id });
      });
  });

  map.on('click', function () { post({ type: 'map-tap' }); });

  // RN -> web: fly to a venue selected from the search results.
  function handleMessage(e) {
    try {
      var m = JSON.parse(e.data);
      if (m.type === 'focus') {
        var v = venues.find(function (x) { return x.id === m.id; });
        if (v) map.flyTo([v.lat, v.lng], 16, { duration: 0.8 });
      }
    } catch (err) { /* ignore non-JSON messages */ }
  }
  document.addEventListener('message', handleMessage); // Android
  window.addEventListener('message', handleMessage);   // iOS
</script>
</body>
</html>`;

// live: { venueDbId, pcAvailable, pcTotal } merged from GET /venues, or null
// when the backend is unreachable (availability + Reserve hide gracefully).
const VenueDetailCard = ({
    venue,
    live,
    reservation,
    reserving,
    onReserve,
    translateY,
    onClose,
}) => {
    const reserved = reservation?.venueId === venue.id ? reservation : null;
    return (
        <Animated.View style={[styles.detailCard, { transform: [{ translateY }] }]}>
            <View style={styles.detailHeader}>
                <View style={styles.detailTitleWrap}>
                    <Text style={styles.detailName} numberOfLines={1}>{venue.name}</Text>
                    <View style={styles.verifiedBadge}>
                        <Ionicons name="shield-checkmark" size={12} color={BG} />
                        <Text style={styles.verifiedText}>LanLock Verified</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
                    <Ionicons name="close" size={20} color="#9CA3AF" />
                </TouchableOpacity>
            </View>

            {venue.perks?.length > 0 && (
                <View style={styles.perksRow}>
                    {venue.perks.map((perk) => (
                        <View key={perk} style={styles.perkChip}>
                            <Text style={styles.perkText}>{perk.toUpperCase()}</Text>
                        </View>
                    ))}
                </View>
            )}

            {venue.pricePerHour != null && (
                <View style={styles.pricingBlock}>
                    <Text style={styles.priceHeadline}>
                        ₹{venue.pricePerHour}
                        <Text style={styles.priceUnit}>/hr</Text>
                    </Text>
                    <View style={styles.packageRow}>
                        {(venue.packages ?? []).map((pkg) => {
                            const savings = pkg.hours * venue.pricePerHour - pkg.price;
                            return (
                                <View key={pkg.hours} style={styles.packageChip}>
                                    <Text style={styles.packageText}>
                                        {pkg.hours} hrs ₹{pkg.price}
                                    </Text>
                                    {savings > 0 && (
                                        <Text style={styles.packageSave}>SAVE ₹{savings}</Text>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                </View>
            )}

            {live && (
                <View style={styles.availabilityBlock}>
                    <View style={styles.availabilityBar}>
                        <View style={{ flex: live.pcAvailable, backgroundColor: ONLINE_GREEN }} />
                        <View
                            style={{
                                flex: Math.max(live.pcTotal - live.pcAvailable, 0),
                                backgroundColor: 'rgba(255,255,255,0.12)',
                            }}
                        />
                    </View>
                    <Text style={styles.availabilityText}>
                        {live.pcAvailable}/{live.pcTotal} PCs available now
                    </Text>
                </View>
            )}

            <View style={styles.detailRow}>
                <Ionicons name="location-outline" size={15} color="#9CA3AF" />
                <Text style={styles.detailRowText} numberOfLines={2}>{venue.address}</Text>
            </View>
            {venue.hours != null && (
                <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={15} color="#9CA3AF" />
                    <Text style={styles.detailRowText}>{venue.hours}</Text>
                </View>
            )}
            {!live && (
                <View style={styles.detailRow}>
                    <Ionicons name="desktop-outline" size={15} color={ONLINE_GREEN} />
                    <Text style={styles.detailRowText}>
                        {venue.pcCount} gaming PCs · LanLock secured
                    </Text>
                </View>
            )}
            {venue.rating != null && (
                <View style={styles.detailRow}>
                    <Ionicons name="star" size={15} color={YELLOW} />
                    <Text style={styles.detailRowText}>{venue.rating.toFixed(1)} rating</Text>
                </View>
            )}
            {live?.coinRewards && (
                <View style={styles.detailRow}>
                    <Ionicons name="medal-outline" size={15} color={YELLOW} />
                    <Text style={styles.detailRowText}>
                        Earn coins every hour · 1000 pts = 1 free hour
                    </Text>
                </View>
            )}

            {reserved ? (
                <View style={styles.reservedBanner}>
                    <Ionicons name="checkmark-circle" size={18} color={ONLINE_GREEN} />
                    <Text style={styles.reservedText}>
                        {reserved.pcName} reserved · held for 30 min
                    </Text>
                </View>
            ) : (
                <View style={styles.detailActions}>
                    {live && live.pcAvailable > 0 && (
                        <TouchableOpacity
                            style={[styles.reserveButton, reserving && styles.reserveButtonBusy]}
                            activeOpacity={0.85}
                            onPress={onReserve}
                            disabled={reserving}
                        >
                            <Ionicons name="game-controller" size={16} color={BG} />
                            <Text style={styles.reserveText}>
                                {reserving ? 'Reserving…' : 'Reserve a PC'}
                            </Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={styles.directionsButton}
                        activeOpacity={0.85}
                        onPress={() =>
                            Linking.openURL(
                                `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`,
                            )
                        }
                    >
                        <Ionicons name="navigate" size={16} color={YELLOW} />
                        <Text style={styles.directionsText}>Directions</Text>
                    </TouchableOpacity>
                    {venue.phone != null && (
                        <TouchableOpacity
                            style={styles.callButton}
                            activeOpacity={0.85}
                            onPress={() => Linking.openURL(`tel:${venue.phone.replace(/\s/g, '')}`)}
                        >
                            <Ionicons name="call-outline" size={16} color={YELLOW} />
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </Animated.View>
    );
};

export default function MapScreen() {
    const webviewRef = useRef(null);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);
    // name → { venueDbId, pcAvailable, pcTotal } from GET /venues; empty when
    // the backend is unreachable (map still works from static data).
    const [liveByName, setLiveByName] = useState({});
    // { venueId (static id), pcName } of the user's confirmed reservation.
    const [reservation, setReservation] = useState(null);
    const [reserving, setReserving] = useState(false);
    const cardY = useRef(new Animated.Value(CARD_HIDDEN_Y)).current;

    const html = useMemo(() => buildMapHtml(VENUES), []);

    const loadVenues = useCallback(async () => {
        try {
            const rows = await fetchVenues();
            const byName = {};
            rows.forEach((row) => {
                byName[row.name] = {
                    venueDbId: row.id,
                    pcAvailable: row.pcAvailable,
                    pcTotal: row.pcTotal,
                    coinRewards: row.coinRewards,
                };
            });
            setLiveByName(byName);
        } catch (err) {
            console.log('venues fetch failed:', getApiErrorMessage(err));
        }
    }, []);

    useEffect(() => {
        loadVenues();
    }, [loadVenues]);

    const handleReserve = async () => {
        const live = selected ? liveByName[selected.name] : null;
        if (!live?.venueDbId || reserving) return;
        setReserving(true);
        try {
            const result = await reserveVenuePc(live.venueDbId);
            setReservation({ venueId: selected.id, pcName: result.pcName });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            loadVenues();
        } catch (err) {
            Alert.alert(
                'Reservation failed',
                getApiErrorMessage(err, 'Could not reserve a PC right now.'),
            );
        } finally {
            setReserving(false);
        }
    };

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return VENUES.filter(
            (v) =>
                v.name.toLowerCase().includes(q) ||
                v.address.toLowerCase().includes(q),
        );
    }, [query]);

    const showCard = (venue) => {
        setSelected(venue);
        Animated.spring(cardY, {
            toValue: 0,
            friction: 9,
            tension: 60,
            useNativeDriver: true,
        }).start();
    };

    const hideCard = () => {
        Animated.timing(cardY, {
            toValue: CARD_HIDDEN_Y,
            duration: 220,
            useNativeDriver: true,
        }).start(() => setSelected(null));
    };

    const focusVenue = (venue) => {
        Keyboard.dismiss();
        setQuery('');
        webviewRef.current?.postMessage(JSON.stringify({ type: 'focus', id: venue.id }));
        showCard(venue);
    };

    const onWebViewMessage = (event) => {
        try {
            const msg = JSON.parse(event.nativeEvent.data);
            if (msg.type === 'venue') {
                const venue = VENUES.find((v) => v.id === msg.id);
                if (venue) showCard(venue);
            } else if (msg.type === 'map-tap') {
                hideCard();
            }
        } catch {
            // Ignore malformed messages from the web side.
        }
    };

    return (
        <View style={styles.container}>
            <WebView
                ref={webviewRef}
                originWhitelist={['*']}
                source={{ html }}
                style={styles.webview}
                onMessage={onWebViewMessage}
                javaScriptEnabled
                domStorageEnabled
            />

            <View style={styles.searchWrap}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={18} color="#6B7280" />
                    <TextInput
                        style={styles.searchInput}
                        value={query}
                        onChangeText={setQuery}
                        placeholder="Search cafés or areas…"
                        placeholderTextColor="#4B5563"
                        returnKeyType="search"
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')} activeOpacity={0.7}>
                            <Ionicons name="close-circle" size={18} color="#6B7280" />
                        </TouchableOpacity>
                    )}
                </View>

                {results.length > 0 && (
                    <View style={styles.resultsCard}>
                        {results.map((venue, index) => (
                            <TouchableOpacity
                                key={venue.id}
                                style={[
                                    styles.resultRow,
                                    index < results.length - 1 && styles.resultRowBorder,
                                ]}
                                onPress={() => focusVenue(venue)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="game-controller-outline" size={16} color={YELLOW} />
                                <View style={styles.resultText}>
                                    <Text style={styles.resultName} numberOfLines={1}>
                                        {venue.name}
                                    </Text>
                                    <Text style={styles.resultAddress} numberOfLines={1}>
                                        {venue.address}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color="#4B5563" />
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>

            {selected && (
                <VenueDetailCard
                    venue={selected}
                    live={liveByName[selected.name] ?? null}
                    reservation={reservation}
                    reserving={reserving}
                    onReserve={handleReserve}
                    translateY={cardY}
                    onClose={hideCard}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG,
    },
    webview: {
        flex: 1,
        backgroundColor: BG,
    },
    searchWrap: {
        position: 'absolute',
        top: 12,
        left: 16,
        right: 16,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: '#F9FAFB',
        paddingVertical: 10,
    },
    resultsCard: {
        marginTop: 8,
        backgroundColor: CARD_BG,
        borderRadius: 12,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
    },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 12,
    },
    resultRowBorder: {
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    },
    resultText: {
        flex: 1,
    },
    resultName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#E2E8F0',
        marginBottom: 2,
    },
    resultAddress: {
        fontSize: 11,
        color: '#6B7280',
    },
    detailCard: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        backgroundColor: CARD_BG,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.2)',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.5,
        shadowRadius: 12,
    },
    detailHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    detailTitleWrap: {
        flex: 1,
        marginRight: 8,
    },
    detailName: {
        fontSize: 17,
        fontWeight: '800',
        color: '#F9FAFB',
        marginBottom: 6,
    },
    verifiedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        backgroundColor: YELLOW,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    verifiedText: {
        fontSize: 10,
        fontWeight: '800',
        color: BG,
        letterSpacing: 0.3,
    },
    closeButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    detailRowText: {
        flex: 1,
        fontSize: 13,
        color: '#D1D5DB',
        lineHeight: 18,
    },
    perksRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 12,
    },
    perkChip: {
        backgroundColor: 'rgba(250, 204, 21, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.35)',
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
    },
    perkText: {
        fontSize: 9,
        fontWeight: '800',
        color: YELLOW,
        letterSpacing: 0.6,
    },
    pricingBlock: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
    },
    priceHeadline: {
        fontSize: 24,
        fontWeight: '800',
        color: '#F9FAFB',
    },
    priceUnit: {
        fontSize: 13,
        fontWeight: '600',
        color: '#9CA3AF',
    },
    packageRow: {
        flex: 1,
        flexDirection: 'row',
        gap: 8,
    },
    packageChip: {
        flex: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: 10,
        paddingVertical: 6,
        alignItems: 'center',
    },
    packageText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#E2E8F0',
    },
    packageSave: {
        fontSize: 9,
        fontWeight: '800',
        color: ONLINE_GREEN,
        letterSpacing: 0.4,
        marginTop: 2,
    },
    availabilityBlock: {
        marginBottom: 12,
    },
    availabilityBar: {
        flexDirection: 'row',
        height: 6,
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 6,
    },
    availabilityText: {
        fontSize: 12,
        fontWeight: '700',
        color: ONLINE_GREEN,
    },
    reservedBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(34, 197, 94, 0.35)',
        borderRadius: 10,
        paddingVertical: 12,
        marginTop: 8,
    },
    reservedText: {
        fontSize: 13,
        fontWeight: '700',
        color: ONLINE_GREEN,
    },
    detailActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 8,
    },
    reserveButton: {
        flex: 1.4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: YELLOW,
        paddingVertical: 12,
        borderRadius: 10,
    },
    reserveButtonBusy: {
        opacity: 0.6,
    },
    reserveText: {
        color: BG,
        fontSize: 14,
        fontWeight: '800',
    },
    directionsButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.5)',
        paddingVertical: 12,
        borderRadius: 10,
    },
    directionsText: {
        color: YELLOW,
        fontSize: 14,
        fontWeight: '700',
    },
    callButton: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'rgba(250, 204, 21, 0.5)',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 10,
    },
});
