import { apiFetch } from './remote/apiClient';

// ---------------------------------------------------------------------------
// LLM assistant — talks to the reSpotIt backend, which proxies Open WebUI
// (and therefore llama-server). The Open WebUI API key never leaves the
// server. Only available in media-server mode.
// ---------------------------------------------------------------------------

export interface LLMStatus {
  configured: boolean;
  available: boolean;
  base_url: string;
  model: string | null;
  models: number;
  error: string | null;
  mcp_configured?: boolean;
  mcp_tools?: number;
  chat_history?: boolean;
}

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface LLMToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
}

export interface LLMChatResult {
  content: string;
  reasoning_content: string;
  finish_reason: string | null;
  model: string;
  usage: LLMChatUsage;
  tool_calls?: LLMToolCall[];
  chat_id?: string | null;
  persisted?: boolean;
}

export interface LLMChatOptions {
  model?: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
  use_tools?: boolean;
  chat_id?: string | null;
  use_history?: boolean;
  history_limit?: number;
  persist?: boolean;
  chat_type?: string;
}

export interface LLMChatSummary {
  id: string;
  title?: string | null;
  updated_at?: number | null;
  created_at?: number | null;
}

export interface LLMStoredMessage {
  id?: string | null;
  role?: string | null;
  content?: string | any;
  timestamp?: number | null;
}

export interface LLMChatRow {
  id: string;
  title?: string | null;
  updated_at?: number | null;
  created_at?: number | null;
  chat?: {
    messages?: LLMStoredMessage[] | null;
    history?: { messages?: Record<string, LLMStoredMessage> | null } | null;
  } | null;
}

export async function getLLMStatus(serverUrl: string): Promise<LLMStatus> {
  const res = await apiFetch<{ data: LLMStatus }>(serverUrl, '/api/v1/llm/status');
  return res.data;
}

export async function chatWithLLM(
  serverUrl: string,
  messages: LLMMessage[],
  options: LLMChatOptions = {},
): Promise<LLMChatResult> {
  const res = await apiFetch<{ data: LLMChatResult }>(serverUrl, '/api/v1/llm/chat', {
    method: 'POST',
    body: { messages, ...options },
  });
  return res.data;
}

export interface ExtractedAlbum {
  artist: string;
  album: string;
}

/**
 * The result of an album scan. The server logs the scan in an Open WebUI
 * chat and answers with its id, so the dialog can continue that chat
 * instead of starting a second one.
 */
export interface ExtractedAlbumsResult {
  albums: ExtractedAlbum[];
  chatId: string | null;
}

export interface ExtractedConcert {
  artist: string;
  date: string;
  venue: string;
  url: string;
}

export interface ExtractedTrack {
  artist: string;
  title: string;
}

export async function extractAlbumsFromUrl(
  serverUrl: string,
  url: string,
): Promise<ExtractedAlbumsResult> {
  const res = await apiFetch<{ data: { albums: ExtractedAlbum[] }; chat_id?: string | null }>(
    serverUrl, '/api/v1/llm/extract-albums', { method: 'POST', body: { url } },
  );
  return { albums: res.data?.albums ?? [], chatId: res.chat_id ?? null };
}

export async function extractAlbumsFromText(
  serverUrl: string,
  text: string,
): Promise<ExtractedAlbumsResult> {
  const res = await apiFetch<{ data: { albums: ExtractedAlbum[] }; chat_id?: string | null }>(
    serverUrl, '/api/v1/llm/extract-albums', { method: 'POST', body: { text } },
  );
  return { albums: res.data?.albums ?? [], chatId: res.chat_id ?? null };
}

export async function extractTracksFromUrl(
  serverUrl: string,
  url: string,
): Promise<ExtractedTrack[]> {
  const res = await apiFetch<{ data: { tracks: ExtractedTrack[] } }>(
    serverUrl, '/api/v1/llm/extract-tracks', { method: 'POST', body: { url } },
  );
  return res.data?.tracks ?? [];
}

