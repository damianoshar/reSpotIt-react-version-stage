# Reuse Guide — Dashboard With Filters, Export, and Sync

Portable knowledge from this project. The OpenCode skills live in `~/.opencode/skills/` and are loadable by id in any session.

## Skills
| Skill id | Covers |
|---|---|
| `spotify-dashboard-architecture` | Overall multi-repo architecture, contract, dual-mode, ports, DBs |
| `oauth-pkce-process-death` | OAuth PKCE surviving process death (Kotlin + Capacitor/WebView) |
| `android-low-spec-compat` | Android 9 / low-RAM compatibility |
| `capacitor-phone-build` | Capacitor phone build rule + asset sync |
| `frontend-client-patterns` | Frontend patterns (React/Vite/Capacitor/Compose/Electron, parity) |
| `dashboard-filters-export-sync` | Dashboard (filters, views, stats, export, sync) |
| `backend-elixir-phoenix` | Elixir/Phoenix backend patterns |
| `backend-csharp-aspnet` | C#/.NET 8 backend patterns |
| `backend-python-fastapi` | Python/FastAPI backend patterns |
| `ops-deploy-ports` | Ports, DBs, Docker, launch/test recipes, destructive-op rules |
| `multi-repo-git-parity` | Multi-repo branch/merge/push discipline |
| `mishap-troubleshooting` | Catalog of real mishaps and fixes |

Umbrella guide with ports/endpoints/branch map: `../REUSE_GUIDE.md` (shared workspace).

## Phone build rule
`.env` is inlined at build. After any web change: `npm run sync` then rebuild/reinstall. Verify the `index-*.js` hash inside the APK matches `dist/`.

## Auth rule (process death)
Persist the PKCE verifier before launching the browser (`localStorage`), parse the callback URI directly, validate `state`, TTL 30 min, clear on success/logout/failure. Cold-start via `App.getLaunchUrl()` + `appUrlOpen`.

## Mishap quick table
| Symptom | Root cause | Fix |
|---|---|---|
| Green screen on launch | `setContent` inside `else` | Unconditional `setContent` |
| "No pending auth request" | PKCE only in memory | Persist + parse URI |
| Deep link never fires | Listener too late / missing intent filter | Register at boot; verify manifest |
| Stale web assets in APK | Built without `npm run sync` | Sync, verify hash |
| Signature mismatch | Different keystore | Uninstall or align keystores |
| Cleartext blocked | API 28 default | `network_security_config` |
| 10s+ cold start | Debug build / main-thread work | Release build; lazy init |
| OOM / ANR | BODY logging, large result sets | BASIC logging; paginate |

## Navigation parity
Bottom tabs everywhere: Library, Playlists, Stats, Settings. Settings owns backup + server actions.
