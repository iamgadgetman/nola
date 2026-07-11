import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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

// ─── Error boundary — catches render errors per tab ──────────────
class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={eb.container}>
          <Ionicons name="warning-outline" size={40} color="#ff4757" />
          <Text style={eb.title}>Something went wrong</Text>
          <Text style={eb.message}>{this.state.error?.message || 'Unknown error'}</Text>
          <TouchableOpacity
            style={eb.btn}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={eb.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const eb = StyleSheet.create({
  container: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#0d0d1a', padding: 24, gap: 12,
  },
  title:   { color: '#ff4757', fontSize: 16, fontWeight: '600' },
  message: { color: '#555', fontSize: 13, textAlign: 'center' },
  btn: {
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: '#1a1a2e', borderRadius: 8,
  },
  btnText: { color: '#7b7bff', fontSize: 14 },
});

// Wraps any screen component in an ErrorBoundary
function guarded(Component) {
  return function GuardedScreen(props) {
    return (
      <ErrorBoundary>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

// ─── Navigation ───────────────────────────────────────────────────
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
            <Tab.Screen name="Services"     component={guarded(DashboardScreen)} />
            <Tab.Screen name="Game Servers" component={guarded(AMPScreen)} />
            <Tab.Screen name="Network"      component={guarded(NetworkScreen)} />
            <Tab.Screen name="Chat"         component={guarded(ChatScreen)} />
            <Tab.Screen name="Settings"     component={guarded(SettingsScreen)} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </SettingsProvider>
  );
}