export async function extractTracksFromText(
  serverUrl: string,
  text: string,
): Promise<ExtractedTrack[]> {
  const res = await apiFetch<{ data: { tracks: ExtractedTrack[] } }>(
    serverUrl, '/api/v1/llm/extract-tracks', { method: 'POST', body: { text } },
  );
  return res.data?.tracks ?? [];
}

export async function extractConcertsFromUrl(
  serverUrl: string,
  url: string,
): Promise<ExtractedConcert[]> {
  const res = await apiFetch<{ data: { concerts: ExtractedConcert[] } }>(
    serverUrl, '/api/v1/llm/extract-concerts', { method: 'POST', body: { url } },
  );
  return res.data?.concerts ?? [];
}

export async function extractConcertsFromText(
  serverUrl: string,
  text: string,
): Promise<ExtractedConcert[]> {
  const res = await apiFetch<{ data: { concerts: ExtractedConcert[] } }>(
    serverUrl, '/api/v1/llm/extract-concerts', { method: 'POST', body: { text } },
  );
  return res.data?.concerts ?? [];
}

export async function listLLMChats(serverUrl: string, chatType?: string): Promise<LLMChatSummary[]> {
  const url = chatType ? `/api/v1/llm/chats?chat_type=${encodeURIComponent(chatType)}` : '/api/v1/llm/chats';
  const res = await apiFetch<{ data: LLMChatSummary[] }>(serverUrl, url);
  return res.data ?? [];
}

export async function getCurrentLLMChat(serverUrl: string): Promise<LLMChatRow | null> {
  const res = await apiFetch<{ data: LLMChatRow | null }>(serverUrl, '/api/v1/llm/chats/current');
  return res.data ?? null;
}

export async function getLLMChat(serverUrl: string, chatId: string): Promise<LLMChatRow> {
  const res = await apiFetch<{ data: LLMChatRow }>(serverUrl, '/api/v1/llm/chats/' + encodeURIComponent(chatId));
  return res.data;
}

export async function createLLMChat(serverUrl: string, title?: string, model?: string, chatType?: string): Promise<LLMChatRow> {
  const res = await apiFetch<{ data: LLMChatRow }>(serverUrl, '/api/v1/llm/chats', {
    method: 'POST',
    body: { title: title ?? null, model: model ?? null, chat_type: chatType ?? null },
  });
  return res.data;
}

export async function deleteLLMChat(serverUrl: string, chatId: string): Promise<void> {
  await apiFetch(serverUrl, '/api/v1/llm/chats/' + encodeURIComponent(chatId), { method: 'DELETE' });
}

export async function clearCurrentLLMChat(serverUrl: string): Promise<void> {
  await apiFetch(serverUrl, '/api/v1/llm/chats/current', { method: 'DELETE' });
}

/** Extract role/content pairs from a stored Open WebUI chat row. */
export function storedChatTurns(row: LLMChatRow | null | undefined): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  const msgs = row?.chat?.messages;
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      const role = m?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      let content = m?.content;
      if (Array.isArray(content)) {
        content = content.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
      }
      if (typeof content !== 'string' || !content.trim()) continue;
      out.push({ role: role as 'user' | 'assistant', content });
    }
    return out;
  }
  const hist = row?.chat?.history?.messages;
  if (hist && typeof hist === 'object') {
    const entries = Object.values(hist);
    for (const m of entries) {
      const role = m?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      let content = m?.content;
      if (Array.isArray(content)) {
        content = content.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
      }
      if (typeof content !== 'string' || !content.trim()) continue;
      out.push({ role: role as 'user' | 'assistant', content });
    }
  }
  return out;
}

/** Friendly short model label for the dialog status line. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return 'no model';
  const tail = model.split(/[\\/]/).pop() ?? model;
  return tail.replace(/\.gguf$/i, '');
}
