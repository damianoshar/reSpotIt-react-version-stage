# Experimental features (backup workspace)

These changes live in the `*-clean-backup-2` folders. The `release/` app repos
are frozen and do not contain them yet.

## Local LLM assistant (Open WebUI + llama-server)

### Architecture

```
Android / web UI
      |
      |  JWT (existing server session)
      v
FastAPI  /api/v1/llm/*          <- new, additive
      |
      |  Bearer sk-... (server-side only)
      v
Open WebUI  :3000
      |
      v
llama-server  :8080  (native CUDA build, OpenAI-compatible)
```

The phone never sees the Open WebUI API key. The backend resolves the model
automatically (or uses `OPENWEBUI_MODEL`), sends the library context, and
returns the assistant text plus the model's reasoning trace.

### Backend (`reSpotIt-local-server-app-clean-backup-2`)

New files:

- `server/api/services/llm_service.py` — Open WebUI client, timeouts and
  contract errors.
- `server/api/routers/llm.py` — `status`, `models`, `chat`.
- `server/tests/test_llm_service.py` — mocked tests (8 passing).

Wiring: `server/api/main.py` imports and registers the router.

Environment (on the API service):

| Variable | Default | Purpose |
|---|---|---|
| `OPENWEBUI_URL` | `http://localhost:3000` | Open WebUI base URL. In Docker: `http://host.docker.internal:3000`. |
| `OPENWEBUI_API_KEY` | empty (disabled) | Open WebUI personal access token (`sk-...`). |
| `OPENWEBUI_MODEL` | first listed model | Optional model id. |
| `LLM_TIMEOUT` | `180` | Read timeout, seconds. |

Endpoints:

- `GET /api/v1/llm/status`
- `GET /api/v1/llm/models`
- `POST /api/v1/llm/chat` — `{messages, system?, model?, temperature?, max_tokens?}`

### Frontend (`reSpotIt-react-version-clean-backup-2`)

New files:

- `src/services/LLMService.ts` — typed client for the backend proxy.
- `src/components/AIAssistantDialog.tsx` — chat dialog with quick prompts
  (describe library, suggest playlist, what to play next, blind spots).

Wiring: Tools tab -> **Open AI assistant**; `src/App.tsx` renders the dialog
and passes library stats, the loaded album sample and the current selection.

The dialog builds a compact library context (stats + up to 150 albums + selected
albums) and sends it with the system prompt. It is available in media-server
mode only; local mode shows an explanation instead.

### Run / verify

1. Start llama-server (native CUDA build):

   ```powershell
   D:\huggingface\hub\llama.cpp\build\bin\Release\llama-server.exe `
     -m "D:\huggingface\hub\Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" `
     --port 8080 --host 0.0.0.0 -c 8192 --n-gpu-layers 99 --api-key local
   ```

2. Start the Open WebUI stack (already copied to `release/OpenWebUI-stack`):

   ```powershell
   cd release/OpenWebUI-stack
   docker compose up -d
   ```

   Open WebUI: `http://localhost:3000`. Its OpenAI connection points at
   `http://host.docker.internal:8080/v1` with key `local`.

3. Run the FastAPI backend natively for development:

   ```powershell
   cd release/reSpotIt-local-server-app-clean-backup-2/server
   $env:DATABASE_URL="sqlite:///./dev.db"
   $env:JWT_SECRET="dev-secret-change-me"
   $env:OPENWEBUI_URL="http://localhost:3000"
   $env:OPENWEBUI_API_KEY="sk-..."
   py -3.12 -m uvicorn api.main:app --port 8000
   ```

4. Verify:

   ```powershell
   curl http://localhost:8000/api/v1/llm/status -H "Authorization: Bearer <jwt>"
   ```

   Then open the app in media-server mode, Tools -> AI assistant.

### Verified in this session

- Open WebUI sees the Qwen model through its OpenAI connection.
- `GET /api/v1/llm/status` returns `available: true`, 1 model.
- `POST /api/v1/llm/chat` returned `route ok` through the full
  FastAPI -> Open WebUI -> llama-server chain.
