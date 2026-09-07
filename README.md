# Clautero

Embed [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — or Codex, OpenCode, and Pi — into Zotero — like [Claudian](https://github.com/YishenTu/claudian) for Obsidian, but for your research library.

![Zotero 7–10](https://img.shields.io/badge/Zotero-7%20%E2%80%93%2010-green)
![License](https://img.shields.io/badge/license-MIT-blue)

![Clautero Screenshot](docs/screenshot.png)

## What is Clautero?

Clautero is **not** a third-party Claude client. It embeds Claude Code — Anthropic's official CLI tool — directly into Zotero's interface. Claude Code handles all the intelligence: API calls, tool use, file access, permissions, and skills. Clautero provides the UI.

```
You (Zotero) → Clautero (UI) → Claude Code CLI (Anthropic) → Claude API
```

## Features

- **Side panel chat** — Claudian-style UI in Zotero's right pane with markdown rendering
- **Paper context** — Select a paper and Claude gets its metadata, abstract, PDF path, and annotations
- **Collection context** — Select a folder and Claude knows about all papers in it
- **Slash commands** — Type `/` to see available commands from both Clautero and Claude Code skills
- **Multi-session tabs** — Unlimited chats with numbered tabs `[1] [2] [3]`; up to 5 warm Claude processes at a time
- **Session persistence** — Conversations auto-save and restore across Zotero restarts
- **Chat history** — Browse, search, pin, and rename past conversations via the `⧗` button
- **Model selection** — Per-session model via a popup menu (Sonnet / Opus / Haiku / Fable for Claude; "Auto" for providers that manage their own default); new tabs start on your last pick
- **Thinking level** — Popup menu with Low / Medium / High / Ultra (maps to `--effort`)
- **YOLO mode** — Toggle to bypass all permission checks (like Claudian)
- **Context usage** — Shows token usage % after each response
- **Sidenav icon** — always-visible chat bubble in the right sidebar
- **Follows you into the PDF reader** — the same chat (sessions intact) appears in the reader tab's context pane, with the open paper as context
- **Zero-setup CLI discovery** — finds your `claude` binary automatically (Homebrew, ~/.local/bin, volta/asdf/nvm/fnm, Windows installs); manual path only as fallback
- **Multiple providers** — each session tab can run **Claude**, **Codex**, **OpenCode**, or **Pi** (click the provider name in the status bar for a menu of all providers — installed ones are auto-detected, missing ones shown grayed out). Non-Claude providers run one process per message and resume the conversation by session id; their model defaults to your CLI's own configuration ("auto"). Override a CLI path with the `extensions.clautero.cliPath.<provider>` preference.
- **Unlimited session tabs** — tabs are no longer capped at 5; only warm Claude processes are limited (LRU-cooled and resumed transparently)
- **Esc to interrupt** — stop a running turn; the conversation resumes with the next message
- **Session status dots** — each tab shows running / needs-input / error state
- **Tab restore** — the full tab workspace (including Claude session ids) is restored on restart
- **Turn timing** — each successful reply shows its duration (suppressed on errors/interrupts)

## Requirements

- **Zotero 7 – 10** (tested with 10.0.1)
- **Claude Code CLI** — [installed](https://docs.anthropic.com/en/docs/claude-code) and authenticated (`claude login`)
- *(optional)* **Codex / OpenCode / Pi CLIs** — auto-detected when installed; each becomes selectable as a provider

## Installation

1. Download the latest `.xpi` from [Releases](https://github.com/waterwoods-ai/clautero/releases)
2. In Zotero: **Tools → Add-ons → gear icon → Install Add-on From File**
3. Select the `.xpi` file
4. Click the chat bubble icon in the right sidebar — the Claude CLI is auto-detected (Settings → Clautero only if detection fails)

## Settings

Open **Zotero → Settings → Clautero** to configure:

### macOS

![Settings macOS](docs/settings-mac.png)

### Windows

![Settings Windows](docs/settings-windows.png)

| Setting | macOS Example | Windows Example |
|---------|--------------|----------------|
| **Claude CLI Path** | `/Users/tom/.local/bin/claude` | `C:\Users\TomYANG\.local\bin\claude.exe` |
| **Workspace Directory** | `/Users/tom/Documents/Zotero` | `C:\Users\TomYANG\Documents\Zotero\workspace` |
| **Permission Mode** | Accept Edits / Plan Mode / Bypass All (YOLO) | Same |
| **Auto-attach Context** | ✅ Enabled | ✅ Enabled |
| **Max Context Length** | 50000 | 50000 |

> **Finding the Claude CLI path:**
> - **macOS/Linux:** Run `which claude` in Terminal
> - **Windows:** Run `where claude` in Command Prompt
>
> **Important:** The path must include the filename (`claude` or `claude.exe`), not just the directory. On Windows, avoid paths with special characters (e.g., OneDrive folders with spaces) — use a simple workspace path like `C:\Users\You\Documents\Zotero\workspace`.

### Status Bar Controls

The status bar at the bottom provides quick toggles:

| Control | Action |
|---------|--------|
| `Claude` | Popup menu of providers (Claude / Codex / OpenCode / Pi; uninstalled ones grayed out) |
| `sonnet` | Popup menu of models (sonnet / opus / haiku / fable for Claude; "Auto" elsewhere) |
| `Thinking: Low` | Popup menu of effort: Low / Medium / High / Ultra |
| `◑ 0%` | Context window usage (updates after each response) |
| `YOLO ○` | Click to toggle YOLO mode (● = on, bypasses permissions) |

### Session Controls

| Button | Action |
|--------|--------|
| `[1] [2] [3]` | Session tabs — click to switch, `×` to close |
| `⊞` | New tab |
| `✎` | New conversation (saves current to history, clears tab) |
| `⧗` | Browse chat history |

## Build from Source

```bash
git clone https://github.com/waterwoods-ai/clautero.git
cd clautero
npm install
npm run build
# Output: build/clautero-2.0.0.xpi
```

## Usage

### Getting Started

1. Click the **chat bubble icon** (●) in Zotero's right sidebar navigation
2. The Clautero chat panel opens in the item pane area (or in the reader's context pane when a PDF tab is active — the panel follows the active tab)
3. Type a message in the input field and press **Enter** to send
4. Claude Code processes your request and streams the response in real-time

### Working with Papers

- **Select a paper** in your library — its metadata (title, authors, abstract, DOI) and PDF path are automatically attached as context
- **Open a PDF** — while a reader tab is active, the paper you're reading becomes the context automatically
- **Select a collection/folder** — all papers in the folder become context, so you can ask questions across multiple papers
- The context chip appears above the input field (e.g., `📄 Smith2024.pdf` or `📁 My Collection (6 papers)`)
- Click `×` on a chip to remove the context

### Chat Interface

**Sending messages:**
- Type in the pill-shaped input field at the bottom
- Press **Enter** to send, **Shift+Enter** for a new line
- The input auto-expands as you type (up to ~40% of the panel height)

**Streaming responses:**
- *Thought for 3s* — shows in coral italic while Claude thinks, with elapsed time
- **Bold**, *italic*, `code`, and other markdown renders in real-time
- 🔧 `ToolName` ✓ — shows tool usage with a green checkmark when complete
- Code blocks render with syntax highlighting background

### Managing Sessions

- **Session tabs** `[1] [2] [3]` — each tab is an independent conversation with its own Claude instance
- **⊞** — create a new tab (tabs are unlimited; warm processes are pooled)
- **✎** — start a new conversation in the current tab (saves the current chat to history first)
- **⧗** — browse past conversations from chat history
- Sessions **auto-save** after each Claude response and persist across Zotero restarts

### Status Bar

The bottom bar provides quick controls:

- **Click the provider name** (e.g., `Claude`) for the provider menu — switching on a tab with an existing conversation opens a new tab
- **Click the model name** (e.g., `sonnet`) for the model menu
- **Click `Thinking: Low`** for the effort menu (Low / Medium / High / Ultra)
- **◑ N%** shows context window usage after each response
- **Click `YOLO`** to toggle bypass permissions mode (red ● = on)

### Slash Commands

Type `/` in the input to see a dropdown of all available commands:

**Built-in Clautero commands:**
- `/summarize` — summarize the attached paper
- `/explain [topic]` — explain a concept in context
- `/related` — suggest related papers
- `/annotate` — extract annotations by theme
- `/clear` — clear conversation
- `/help` — list commands

**Claude Code skills** are also available — any skill installed in `~/.claude/skills/` appears in the dropdown and is handled natively by Claude Code.

## Architecture

Clautero spawns the provider CLI as a subprocess using Gecko's native `Subprocess.jsm`, communicating via each CLI's JSONL streaming protocol. Claude runs as one long-lived process per session; Codex/OpenCode/Pi run one process per message and resume by session id. Every provider's events are normalized into one chunk model, so the renderer, status machinery, warm pool, and persistence are provider-agnostic.

```
User Input → InputController → ClauteroService → Subprocess.jsm
                                                      ↓
Chat UI ← MessageRenderer ← StreamController ← NDJSONParser ← Claude CLI
                                                      (--model, --effort, --permission-mode)
```

### Project Structure

```
src/
├── index.ts                    # Entry point
├── addon.ts                    # Plugin metadata & directories
├── hooks.ts                    # Lifecycle, sessions, slash commands, status bar
├── core/
│   ├── agent/
│   │   ├── ClauteroService.ts      # Session orchestration (persistent + per-turn modes)
│   │   ├── SubprocessManager.ts    # Gecko Subprocess.jsm wrapper (augmented PATH)
│   │   ├── NDJSONParser.ts         # JSONL splitter (delegates to provider parsers)
│   │   ├── MessageChannel.ts       # Message queue (persistent mode)
│   │   ├── CLIPathResolver.ts      # Per-provider CLI discovery + login-shell fallback
│   │   ├── CLIPathCandidates.ts    # Well-known binary locations, PATH augmentation
│   │   └── types.ts                # TypeScript types
│   └── providers/
│       ├── types.ts                # ProviderModule contract
│       ├── claude.ts               # Claude Code (persistent stream-json)
│       ├── codex.ts                # OpenAI Codex (per-turn, exec --json)
│       ├── opencode.ts             # OpenCode (per-turn, run --format json)
│       ├── pi.ts                   # Pi (per-turn, --mode json)
│       └── registry.ts             # Provider roster
├── modules/
│   ├── sidebar/
│   │   ├── SidebarManager.ts       # Panel UI, follows library ↔ reader tabs
│   │   ├── PaneLocator.ts          # Active-pane resolution (item pane / context pane)
│   │   ├── PopupMenu.ts            # Provider/model/effort selection menus
│   │   └── TextareaSizing.ts       # Reflow-free composer auto-grow
│   ├── chat/
│   │   ├── ChatState.ts            # Immutable conversation state
│   │   ├── InputController.ts      # Keyboard handling
│   │   ├── MessageRenderer.ts      # Markdown rendering (code-aware)
│   │   ├── MarkdownSegments.ts     # Code-aware markdown tokenizer
│   │   ├── ModelSelection.ts       # Per-session model persistence
│   │   └── StreamController.ts     # Chunk routing, turn timing, interrupts
│   ├── sessions/
│   │   ├── WarmPool.ts             # LRU pool for warm subprocesses
│   │   ├── SessionLayout.ts        # Tab-workspace persistence
│   │   └── SessionStatus.ts        # Per-tab status precedence
│   ├── history/
│   │   ├── HistoryPanel.ts         # Search / pin / rename UI
│   │   └── HistoryQuery.ts         # History filtering and ordering
│   ├── context/
│   │   ├── ContextBuilder.ts       # Item/collection → XML context
│   │   ├── ReaderItem.ts           # Open-PDF → parent paper resolution
│   │   └── ContextChipsView.ts     # Context chip UI
│   └── commands/
│       └── builtInCommands.ts      # Slash command definitions
addon/
├── bootstrap.js                # Plugin lifecycle
├── manifest.json               # Zotero plugin manifest
├── prefs.js                    # Default preferences
└── content/
    ├── preferences.xhtml       # Settings UI
    └── icons/                  # Plugin icons
```

## License

MIT

## Credits

- Inspired by [Claudian](https://github.com/YishenTu/claudian) (Claude Code for Obsidian)
- Built with [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) patterns
- Powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
