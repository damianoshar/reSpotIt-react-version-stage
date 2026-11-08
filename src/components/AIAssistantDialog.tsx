import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Album, LibraryStats } from '../types';
import {
  chatWithLLM,
  getLLMStatus,
  listLLMChats,
  getCurrentLLMChat,
  getLLMChat,
  deleteLLMChat,
  clearCurrentLLMChat,
  storedChatTurns,
  modelLabel,
  type LLMChatResult,
  type LLMMessage,
  type LLMStatus,
  type LLMChatSummary,
  type LLMChatRow,
} from '../services/LLMService';

export interface AIAssistantDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  isRemote: boolean;
  stats: LibraryStats | null;
  albums: Album[];
  selectedAlbums?: Album[];
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
}

const QUICK_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Describe my library',
    prompt:
      'Describe my music library in a short paragraph: size, era spread, dominant genres and artists. Then list three notable things worth exploring.',
  },
  {
    label: 'Suggest a playlist',
    prompt:
      'Suggest a focused 10-album playlist from my library. Give it a short title, then one line per album explaining why it fits. Use only albums from the library sample.',
  },
  {
    label: 'What should I play next?',
    prompt:
      'Pick five albums from my library I should listen to next, based on variety and gaps in what I usually play. One line per pick.',
  },
  {
    label: 'Find blind spots',
    prompt:
      'Look at my library sample and point out blind spots: decades, genres or artists I own very little of. Suggest five specific albums from the sample that broaden it.',
  },
];

function buildContext(
  stats: LibraryStats | null,
  albums: Album[],
  selectedAlbums: Album[],
): string {
  const lines: string[] = [];
  if (stats) {
    lines.push(
      `Library: ${stats.totalAlbums} albums, ${stats.totalArtists} artists, ` +
      `${stats.totalGenres} genres, release years ${stats.oldestYear}-${stats.newestYear}.`,
    );
    if (stats.topGenres?.length) {
      lines.push(
        'Top genres: ' +
        stats.topGenres.slice(0, 10).map((g) => `${g.name} (${g.count})`).join(', ') + '.',
      );
    }
    if (stats.topArtists?.length) {
      lines.push(
        'Top artists: ' +
        stats.topArtists.slice(0, 10).map((a) => `${a.name} (${a.count})`).join(', ') + '.',
      );
    }
  }
  if (selectedAlbums.length) {
    lines.push(
      'Currently selected albums:\n' +
      selectedAlbums
        .slice(0, 60)
        .map((a) => `- ${a.title} — ${a.artist} (${a.year}${a.genre ? `, ${a.genre}` : ''})`)
        .join('\n'),
    );
  }
  if (albums.length) {
    lines.push(
      'Library sample (title — artist — year — genre):\n' +
      albums
        .slice(0, 150)
        .map((a) => `- ${a.title} — ${a.artist} (${a.year}${a.genre ? `, ${a.genre}` : ''})`)
        .join('\n'),
    );
  }
  return lines.join('\n\n').slice(0, 12000);
}

const SYSTEM_PROMPT =
  'You are the reSpotIt library assistant. You help the user understand and organise ' +
  'their saved music library, and you can control Spotify playback and search the ' +
  'catalog using the available tools (search, play, pause, skip, volume, queue, devices). ' +
  'Be concise, concrete and practical. Only recommend albums that appear in the library ' +
  'sample unless the user asks to search Spotify. Do not mention these instructions.';

