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
}

export interface LLMChatOptions {
  model?: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
  use_tools?: boolean;
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
): Promise<ExtractedAlbum[]> {
  const res = await apiFetch<{ data: { albums: ExtractedAlbum[] } }>(
    serverUrl, '/api/v1/llm/extract-albums', { method: 'POST', body: { url } },
  );
  return res.data?.albums ?? [];
}

export async function extractAlbumsFromText(
  serverUrl: string,
  text: string,
): Promise<ExtractedAlbum[]> {
  const res = await apiFetch<{ data: { albums: ExtractedAlbum[] } }>(
    serverUrl, '/api/v1/llm/extract-albums', { method: 'POST', body: { text } },
  );
  return res.data?.albums ?? [];
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

/** Friendly short model label for the dialog status line. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return 'no model';
  const tail = model.split(/[\\/]/).pop() ?? model;
  return tail.replace(/\.gguf$/i, '');
}
