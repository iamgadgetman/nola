import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  text: "Hey — I'm NOLA. Ask me about your lab.",
  ts: new Date(),
};

export default function ChatScreen() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');

    const userMsg = { id: Date.now().toString(), role: 'user', text, ts: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      const res = await fetch(settings.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatInput: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.output ?? data?.message ?? data?.response ?? JSON.stringify(data);
      const assistantMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: reply,
        ts: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: 'error', text: `Error: ${e.message}`, ts: new Date() },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, sending, settings.n8nWebhookUrl]);

  const renderItem = ({ item }) => {
    const isUser = item.role === 'user';
    const isError = item.role === 'error';
    return (
      <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAssistant]}>
        {!isUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>N</Text>
          </View>
        )}
        <View style={[
          styles.bubble,
          isUser ? styles.bubbleUser : isError ? styles.bubbleError : styles.bubbleAssistant,
        ]}>
          <Text style={[styles.bubbleText, isError && styles.bubbleTextError]}>{item.text}</Text>
          <Text style={styles.timestamp}>
            {item.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.onlineDot} />
          <Text style={styles.title}>NOLA</Text>
        </View>
        <TouchableOpacity
          onPress={() => setMessages([WELCOME])}
          style={styles.clearBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={18} color="#555" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {sending && (
          <View style={styles.typingRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>N</Text>
            </View>
            <View style={styles.typingBubble}>
              <ActivityIndicator size="small" color="#7b7bff" />
            </View>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask NOLA..."
            placeholderTextColor="#555"
            multiline
            maxLength={2000}
            onSubmitEditing={send}
            blurOnSubmit={false}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!input.trim() || sending}
          >
            <Ionicons name="send" size={18} color={input.trim() && !sending ? '#7b7bff' : '#333'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0d0d1a' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#00d26a' },
  title: { color: '#e0e0e0', fontSize: 20, fontWeight: 'bold', letterSpacing: 1 },
  clearBtn: { padding: 4 },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAssistant: { justifyContent: 'flex-start' },
  avatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#7b7bff', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  bubble: { maxWidth: '75%', borderRadius: 16, padding: 12 },
  bubbleUser: { backgroundColor: '#7b7bff', borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: '#1a1a2e', borderBottomLeftRadius: 4 },
  bubbleError: { backgroundColor: '#2a1a1a', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#e0e0e0', fontSize: 14, lineHeight: 20 },
  bubbleTextError: { color: '#ff4757' },
  timestamp: { color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 4, textAlign: 'right' },
  typingRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, marginBottom: 8,
  },
  typingBubble: {
    backgroundColor: '#1a1a2e', borderRadius: 16, borderBottomLeftRadius: 4,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
    backgroundColor: '#0d0d1a',
  },
  input: {
    flex: 1, backgroundColor: '#1a1a2e', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: '#e0e0e0', fontSize: 14, maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