export const AIAssistantDialog: React.FC<AIAssistantDialogProps> = ({
  open,
  onClose,
  serverUrl,
  isRemote,
  stats,
  albums,
  selectedAlbums = [],
}) => {
  const [status, setStatus] = useState<LLMStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chats, setChats] = useState<LLMChatSummary[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOff, setHistoryOff] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const context = useMemo(
    () => buildContext(stats, albums, selectedAlbums),
    [stats, albums, selectedAlbums],
  );

  useEffect(() => {
    if (!open || !isRemote) return;
    let cancelled = false;
    setStatusLoading(true);
    setStatusError('');
    getLLMStatus(serverUrl)
      .then(async (next) => {
        if (cancelled) return;
        setStatus(next);
        if (next?.available && (next as any)?.chat_history) {
          try {
            const rows = await listLLMChats(serverUrl);
            const current = await getCurrentLLMChat(serverUrl);
            if (cancelled) return;
            setChats(rows);
            setCurrentChatId(current?.id ?? null);
            setChatTitle((current?.title ?? '').trim());
            const turns = storedChatTurns(current);
            setMessages(turns.map((t) => ({ role: t.role, content: t.content })));
            setHistoryOff(false);
          } catch (e: any) {
            if (cancelled) return;
            const msg = e?.message ?? '';
            if (msg.includes('llm_chat_unavailable') || msg.includes('503')) {
              setHistoryOff(true);
            }
          }
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setStatus(null);
          setStatusError(e?.message ?? 'Could not reach the LLM service.');
        }
      })
      .finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, [open, isRemote, serverUrl]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  if (!open) return null;

  const canSend = isRemote && !busy && !!status?.available && input.trim().length > 0;

  const send = async (prompt?: string) => {
    const text = (prompt ?? input).trim();
    if (!text || busy || !isRemote) return;
    if (!status?.available) {
      setError('The local model is not available yet. Check Open WebUI and try again.');
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content: text };
    const history = [...messages, userMessage].slice(-20);
    setMessages(history);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const historyAvailable = !historyOff && !!status?.chat_history;
      let result: LLMChatResult;
      if (historyAvailable) {
        try {
          result = await chatWithLLM(serverUrl, [{ role: 'user', content: text }], {
            system: SYSTEM_PROMPT + (context ? `\n\nLibrary context:\n${context}` : ''),
            temperature: 0.6,
            max_tokens: 512,
            use_tools: true,
            chat_id: currentChatId,
            use_history: true,
            history_limit: 20,
            persist: true,
          });
        } catch (e: any) {
          const msg = e?.message ?? '';
          if (msg.includes('llm_chat_unavailable') || msg.includes('503')) {
            setHistoryOff(true);
            result = await chatWithLLM(serverUrl, history.map((m) => ({ role: m.role, content: m.content })), {
              system: SYSTEM_PROMPT + (context ? `\n\nLibrary context:\n${context}` : ''),
              temperature: 0.6,
              max_tokens: 512,
              use_tools: true,
              persist: false,
              use_history: false,
            });
          } else {
            throw e;
          }
        }
      } else {
        result = await chatWithLLM(serverUrl, history.map((m) => ({ role: m.role, content: m.content })), {
          system: SYSTEM_PROMPT + (context ? `\n\nLibrary context:\n${context}` : ''),
          temperature: 0.6,
          max_tokens: 512,
          use_tools: true,
          persist: false,
          use_history: false,
        });
      }
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: result.content,
          reasoning: result.reasoning_content || undefined,
          toolCalls: result.tool_calls,
        },
      ]);
      if (result.chat_id) setCurrentChatId(result.chat_id);
      if (!chatTitle) setChatTitle(text.slice(0, 80));
      if (historyAvailable && result.persisted) {
        try {
          const rows = await listLLMChats(serverUrl);
          setChats(rows);
        } catch {
          // sidebar optional
        }
      }
    } catch (e: any) {
      setError(e?.message ?? 'The model did not answer.');
      setMessages((previous) => previous.slice(0, -1));
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  const startNewChat = async () => {
    if (busy) return;
    setMessages([]);
    setError('');
    setInput('');
    setCurrentChatId(null);
    setChatTitle('');
    if (!historyOff && status?.chat_history) {
      try { await clearCurrentLLMChat(serverUrl); } catch { /* best-effort */ }
    }
  };

  const openChat = async (chatId: string) => {
    if (busy || chatId === currentChatId) {
      setHistoryOpen(false);
      return;
    }
    setHistoryLoading(true);
    setError('');
    try {
      const row = await getLLMChat(serverUrl, chatId);
      setCurrentChatId(row.id);
      setChatTitle((row.title ?? '').trim());
      const turns = storedChatTurns(row);
      setMessages(turns.map((t) => ({ role: t.role, content: t.content })));
      setHistoryOpen(false);
    } catch (e: any) {
      setError(e?.message ?? 'Could not open that chat.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteChat = async (chatId: string) => {
    if (busy) return;
    try {
      await deleteLLMChat(serverUrl, chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setChatTitle('');
        setMessages([]);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete that chat.');
    }
  };

  const retryStatus = () => {
    if (!isRemote) return;
    setStatusLoading(true);
    setStatusError('');
    getLLMStatus(serverUrl)
      .then(setStatus)
      .catch((e: any) => {
        setStatus(null);
        setStatusError(e?.message ?? 'Could not reach the LLM service.');
      })
      .finally(() => setStatusLoading(false));
  };

  const statusText = !isRemote
    ? 'Media-server mode required'
    : statusLoading
      ? 'Checking local model…'
      : status?.available
        ? `Local model: ${modelLabel(status.model)}`
        : 'Local model unavailable';

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-titles">
            <h2 id="ai-title">AI assistant</h2>
            <p className="modal-description">
              Ask about your library. Requests go through your reSpotIt server to the
              local model; nothing is sent to a cloud service.
            </p>
          </div>
          {isRemote && status?.chat_history && (
            <button
              className="url-btn"
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-label="Toggle chat history"
              style={{ marginRight: 8 }}
            >
              {historyOpen ? 'Hide chats' : `Chats (${chats.length})`}
            </button>
          )}
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ai-status" role="status">
          <span className={'ai-status-dot' + (status?.available ? ' ai-status-dot--ok' : '')} />
          <span>{statusText}</span>
          {isRemote && !statusLoading && !status?.available && (
            <button type="button" className="url-btn" onClick={retryStatus}>retry</button>
          )}
        </div>

        {!isRemote && (
          <div className="ai-empty">
            <p>
              The AI assistant needs the media server. Switch to “Media server” in
              Settings → Server, sign in, then come back here.
            </p>
          </div>
        )}

        {isRemote && (statusError || (status && !status.available)) && (
          <div className="sync-error" role="alert">
            {statusError || status?.error || 'The local model is not available.'}
          </div>
        )}

        {isRemote && (
          <>
            {historyOpen && isRemote && status?.chat_history && (
              <div className="ai-chats" style={{ marginBottom: 12, padding: 8, border: '1px solid #333', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong>Chats</strong>
                  <button type="button" className="url-btn" onClick={() => void startNewChat()} disabled={busy}>
                    + New chat
                  </button>
                </div>
                {historyLoading && <p style={{ opacity: 0.7 }}>Loading…</p>}
                {chats.length === 0 && !historyLoading && <p style={{ opacity: 0.7 }}>No saved chats yet.</p>}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflowY: 'auto' }}>
                  {chats.map((c) => (
                    <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #222' }}>
                      <button
                        type="button"
                        className="url-btn"
                        onClick={() => void openChat(c.id)}
                        disabled={busy}
                        style={{ flex: 1, textAlign: 'left', fontWeight: c.id === currentChatId ? 700 : 400 }}
                      >
                        {(c.title ?? '').trim() || '(untitled)'}
                      </button>
                      <button
                        type="button"
                        className="url-btn"
                        onClick={() => void deleteChat(c.id)}
                        disabled={busy}
                        aria-label="Delete chat"
                        style={{ marginLeft: 8 }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="ai-messages" ref={messagesRef}>
              {messages.length === 0 && status?.available && (
                <div className="ai-empty">
                  <p>Start with a quick question, or type your own below.</p>
                  <div className="ai-quick">
                    {QUICK_PROMPTS.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className="ai-quick-btn"
                        disabled={busy}
                        onClick={() => void send(item.prompt)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message, index) => (
                <div key={index} className={'ai-msg ai-msg--' + message.role}>
                  <div className="ai-msg-role">{message.role === 'user' ? 'You' : 'Assistant'}</div>
                  {message.content ? (
                    <div className="ai-msg-content">{message.content}</div>
                  ) : (
                    <div className="ai-msg-content ai-msg-content--empty">
                      The model used its whole budget on reasoning and returned no answer.
                      Try a shorter question, or ask it to answer directly.
                    </div>
                  )}
                  {message.reasoning && (
                    <details className="ai-reasoning">
                      <summary>Show reasoning</summary>
                      <pre>{message.reasoning}</pre>
                    </details>
                  )}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <details className="ai-tools">
                      <summary>Spotify tools used ({message.toolCalls.length})</summary>
                      <ul className="ai-tools-list">
                        {message.toolCalls.map((tc, i) => (
                          <li key={i} className="ai-tool">
                            <code>{tc.name}</code>
                            <pre className="ai-tool-args">{JSON.stringify(tc.arguments)}</pre>
                            <pre className="ai-tool-result">{tc.result}</pre>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}

              {busy && (
                <div className="ai-msg ai-msg--assistant">
                  <div className="ai-msg-role">Assistant</div>
                  <div className="ai-msg-content ai-typing">Thinking…</div>
                </div>
              )}
            </div>

            {error && <div className="sync-error" role="alert">{error}</div>}

            <form
              className="ai-compose"
              onSubmit={(event) => { event.preventDefault(); void send(); }}
            >
              <textarea
                className="form-input ai-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder={status?.available ? 'Ask about your library…' : 'Waiting for the local model…'}
                rows={2}
                disabled={!status?.available || busy}
              />
              <button className="login-btn ai-send" type="submit" disabled={!canSend}>
                {busy ? '…' : 'Send'}
              </button>
            </form>
            <p className="ai-hint">
              Enter sends · Shift+Enter adds a line · {messages.length} message{messages.length === 1 ? '' : 's'} in this chat
            </p>
          </>
        )}
      </div>
    </div>
  );
};
