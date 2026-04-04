# Clautero

Embed [Claude Code](https://docs.anthropic.com/en/docs/claude-code) into Zotero — like [Claudian](https://github.com/YishenTu/claudian) for Obsidian, but for your research library.

![Zotero 7/8](https://img.shields.io/badge/Zotero-7%20%7C%208-green)
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
- **Multi-session tabs** — Up to 5 concurrent chats with numbered tabs `[1] [2] [3]`
- **Session persistence** — Conversations auto-save and restore across Zotero restarts
- **Chat history** — Browse and reload past conversations via the `⧗` button
- **Model selection** — Click to cycle between Sonnet, Opus, Haiku
- **Thinking level** — Click to cycle Low / Medium / High / Ultra (maps to `--effort`)
- **YOLO mode** — Toggle to bypass all permission checks (like Claudian)
- **Context usage** — Shows token usage % after each response
- **Keyboard shortcut** — `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Windows/Linux) to toggle

## Requirements

- **Zotero 7 or 8**
- **Claude Code CLI** — [installed](https://docs.anthropic.com/en/docs/claude-code) and authenticated (`claude login`)

## Installation

1. Download the latest `.xpi` from [Releases](https://github.com/tom/clautero/releases)
2. In Zotero: **Tools → Add-ons → gear icon → Install Add-on From File**
3. Select the `.xpi` file
4. Open **Zotero → Settings → Clautero** and set your Claude CLI path
5. Click the chat bubble icon in the right sidebar

## Settings

Open **Zotero → Settings → Clautero** to configure:

| Setting | Description |
|---------|-------------|
| **Claude CLI Path** | Full path to the `claude` binary (e.g., `/Users/you/.local/bin/claude`). Run `which claude` in your terminal to find it. |
| **Workspace Directory** | Working directory for Claude. Leave empty for default. Claude can read/write files here. |
| **Permission Mode** | Controls what Claude can do: **Accept Edits** (default, auto-approves file edits), **Plan Mode** (read-only), **Bypass All** (YOLO, skips all checks). |
| **Auto-attach Context** | Automatically attach selected item or collection as context. |
| **Max Context Length** | Maximum characters for context sent to Claude (default: 50,000). |

### Status Bar Controls

The status bar at the bottom provides quick toggles:

| Control | Action |
|---------|--------|
| `sonnet` | Click to cycle model: sonnet → opus → haiku |
| `Thinking: Low` | Click to cycle effort: Low → Medium → High → Ultra |
| `◑ 0%` | Context window usage (updates after each response) |
| `YOLO ○` | Click to toggle YOLO mode (● = on, bypasses permissions) |

### Session Controls

| Button | Action |
|--------|--------|
| `[1] [2] [3]` | Session tabs — click to switch, `×` to close |
| `⊞` | New tab (max 5) |
| `✎` | New conversation (saves current to history, clears tab) |
| `⧗` | Browse chat history |

## Build from Source

```bash
git clone https://github.com/tom/clautero.git
cd clautero
npm install
npm run build
# Output: build/clautero-0.2.0.xpi
```

## Usage

1. Click the **chat bubble icon** in Zotero's right sidebar
2. **Select a paper** — its metadata and PDF are attached as context
3. **Select a folder** — all papers become context
4. Type a message and press **Enter** to send
5. Type `/` to see available slash commands

### Slash Commands

Type `/` in the input to see all available commands:

**Built-in:**
- `/summarize` — summarize the attached paper
- `/explain [topic]` — explain a concept in context
- `/related` — suggest related papers
- `/annotate` — extract annotations by theme
- `/clear` — clear conversation
- `/help` — list commands

**Claude Code skills** are also available — any skill installed in `~/.claude/skills/` appears in the dropdown and is handled natively by Claude Code.

## Architecture

Clautero spawns Claude Code as a subprocess using Gecko's native `Subprocess.jsm`, communicating via the NDJSON streaming protocol.

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
├── core/agent/
│   ├── ClauteroService.ts      # Orchestrates subprocess + parser
│   ├── SubprocessManager.ts    # Gecko Subprocess.jsm wrapper
│   ├── NDJSONParser.ts         # NDJSON stream parser
│   ├── MessageChannel.ts       # Message queue
│   ├── CLIPathResolver.ts      # CLI path from preferences
│   └── types.ts                # TypeScript types
├── modules/
│   ├── sidebar/SidebarManager.ts   # Claudian-style UI + sidenav icon
│   ├── chat/
│   │   ├── ChatState.ts            # Immutable conversation state
│   │   ├── InputController.ts      # Keyboard handling
│   │   ├── MessageRenderer.ts      # Markdown rendering
│   │   └── StreamController.ts     # Chunk routing
│   ├── context/
│   │   ├── ContextBuilder.ts       # Item/collection → XML context
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
