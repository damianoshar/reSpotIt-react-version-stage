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

/** Friendly short model label for the dialog status line. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return 'no model';
  const tail = model.split(/[\\/]/).pop() ?? model;
  return tail.replace(/\.gguf$/i, '');
}