- React: `npx tsc --noEmit`, `npm test` (57 tests) and `npm run build` pass.

### Known limitations

- Non-streaming: the dialog waits for the whole answer.
- Qwen is a thinking model; `reasoning_content` is shown in a collapsible
  block. If `max_tokens` is exhausted by reasoning, `content` can be empty.
- Chat history is per-dialog session only. Open WebUI's own conversation
  history is not used yet.
- No Kotlin UI yet; the backend endpoints are ready for it.
- The Open WebUI stack is a copied experimental stack in `release/OpenWebUI-stack`,
  not part of the app repos.

### Planned next

1. Stream tokens (`stream: true`) end to end.
2. Use Open WebUI conversations (`/api/v1/chats`) for persistent history.
3. Kotlin `LLMService` + AI screen.
4. Feature actions: duplicate explanation, metadata enrichment, playlist
   description, report generation, batch reorganisation, auto-tagging.
5. Optional on-device small model for local mode.

## Spotify MCP server (OpenWebUI-stack)

Local Spotify MCP server run as a Docker service behind nginx, connected to
Open WebUI for chat-driven Spotify control. Lives in `release/OpenWebUI-stack`
(the four app repos stay frozen).

### Service

- Image `node:22-alpine`, package `@novalux12/spotify-mcp@3.1.1` (PKCE, only
  `SPOTIFY_CLIENT_ID` required, native `SPOTIFY_MCP_TRANSPORT=http`).
- Streamable HTTP on `:8000/mcp`, bearer auth (`MCP_API_KEY`).
- Tool surface trimmed to 32 (core minus following/library/playlists/etc.); widen
  at runtime via `enable_toolset`. Max sessions 16.
- Tokens seeded from host auth into gitignored `./spotify-mcp-data`.

### Nginx

- Upstream `spotify_mcp` -> `spotify-mcp:8000`.
- `:443` `/spotify-mcp/` for external/testing access.
- Plain-HTTP listener on `:8082` for container-to-container (Host rewritten to
  `127.0.0.1` to satisfy the server's DNS-rebinding check).

### Environment (.env, gitignored)

- `SPOTIFY_CLIENT_ID=386e37553a3b492f9381ad44084d9251` (user-provided; redirect
  URI `http://127.0.0.1:8888/callback` must be registered in the Spotify app).
- `MCP_API_KEY=3c5fa4f8...` (random 48-hex bearer token).

### OpenWebUI connection (admin UI)

Settings -> Admin -> Integrations -> External Tool Servers -> + Add Connection:
- Type: MCP (Streamable HTTP)
- URL: `http://nginx-proxy:8082/spotify-mcp/mcp`
- Auth: Bearer, Key = `MCP_API_KEY` value

### Verified

- Service healthy; `spotify_doctor` 12 checks, no failures (Premium account).
- `get_now_playing` returns real Spotify data.
- Full path test from `open-webui-2` container -> nginx :8082 -> spotify-mcp returns
  200 with 32 tools.

## MCP in the AI assistant (experimental feature)

The React AI assistant now drives Spotify through the MCP server instead of just
chatting about the library:

- Backend `llm_service.chat()` runs an OpenAI function-calling loop: it fetches
  the (curated, 10-tool) Spotify tool set from the MCP server, sends it to the
  model, executes any `tool_calls` against MCP, feeds results back, and returns
  the final answer plus a `tool_calls` log.
- New `server/api/services/mcp_service.py` — stateless Streamable HTTP MCP
  client (requests-based) with `list_tools()` (OpenAI format) and `call_tool()`.
- Env: `SPOTIFY_MCP_URL`, `SPOTIFY_MCP_TOKEN`, `MCP_TOOLS` (allowlist or `all`).
- Router: `LLMChatBody.use_tools` (default true); response includes `tool_calls`.
- Frontend: `LLMChatResult.tool_calls`; AIAssistantDialog renders a collapsible
  "Spotify tools used" block per assistant message. MCP status shown in
  `/api/v1/llm/status` (`mcp_configured`, `mcp_tools`).
- Verified end-to-end: model called `get_now_playing` and reported
  "Nothing is currently playing." with the tool result attached.
