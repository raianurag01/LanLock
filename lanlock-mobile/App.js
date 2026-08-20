import './global.css';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { navigationTheme } from './src/theme';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ScanScreen from './src/screens/ScanScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Map: { active: 'map', inactive: 'map-outline' },
  Orders: { active: 'fast-food', inactive: 'fast-food-outline' },
};

// Authenticated area: bottom tabs styled to the Home screen's dark/yellow
// system. Scan stays outside the tabs (full-screen camera, no tab bar).
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons
            name={focused ? TAB_ICONS[route.name].active : TAB_ICONS[route.name].inactive}
            size={size}
            color={color}
          />
        ),
        tabBarActiveTintColor: '#FACC15',
        tabBarInactiveTintColor: '#6B7280',
        tabBarStyle: {
          backgroundColor: '#121212',
          borderTopColor: '#1C1C1E',
        },
        headerStyle: {
          backgroundColor: '#1A242D',
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'LanLock' }} />
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Find a Café' }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ title: 'Food & Drinks' }} />
    </Tab.Navigator>
  );
}

// Conditional stacks driven by AuthContext: signing in/out swaps the whole
// navigator, so screens never call navigation.reset across the auth boundary.
function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    // Bootstrap splash while SecureStore/profile check is in flight.
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#121212',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color="#FACC15" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: '#1A242D',
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      {status === 'signedOut' ? (
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Signup"
            component={SignupScreen}
            options={{ headerShown: false }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Scan"
            component={ScanScreen}
            options={{ headerShown: false }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer theme={navigationTheme}>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
