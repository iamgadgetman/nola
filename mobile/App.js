import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SettingsProvider } from './src/context/SettingsContext';
import DashboardScreen from './src/screens/DashboardScreen';
import AMPScreen from './src/screens/AMPScreen';
import NetworkScreen from './src/screens/NetworkScreen';
import ChatScreen from './src/screens/ChatScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  'Services':     'grid-outline',
  'Game Servers': 'game-controller-outline',
  'Network':      'wifi-outline',
  'Chat':         'chatbubble-ellipses-outline',
  'Settings':     'settings-outline',
};

export default function App() {
  return (
    <SettingsProvider>
      <SafeAreaProvider>
        <StatusBar style="light" backgroundColor="#0d0d1a" />
        <NavigationContainer>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarStyle: {
                backgroundColor: '#0d0d1a',
                borderTopColor: '#1a1a2e',
                borderTopWidth: 1,
              },
              tabBarActiveTintColor: '#7b7bff',
              tabBarInactiveTintColor: '#555',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />
              ),
            })}
          >
            <Tab.Screen name="Services" component={DashboardScreen} />
            <Tab.Screen name="Game Servers" component={AMPScreen} />
            <Tab.Screen name="Network" component={NetworkScreen} />
            <Tab.Screen name="Chat" component={ChatScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </SettingsProvider>
  );
}
