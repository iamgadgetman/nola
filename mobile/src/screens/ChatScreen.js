import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../context/SettingsContext';

const STORAGE_KEY = '@nola_chat_history';
const MAX_HISTORY = 40;       // messages kept in AsyncStorage
const MAX_CONTEXT  = 10;      // messages sent to webhook as context

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  text: "Hey — I'm NOLA. Ask me about your lab.",
  ts: new Date().toISOString(),
};

// ── Simple inline markdown renderer ──────────────────────────────────────────
// Handles: **bold**, `code`, and line breaks. No extra packages needed.
function MarkdownText({ text, style }) {
  const segments = [];
  // Split on **bold** and `code` spans
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, match, key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'text', value: text.slice(last, match.index), key: key++ });
    }
    const raw = match[0];
    if (raw.startsWith('**')) {
      segments.push({ type: 'bold', value: raw.slice(2, -2), key: key++ });
    } else {
      segments.push({ type: 'code', value: raw.slice(1, -1), key: key++ });
    }
    last = match.index + raw.length;
  }
  if (last < text.length) {
    segments.push({ type: 'text', value: text.slice(last), key: key++ });
  }

  // Render line by line so \n creates real line breaks
  const lines = [];
  let currentLine = [];
  for (const seg of segments) {
    const parts = seg.value.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push(currentLine);
        currentLine = [];
      }
      if (part) currentLine.push({ ...seg, value: part });
    });
  }
  lines.push(currentLine);

  return (
    <Text style={style}>
      {lines.map((line, li) => (
        <Text key={li}>
          {li > 0 ? '\n' : null}
          {line.map(seg => {
            if (seg.type === 'bold') return <Text key={seg.key} style={styles.mdBold}>{seg.value}</Text>;
            if (seg.type === 'code') return <Text key={seg.key} style={styles.mdCode}>{seg.value}</Text>;
            return <Text key={seg.key}>{seg.value}</Text>;
          })}
        </Text>
      ))}
    </Text>
  );
}

export default function ChatScreen() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  // Load persisted history on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0) {
          setMessages(saved);
        }
      } catch {}
    });
  }, []);

  // Persist messages whenever they change (skip the initial welcome-only state)
  useEffect(() => {
    if (messages.length === 1 && messages[0].id === 'welcome') return;
    const trimmed = messages.slice(-MAX_HISTORY);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)).catch(() => {});
  }, [messages]);

  const scrollToEnd = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      text,
      ts: new Date().toISOString(),
    };

    setMessages(prev => {
      const next = [...prev, userMsg];
      return next;
    });
    setSending(true);
    scrollToEnd();

    try {
      // Build context from recent non-welcome messages
      const contextMessages = messages
        .filter(m => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
        .slice(-MAX_CONTEXT)
        .map(m => ({ role: m.role, content: m.text }));

      const res = await fetch(settings.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatInput: text,
          history: contextMessages,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const reply = data?.output ?? data?.message ?? data?.response ?? JSON.stringify(data);

      const assistantMsg = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: reply,
        ts: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (e) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'error',
          text: `Error: ${e.message}`,
          ts: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  }, [input, sending, messages, settings.n8nWebhookUrl, scrollToEnd]);

  const clearHistory = useCallback(() => {
    setMessages([WELCOME]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }, []);

  const renderItem = useCallback(({ item }) => {
    const isUser = item.role === 'user';
    const isError = item.role === 'error';
    const ts = new Date(item.ts);
    const timeStr = isNaN(ts) ? '' : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
          <MarkdownText
            text={item.text}
            style={[styles.bubbleText, isError && styles.bubbleTextError]}
          />
          <Text style={[styles.timestamp, isUser && styles.timestampUser]}>{timeStr}</Text>
        </View>
      </View>
    );
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.onlineDot} />
          <Text style={styles.title}>NOLA</Text>
        </View>
        <TouchableOpacity
          onPress={clearHistory}
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
  mdBold: { fontWeight: '700', color: '#fff' },
  mdCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#0d0d2a', color: '#7b7bff',
    borderRadius: 4, paddingHorizontal: 3,
    fontSize: 13,
  },
  timestamp: { color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 4, textAlign: 'right' },
  timestampUser: { color: 'rgba(255,255,255,0.5)' },
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
