# Clautero

A Zotero plugin that embeds [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as a sidebar AI research assistant — like [Claudian](https://github.com/YishenTu/claudian) for Obsidian, but for Zotero.

![Zotero 7/8](https://img.shields.io/badge/Zotero-7%20%7C%208-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Side panel chat** — Claude Code runs as a subprocess inside Zotero's item pane, with a Claudian-style UI
- **Paper context** — Select a paper and Claude automatically gets its title, authors, abstract, DOI, PDF path, and annotations
- **Collection context** — Select a folder and Claude knows about all papers in it
- **Markdown rendering** — Claude's responses render with proper formatting (bold, code blocks, headers, lists)
- **Multi-session tabs** — Up to 5 concurrent chat sessions with numbered tabs
- **Keyboard shortcut** — `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Windows/Linux) to toggle

## Screenshots

| Chat with paper context | Collection context |
|---|---|
| Select a paper → ask questions about it | Select a folder → ask about all papers |

## Requirements

- **Zotero 7 or 8**
- **Claude Code CLI** — installed and authenticated (`claude login`)

## Installation

1. Download the latest `clautero-x.x.x.xpi` from [Releases](https://github.com/tom/clautero/releases)
2. In Zotero: **Tools → Add-ons → gear icon → Install Add-on From File**
3. Select the `.xpi` file
4. The Clautero icon (chat bubble) appears in the right sidebar nav

## Build from Source

```bash
git clone https://github.com/tom/clautero.git
cd clautero
npm install
npm run build
# Output: build/clautero-0.2.0.xpi
```

## Usage

1. Click the **chat bubble icon** in Zotero's right sidebar nav
2. The Clautero panel opens in the item pane area
3. **Select a paper** — its metadata and PDF are automatically attached as context
4. **Select a folder** — all papers in the collection become context
5. Type a message and press **Enter** to send
6. Use **[+]** to create new chat sessions (up to 5), click **×** to close

### Keyboard Shortcut

`Cmd+Shift+C` / `Ctrl+Shift+C` — toggle the chat panel

### Example Prompts

- "Summarize this paper"
- "What are the key findings?"
- "Translate the abstract to Chinese"
- "Compare the methodologies across all papers in this collection"
- "What are the common themes in these papers?"

## Architecture

Clautero spawns Claude Code as a subprocess using Gecko's native `Subprocess.jsm`, communicating via the NDJSON streaming protocol (`--input-format stream-json --output-format stream-json`).

```
User Input → InputController → ClauteroService → Subprocess.jsm
                                                      ↓
Chat UI ← MessageRenderer ← StreamController ← NDJSONParser ← Claude CLI
                                                      (reads PDFs via absolute paths)
```

### Key Design Decisions

- **Gecko/SpiderMonkey runtime** — Zotero runs on Gecko, not Electron. No Node.js APIs. Uses `Subprocess.jsm` for process spawning, `IOUtils`/`PathUtils` for file I/O
- **Sidenav icon injection** — Directly injects a button into Zotero's `item-pane-sidenav` element
- **Overlay panel** — Chat panel overlays the item pane content using `position:absolute`, keeping the sidenav visible and Zotero's internal state undisrupted
- **Inline styles** — All styling is inline (no external CSS) for Gecko XHTML compatibility
- **No `innerHTML`** — All DOM manipulation uses `createElementNS` + `textContent` for security in chrome-privileged XHTML context

### Project Structure

```
src/
├── index.ts                    # Entry point
├── addon.ts                    # Plugin metadata & directories
├── hooks.ts                    # Lifecycle hooks & session management
├── core/agent/
│   ├── ClauteroService.ts      # Orchestrates subprocess + parser
│   ├── SubprocessManager.ts    # Gecko Subprocess.jsm wrapper
│   ├── NDJSONParser.ts         # Stream JSON parser
│   ├── MessageChannel.ts       # Message queue with single-turn enforcement
│   ├── CLIPathResolver.ts      # Claude CLI path resolution
│   ├── ToolApprovalManager.ts  # Tool use approval/denial
│   └── types.ts                # TypeScript types
├── modules/
│   ├── sidebar/
│   │   └── SidebarManager.ts   # Claudian-style UI + sidenav injection
│   ├── chat/
│   │   ├── ChatState.ts        # Immutable conversation state
│   │   ├── InputController.ts  # Keyboard handling + hooks
│   │   ├── MessageRenderer.ts  # Markdown rendering + DOM
│   │   └── StreamController.ts # Chunk routing + phase tracking
│   ├── context/
│   │   ├── ContextBuilder.ts   # Item/collection → XML context
│   │   ├── ContextChipsView.ts # Context chip UI
│   │   ├── ZoteroItemExtractor.ts
│   │   └── AnnotationExtractor.ts
│   ├── commands/               # Slash commands (/summarize, etc.)
│   ├── mention/                # @-mention system
│   ├── vision/                 # Image drag-drop/paste
│   ├── tabs/                   # Session persistence
│   └── settings/               # Preference manager
addon/
├── bootstrap.js                # Plugin lifecycle
├── manifest.json               # Zotero plugin manifest
├── prefs.js                    # Default preferences
├── locale/en-US/addon.ftl      # Fluent localization
└── content/icons/chat.svg      # Sidenav icon
```

## Configuration

In Zotero **Preferences → Clautero**:

| Setting | Default | Description |
|---------|---------|-------------|
| Claude CLI Path | (auto-detect) | Absolute path to the `claude` binary |
| Auto-attach Context | `true` | Automatically attach selected item/collection context |
| Max Context Length | `50000` | Maximum characters for context sent to Claude |

## License

MIT

## Credits

- Inspired by [Claudian](https://github.com/YishenTu/claudian) (Claude Code for Obsidian)
- Built with [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) patterns
- Uses [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by Anthropic
