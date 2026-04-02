---
title: "feat: Zotero plugin embedding Claude Code as sidebar AI research assistant"
type: feat
status: completed
date: 2026-04-02
deepened: 2026-04-02
---

# feat: Zotero Plugin Embedding Claude Code as Sidebar AI Research Assistant (Clautero)

## Overview

Build a Zotero 7 plugin ("Clautero") that embeds Claude Code as a sidebar chat interface, mirroring the Claudian plugin's approach for Obsidian. Claude Code runs as a subprocess with full agentic capabilities — reading PDFs, annotations, notes, and metadata from the user's Zotero library — while providing a rich chat UI for research workflows.

## Problem Frame

Researchers using Zotero lack an integrated AI assistant that can understand their library in context. Existing Zotero AI plugins (Aria, PapersGPT, BibGenie) use direct API calls, losing Claude Code's agentic capabilities (file read/write, bash commands, tool use, MCP integration). Claudian proved this model works beautifully for Obsidian — Clautero brings the same paradigm to Zotero's research-focused environment.

## Requirements Trace

- R1. Sidebar chat panel in Zotero's main window with streaming response display
- R2. Claude Code CLI subprocess management via Gecko's `Subprocess.jsm` with NDJSON streaming protocol
- R3. Auto-attach selected item's PDF, metadata, and annotations to conversation context
- R4. @-mention system for referencing Zotero items, collections, and files
- R5. Slash command system with built-in commands (/summarize, /explain, /related, /clear) and user-defined templates
- R6. Vision support for figures and images via drag-and-drop or paste
- R7. Multi-conversation tabs with session persistence
- R8. Zotero 7 compatibility with forward-compatible design for Zotero 8

## Scope Boundaries

- **In scope**: Chat sidebar, Claude Code subprocess, PDF/annotation context, @-mentions, slash commands, vision, conversation tabs, basic settings UI
- **Not in scope**: Direct Zotero database writes (creating items, modifying metadata via Claude), Zotero Sync integration, mobile support, citation generation, custom MCP servers for Zotero data (v2 consideration)
- **Not in scope**: Zotero item pane section (only sidebar chat for v1)

## Context & Research

### Relevant Code and Patterns

- **windingwind/zotero-plugin-template**: Bootstrap architecture, esbuild build system, manifest.json format, lifecycle hooks (startup/shutdown/onMainWindowLoad/onMainWindowUnload)
- **Claudian (YishenTu/claudian)**: SDK-first architecture (Electron/Node.js — NOT applicable to Gecko). Valuable patterns: `MessageChannel` queue, `StreamController` for response routing, tab-based multi-conversation UI, context attachment via XML suffixes
- **Zotero 7 APIs**: `Zotero.ItemPaneManager.registerSection()` for item pane, DOM injection for custom panels, `Zotero.Reader.registerEventListener()` for PDF reader integration
- **zotero-plugin-toolkit**: UI helpers (Menu, Dialog, Keyboard, ProgressWindow), preference management

### Key Technical Constraints

- **Gecko runtime, NOT Node.js**: Zotero 7 runs on Gecko/SpiderMonkey, not Electron/Node.js. No `child_process`, no `require()`, no `fs`. Must use Gecko APIs: `Subprocess.jsm` for process spawning, `IOUtils`/`PathUtils` for file I/O, `ChromeWorker` for off-main-thread work
- **Claude Agent SDK is incompatible**: `@anthropic-ai/claude-agent-sdk` requires Node.js 18+ (`child_process.spawn`). Cannot run in Gecko. Must spawn Claude CLI directly via `Subprocess.jsm` with `--output-format stream-json` and parse NDJSON manually
- Zotero 7 is XHTML-based — no React, no modern web framework. UI must be plain TypeScript + DOM manipulation
- Zotero 7 has NO standalone sidebar panel API — custom sidebar must be injected via DOM manipulation. Fallback: `Zotero.ItemPaneManager.registerSection()` if DOM injection proves too fragile for Zotero 8
- Claude Code CLI path resolution is critical in GUI app contexts (no reliable PATH inheritance)
- Zotero's data directory structure: `<profile>/zotero/storage/<key>/` for stored attachments, but linked attachments can be anywhere on disk. Must use `item.getFilePath()` for absolute paths
- **DOM security**: Zotero's main window is chrome-privileged XHTML. Injected HTML executes with full system privileges. NEVER use `innerHTML` for Claude response content — use `textContent`/`createTextNode` + DOMPurify for markdown
- **Main-thread blocking**: Subprocess I/O must be async. Gecko's `Subprocess.jsm` provides async I/O natively, but all processing must avoid blocking the main thread

### External References

- [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- [Claudian source](https://github.com/YishenTu/claudian)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)

## Key Technical Decisions

- **Raw subprocess via Gecko's `Subprocess.jsm`**: The Claude Agent SDK requires Node.js and cannot run in Gecko's SpiderMonkey engine. Spawn the Claude CLI directly using `Subprocess.jsm` with `--input-format stream-json --output-format stream-json -p` flags and parse NDJSON responses manually. Implement our own `MessageChannel` queue and streaming parser. Rationale: only viable approach in Gecko runtime. The NDJSON protocol is well-documented and stable.

- **DOM injection for sidebar with ItemPaneManager fallback**: Inject a custom splitter pane into the main window layout during `onMainWindowLoad`. If DOM injection proves too fragile for Zotero 8, fall back to `Zotero.ItemPaneManager.registerSection()` for an item-pane-based chat experience. Add a DOM injection spike early in Unit 2 to validate the approach before downstream units depend on it. Rationale: only viable approach for a persistent sidebar; fallback ensures forward compatibility.

- **Plain TypeScript + DOM for UI with strict XSS prevention**: No framework. Build chat UI with TypeScript and direct DOM manipulation. Critical: Zotero's main window is chrome-privileged XHTML — injected HTML executes with full system privileges. NEVER use `innerHTML` for Claude response content. Use `textContent`/`createTextNode` for text, DOMPurify for sanitized markdown rendering. Rationale: security is paramount in chrome-privileged context.

- **Sandboxed working directory with absolute file paths**: Set `cwd` to `<zotero-data>/clautero/workspace/` (not the full Zotero data directory). Pass absolute file paths from `item.getFilePath()` for PDF access. This supports both stored and linked attachments while limiting Claude's write scope. Rationale: the full data directory contains `zotero.sqlite` and all attachments — too broad for an agentic subprocess.

- **Tool-use guardrails**: Implement a tool approval callback that auto-approves Read operations on attached files, prompts for confirmation on Write/Bash operations, and denies operations outside the workspace. Rationale: Claude processes untrusted content (PDFs from the internet) and indirect prompt injection is a realistic threat.

- **Session storage in plugin data directory**: Store conversation metadata in `<zotero-data>/clautero/sessions/` with restrictive file permissions (`chmod 700`). Store only metadata (title, timestamps, linked item keys, Claude session ID), not full conversation content. Rationale: allows Zotero-specific metadata alongside conversation history without duplicating sensitive content.

- **Gecko-native file I/O**: All file operations must use `IOUtils.readJSON()`/`IOUtils.writeJSON()`/`IOUtils.readUTF8()` and `PathUtils.join()` — not Node.js `fs`. Rationale: `fs` does not exist in Gecko.

## Open Questions

### Resolved During Planning

- **How to create a sidebar in Zotero 7?**: DOM injection into the main window splitter layout. Insert a new `<splitter>` + `<vbox>` after the existing item pane. Fallback to `ItemPaneManager.registerSection()` if DOM injection proves too fragile.
- **Which subprocess mechanism?**: Gecko's `Subprocess.jsm` with direct Claude CLI invocation. The Claude Agent SDK requires Node.js and cannot run in Gecko. Parse NDJSON streaming output manually.
- **How to access PDF content?**: Use absolute paths from `item.getFilePath()` (supports both stored and linked attachments). Set CWD to sandboxed workspace directory. Pass file paths + structured metadata as context.
- **Security model?**: Sandboxed CWD, tool approval callbacks, strict DOM sanitization (no innerHTML for Claude output), CLI path validation with absolute paths.

### Deferred to Implementation

- **Exact DOM injection points**: Need to inspect Zotero 7's actual main window XHTML structure at runtime to find the right splitter insertion point. Unit 2 includes a spike for this.
- **Zotero 8 DOM compatibility**: The DOM structure may change in Zotero 8. Implementation should use resilient selectors and document any Zotero-version-specific DOM assumptions.
- **Subprocess.jsm API specifics**: Need to verify exact API surface of `Subprocess.jsm` in Zotero 7's Gecko version (read/write stdin/stdout, process lifecycle, async patterns).
- **NDJSON message types**: The stream-json protocol's message types and schemas need to be mapped by examining Claude CLI output during implementation. Types are not officially documented.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌─────────────────────────────────────────────────────────────────┐
│ Zotero Main Window (XHTML/Gecko)                                │
│ ┌──────────┬─────────────┬───┬──────────────────────────────┐   │
│ │ Library  │  Item List   │ S │  Clautero Sidebar            │   │
│ │ Tree     │              │ p │ ┌──────────────────────────┐ │   │
│ │          │              │ l │ │ Tab Bar                  │ │   │
│ │          │              │ i │ ├──────────────────────────┤ │   │
│ │          │              │ t │ │ Chat Messages            │ │   │
│ │          │              │ t │ │  - User messages         │ │   │
│ │          │              │ e │ │  - Assistant responses   │ │   │
│ │          │              │ r │ │  - Tool use indicators   │ │   │
│ │          │              │   │ │  - Thinking blocks       │ │   │
│ │          │              │   │ ├──────────────────────────┤ │   │
│ │          │              │   │ │ Context Chips            │ │   │
│ │          │              │   │ │ [PDF: paper.pdf] [@col]  │ │   │
│ │          │              │   │ ├──────────────────────────┤ │   │
│ │          │              │   │ │ Input Area               │ │   │
│ │          │              │   │ │ [Type message... /cmd @] │ │   │
│ │          │              │   │ └──────────────────────────┘ │   │
│ └──────────┴─────────────┴───┴──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

Data Flow:
  User Input → InputController → SlashCommandParser → MentionResolver
       ↓
  ContextBuilder (attach PDF paths, annotations, metadata, selection)
       ↓
  ClauteroService → MessageChannel → Subprocess.jsm (Gecko native)
       ↓                                    ↓
  StreamController ← NDJSON parser ←────── Claude Code CLI subprocess
       ↓                                    (cwd: clautero/workspace/)
                                            (reads PDFs via absolute paths)
  MessageRenderer → DOM updates (chat panel)
```

## Implementation Units

- [ ] **Unit 1: Project Scaffold from Zotero Plugin Template**

  **Goal:** Bootstrap the project using windingwind/zotero-plugin-template with Clautero-specific configuration.

  **Requirements:** R8

  **Dependencies:** None

  **Files:**
  - Create: `package.json`, `tsconfig.json`, `zotero-plugin.config.ts`
  - Create: `addon/manifest.json`, `addon/bootstrap.js`, `addon/prefs.js`
  - Create: `src/index.ts`, `src/addon.ts`, `src/hooks.ts`
  - Create: `addon/locale/en-US/addon.ftl`
  - Create: `addon/content/preferences.xhtml`
  - Create: `.gitignore`, `README.md`

  **Approach:**
  - Clone or adapt windingwind/zotero-plugin-template
  - Configure manifest.json with `strict_min_version: "6.999"` and `strict_max_version: "8.*"` for Zotero 7+8 compat
  - Set plugin ID to `clautero@zotero-plugin`
  - Configure esbuild to bundle TypeScript source
  - Set up dev workflow with hot reload via `zotero-plugin serve`

  **Patterns to follow:**
  - windingwind/zotero-plugin-template directory structure
  - zotero-plugin-scaffold build system

  **Test expectation:** none -- scaffolding with no behavioral logic. Verify by confirming the plugin loads in Zotero without errors.

  **Verification:**
  - Plugin installs in Zotero 7 without errors
  - `npm run build` produces valid .xpi
  - Hot reload works during development

---

- [ ] **Unit 2: Sidebar Panel Injection**

  **Goal:** Create a toggleable sidebar chat panel in Zotero's main window via DOM injection.

  **Requirements:** R1, R8

  **Dependencies:** Unit 1

  **Files:**
  - Create: `src/modules/sidebar/SidebarManager.ts`
  - Create: `src/modules/sidebar/SidebarDOM.ts`
  - Create: `addon/content/sidebar.css`
  - Modify: `src/hooks.ts`

  **Approach:**
  - In `onMainWindowLoad`, inspect Zotero's main window DOM to find the appropriate insertion point (likely after the item pane or as a sibling to the main horizontal splitter)
  - Insert a `<splitter>` and `<vbox>` element to create a resizable right-side panel
  - `SidebarManager` handles show/hide/toggle state, persists width in preferences
  - `SidebarDOM` builds the panel structure: header bar, scrollable message area, context chip bar, input area
  - Register a toolbar button and keyboard shortcut (Ctrl/Cmd+Shift+C) to toggle
  - On `onMainWindowUnload`, clean up all injected DOM elements and listeners
  - Use CSS custom properties for theming to match Zotero's native look

  **Patterns to follow:**
  - Claudian's `ClaudianView` for sidebar structure
  - zotero-better-notes DOM injection patterns
  - Zotero's native panel styling

  **Test scenarios:**
  - Happy path: Toggle sidebar open via toolbar button, panel appears with correct layout (header, message area, input)
  - Happy path: Toggle sidebar closed, panel is hidden, splitter removed from layout
  - Edge case: Resize sidebar via splitter drag, width persists across toggle and restart
  - Edge case: Open multiple Zotero windows, each gets its own sidebar instance
  - Happy path: Keyboard shortcut Ctrl/Cmd+Shift+C toggles sidebar

  **Verification:**
  - Sidebar appears as a resizable right panel in Zotero main window
  - Toggle, resize, and keyboard shortcut work correctly
  - No DOM leaks on window close

---

- [ ] **Unit 3: Claude Code Subprocess Integration via Gecko Subprocess.jsm**

  **Goal:** Establish Claude Code CLI subprocess management using Gecko's native `Subprocess.jsm`, with NDJSON streaming protocol parser and tool approval callbacks.

  **Requirements:** R2

  **Dependencies:** Unit 1

  **Files:**
  - Create: `src/core/agent/ClauteroService.ts`
  - Create: `src/core/agent/CLIPathResolver.ts`
  - Create: `src/core/agent/SubprocessManager.ts`
  - Create: `src/core/agent/NDJSONParser.ts`
  - Create: `src/core/agent/MessageChannel.ts`
  - Create: `src/core/agent/ToolApprovalManager.ts`
  - Create: `src/core/agent/types.ts`
  - Test: `src/core/agent/__tests__/NDJSONParser.test.ts`
  - Test: `src/core/agent/__tests__/MessageChannel.test.ts`

  **Approach:**
  - `CLIPathResolver`: Resolve full Claude CLI path using ordered lookup: (1) user-configured absolute path from preferences (validated on each startup), (2) known-good paths (`/usr/local/bin/claude`, homebrew paths), (3) `which claude` cached result. Validate the resolved binary exists and has correct permissions. Do NOT dynamically augment PATH — resolve to absolute path once
  - `SubprocessManager`: Wraps Gecko's `Subprocess.jsm` to spawn Claude CLI with flags: `claude -p --input-format stream-json --output-format stream-json <initial-prompt>`. Handles async stdout/stderr reading, stdin writing, process lifecycle (start, kill, cleanup). On startup, check for stale PID files from previous crashes and clean up orphaned processes. Use process groups so parent termination signals children
  - `NDJSONParser`: Parses newline-delimited JSON from Claude's stdout stream. Handles partial line buffering (lines may arrive split across chunks). Emits typed `StreamChunk` objects: `system_init`, `text`, `thinking`, `tool_use`, `tool_result`, `error`, `control_request`
  - `ClauteroService`: Orchestrates `SubprocessManager` + `NDJSONParser` + `MessageChannel`. Manages session lifecycle (create, resume, fork). Sets `cwd` to `<zotero-data>/clautero/workspace/`. Creates workspace directory if it doesn't exist
  - `MessageChannel`: Queue-based async iterable (Claudian pattern) — buffers rapid user input, enforces single in-flight turn, handles message merging. Writes user messages as NDJSON to subprocess stdin
  - `ToolApprovalManager`: Intercepts `control_request` messages from Claude. Auto-approves Read operations on files within attached context. Prompts user (via DOM dialog) for Write/Bash operations. Denies operations outside workspace directory. Logs all tool use for audit trail

  **Patterns to follow:**
  - Claudian's `MessageChannel.ts` for queue pattern (adapted for Gecko async)
  - Gecko `Subprocess.jsm` API for process management
  - Claude CLI NDJSON protocol format

  **Test scenarios:**
  - Happy path: Send a simple text message via stdin, receive streaming NDJSON text response chunks on stdout
  - Happy path: Session ID is returned in system_init message and can be used to resume conversation
  - Error path: Claude CLI not found — clear error message with path configuration guidance
  - Error path: Claude subprocess crashes mid-response — error event emitted, UI shows error, session recoverable
  - Edge case: Rapid sequential messages within merge window are batched into single turn
  - Edge case: Partial NDJSON lines across stdout chunks — parser buffers correctly
  - Integration: MessageChannel queues messages while a turn is in-flight, sends next on completion
  - Integration: Tool approval callback intercepts Bash command, prompts user, sends approval/denial response
  - Happy path: Startup cleanup detects and terminates orphaned Claude processes from previous crash

  **Verification:**
  - Can send a message and receive streaming response from Claude Code via Gecko subprocess
  - Session persistence works (resume conversation after sidebar close/reopen)
  - Tool approval prompts appear for Write/Bash operations
  - Graceful error handling when CLI is missing or crashes
  - No orphaned processes after Zotero shutdown

---

- [ ] **Unit 4: Chat UI and Message Rendering**

  **Goal:** Build the chat interface with streaming message display, thinking blocks, and tool use indicators.

  **Requirements:** R1

  **Dependencies:** Unit 2, Unit 3

  **Files:**
  - Create: `src/modules/chat/ChatState.ts`
  - Create: `src/modules/chat/InputController.ts`
  - Create: `src/modules/chat/StreamController.ts`
  - Create: `src/modules/chat/MessageRenderer.ts`
  - Create: `src/modules/chat/renderers/TextRenderer.ts`
  - Create: `src/modules/chat/renderers/ThinkingRenderer.ts`
  - Create: `src/modules/chat/renderers/ToolUseRenderer.ts`
  - Modify: `src/modules/sidebar/SidebarDOM.ts`
  - Modify: `addon/content/sidebar.css`

  **Approach:**
  - `ChatState`: Immutable state object holding messages array, streaming flag, active tool elements, usage stats
  - `InputController`: Handles text input, Enter to send, Shift+Enter for newline, up-arrow for history recall
  - `StreamController`: Routes `StreamChunk` objects from `ClauteroService` to appropriate renderers. Handles chunk coalescence (text append, thinking block finalization)
  - `MessageRenderer`: Dispatches to specialized renderers based on chunk type
  - `TextRenderer`: Renders markdown text with syntax highlighting. **Critical security**: must use DOMPurify to sanitize markdown HTML output before DOM insertion. Strip all event handlers, `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<style>` elements. Parse sanitized HTML via `DOMParser` to safe DOM nodes. For code blocks, syntax highlighter must output only `<span>` elements with class attributes
  - `ThinkingRenderer`: Collapsible thinking blocks with toggle
  - `ToolUseRenderer`: Shows tool name, arguments summary, result preview (collapsible). Tool results may contain attacker-controlled content — sanitize all rendered text
  - Auto-scroll to bottom on new content, with scroll-lock detection (user scrolled up)
  - Loading indicator during response generation

  **Patterns to follow:**
  - Claudian's `StreamController` dispatch pattern
  - Claudian's renderer hierarchy (TextRenderer, ThinkingBlockRenderer, ToolCallRenderer)

  **Test scenarios:**
  - Happy path: User types message, presses Enter, message appears in chat, streaming response renders incrementally
  - Happy path: Thinking block renders as collapsible section with toggle
  - Happy path: Tool use shows tool name and arguments, result appears when complete
  - Happy path: Markdown in responses renders with formatting (headers, code blocks, lists)
  - Edge case: Very long response auto-scrolls; user scrolling up pauses auto-scroll
  - Edge case: Empty input — Enter key does nothing
  - Edge case: Shift+Enter inserts newline without sending

  **Verification:**
  - Full chat loop works: type → send → streaming response renders
  - All chunk types (text, thinking, tool_use, tool_result) render correctly
  - Markdown formatting and syntax highlighting work in Gecko engine

---

- [ ] **Unit 5: Zotero Context Integration**

  **Goal:** Auto-attach selected Zotero item's PDF, metadata, and annotations to conversation context.

  **Requirements:** R3

  **Dependencies:** Unit 3, Unit 4

  **Files:**
  - Create: `src/modules/context/ContextBuilder.ts`
  - Create: `src/modules/context/ZoteroItemExtractor.ts`
  - Create: `src/modules/context/AnnotationExtractor.ts`
  - Create: `src/modules/context/ContextChipsView.ts`
  - Modify: `src/modules/chat/InputController.ts`
  - Test: `src/modules/context/__tests__/ContextBuilder.test.ts`

  **Approach:**
  - `ZoteroItemExtractor`: Uses Zotero API (`Zotero.Items.get()`, `item.getField()`, `item.getCreators()`) to extract title, authors, abstract, date, DOI, tags from selected item
  - `AnnotationExtractor`: Gets PDF annotations via `Zotero.Items.get(item.id).getAnnotations()` — extracts highlights, notes, page numbers, colors
  - `ContextBuilder`: Assembles context string combining metadata + annotation summaries + absolute PDF file path (from `item.getFilePath()`). Supports both stored attachments (`<data-dir>/storage/<key>/file.pdf`) and linked attachments (arbitrary filesystem paths). Appends as XML-structured context to user message (following Claudian's `<current_note>` pattern but adapted: `<zotero_item>`, `<annotations>`, `<pdf_path>`)
  - `ContextChipsView`: Renders attached context as removable chips above input area (e.g., "[PDF: Smith2024.pdf] [12 annotations]"). Uses `textContent` only — never `innerHTML` for item titles (which may contain user-controlled content)
  - Listen to Zotero item selection changes (`Zotero.Notifier.registerObserver`) to auto-update context. **Must deregister observer on plugin unload** to prevent leaks
  - User can toggle auto-attach in settings

  **Patterns to follow:**
  - Claudian's `FileContextState` + `FileChipsView` for context chip UI
  - Claudian's XML context suffix pattern (`appendCurrentNote`)
  - Zotero API patterns from zotero-better-notes

  **Test scenarios:**
  - Happy path: Select item in Zotero library, context chips appear showing PDF filename and annotation count
  - Happy path: Send message with attached context — Claude receives structured metadata + PDF path
  - Happy path: Change selected item, context chips update automatically
  - Edge case: Item with no PDF — only metadata context attached, no PDF chip
  - Edge case: Item with multiple PDFs — attach the first/primary PDF, show count
  - Error path: PDF file missing from storage — context chip shows warning, graceful degradation
  - Happy path: Remove context chip by clicking X — item detached from conversation

  **Verification:**
  - Selected item's metadata and annotations are included in Claude's context
  - Claude can read the attached PDF file via its file path
  - Context updates when selection changes

---

- [ ] **Unit 6: @-Mention System**

  **Goal:** Enable @-mentions for referencing Zotero items, collections, and saved searches in chat input.

  **Requirements:** R4

  **Dependencies:** Unit 4, Unit 5

  **Files:**
  - Create: `src/modules/mention/MentionController.ts`
  - Create: `src/modules/mention/MentionDropdown.ts`
  - Create: `src/modules/mention/ZoteroSearchProvider.ts`
  - Modify: `src/modules/chat/InputController.ts`
  - Modify: `addon/content/sidebar.css`

  **Approach:**
  - `MentionController`: Detects `@` character in input, triggers dropdown with debounced search
  - `ZoteroSearchProvider`: Searches Zotero items by title/creator using `Zotero.Search` API, collections by name via `Zotero.Collections.getByLibrary()`, and tags
  - `MentionDropdown`: Floating dropdown positioned below cursor showing matching items with type icons (paper, book, collection, tag). Keyboard navigation (up/down/enter/escape)
  - On selection: insert display text in input, track mentioned item in `ContextBuilder` — its metadata/PDF path will be included in the message context
  - Support mention types: `@item:` (search items), `@collection:` (collections), `@tag:` (tags)

  **Patterns to follow:**
  - Claudian's `MentionDropdownController` + `SelectableDropdown`
  - Claudian's `VaultMentionDataProvider` pattern adapted for Zotero search

  **Test scenarios:**
  - Happy path: Type `@` followed by text, dropdown appears with matching Zotero items
  - Happy path: Select item from dropdown, mention inserted in input, item added to context
  - Happy path: Type `@collection:` to filter only collections
  - Edge case: No matches found — dropdown shows "No results" message
  - Edge case: Mention an item already attached via auto-context — no duplicate context
  - Happy path: Keyboard navigation (arrow keys, Enter to select, Escape to dismiss)
  - Edge case: Type `@` at end of long message — dropdown positions correctly

  **Verification:**
  - @-mention search finds items by title and creator
  - Mentioned items' context is included in the message sent to Claude
  - Dropdown UX is responsive and keyboard-navigable

---

- [ ] **Unit 7: Slash Command System**

  **Goal:** Implement built-in slash commands and user-defined command templates.

  **Requirements:** R5

  **Dependencies:** Unit 4, Unit 5

  **Files:**
  - Create: `src/modules/commands/SlashCommandParser.ts`
  - Create: `src/modules/commands/builtInCommands.ts`
  - Create: `src/modules/commands/CommandDropdown.ts`
  - Create: `src/modules/commands/UserCommandLoader.ts`
  - Modify: `src/modules/chat/InputController.ts`

  **Approach:**
  - `SlashCommandParser`: Regex detection of `/command [args]` at start of input
  - Built-in commands:
    - `/summarize` — summarize the attached PDF/item
    - `/explain [concept]` — explain a concept in the context of the attached paper
    - `/related` — find related papers based on the current item's content
    - `/annotate` — extract and organize all annotations from the attached PDF
    - `/clear` — clear current conversation
    - `/fork` — fork conversation into new tab
    - `/resume` — resume a previous session
  - `CommandDropdown`: Shows available commands when `/` typed, with descriptions
  - `UserCommandLoader`: Loads user-defined commands from `<zotero-data>/clautero/commands/*.md` files (YAML frontmatter for metadata, body as prompt template with `{arg}` placeholders)
  - Commands that are prompt templates get expanded and sent as user messages with context

  **Patterns to follow:**
  - Claudian's `builtInCommands.ts` for direct actions
  - Claudian's `SlashCommandStorage` for user-defined commands

  **Test scenarios:**
  - Happy path: Type `/`, dropdown shows available commands with descriptions
  - Happy path: Type `/summarize`, command expands to summarization prompt with attached PDF context
  - Happy path: `/clear` clears conversation, starts fresh session
  - Happy path: `/fork` creates new tab with conversation fork
  - Happy path: User-defined command file loaded and available in dropdown
  - Edge case: Unknown command — treated as regular message text
  - Edge case: Command with arguments — `/explain quantum entanglement` passes args to template
  - Error path: Malformed user command file — skipped with console warning

  **Verification:**
  - All built-in commands execute correctly
  - User-defined commands load from filesystem and expand correctly
  - Command dropdown is navigable and informative

---

- [ ] **Unit 8: Vision Support**

  **Goal:** Enable sending images to Claude via drag-and-drop, paste, or file reference.

  **Requirements:** R6

  **Dependencies:** Unit 3, Unit 4

  **Files:**
  - Create: `src/modules/vision/ImageHandler.ts`
  - Create: `src/modules/vision/ImagePreview.ts`
  - Modify: `src/modules/chat/InputController.ts`
  - Modify: `src/modules/context/ContextBuilder.ts`

  **Approach:**
  - `ImageHandler`: Handles three input methods:
    1. Drag-and-drop onto chat input area (listen for `dragover`/`drop` events)
    2. Clipboard paste (listen for `paste` event, check for image data)
    3. File path reference (from Zotero's figure attachments)
  - Convert images to base64 or save to workspace as temp file for Claude CLI to read via file path
  - `ImagePreview`: Shows thumbnail preview of attached image(s) as removable chips before sending
  - Integrate with `ContextBuilder` to include image references in the message

  **Patterns to follow:**
  - Claudian's vision support (drag-and-drop, paste, file path)
  - Claude CLI NDJSON protocol for image content (spike needed to determine if stdin supports inline images or requires file path references)

  **Test scenarios:**
  - Happy path: Drag image file onto input area, preview thumbnail appears, image sent with message
  - Happy path: Paste screenshot from clipboard, preview appears, image included in context
  - Happy path: Reference figure attachment from Zotero item, image sent to Claude
  - Edge case: Non-image file dragged — ignored or error message
  - Edge case: Very large image — resize/compress before sending
  - Error path: Unsupported image format — clear error message

  **Verification:**
  - Claude receives and can analyze images from all three input methods
  - Image previews render correctly before sending

---

- [ ] **Unit 9: Multi-Conversation Tabs**

  **Goal:** Support multiple concurrent conversations with tab UI and session persistence.

  **Requirements:** R7

  **Dependencies:** Unit 3, Unit 4

  **Files:**
  - Create: `src/modules/tabs/TabManager.ts`
  - Create: `src/modules/tabs/TabBar.ts`
  - Create: `src/modules/tabs/SessionStore.ts`
  - Modify: `src/modules/sidebar/SidebarDOM.ts`
  - Modify: `src/core/agent/ClauteroService.ts`

  **Approach:**
  - `TabManager`: Manages tab lifecycle — create, close, switch. Each tab has its own `ClauteroService` instance (lazy-initialized on first message)
  - `TabBar`: Renders horizontal tab strip at top of sidebar. Shows conversation title (auto-generated or from first message), close button, "+" for new tab
  - `SessionStore`: Persists session metadata to `<zotero-data>/clautero/sessions/{sessionId}.json` — stores tab title, creation date, linked Zotero items, Claude session ID for resume
  - On tab switch: preserve scroll position, swap visible message container
  - On Zotero restart: restore previous tabs from SessionStore

  **Patterns to follow:**
  - Claudian's `TabManager` + `TabBar` pattern
  - Claudian's `SessionManager` for resume/fork

  **Test scenarios:**
  - Happy path: Click "+" to create new tab, switch between tabs preserving conversation state
  - Happy path: Close tab — conversation still resumable from session history
  - Happy path: Restart Zotero — previous tabs restored with conversation history
  - Edge case: Close last tab — new empty tab created automatically
  - Edge case: Many tabs (10+) — tab bar scrolls horizontally
  - Happy path: Tab title auto-generated from first message content

  **Verification:**
  - Multiple concurrent conversations work independently
  - Tab state persists across sidebar toggle and Zotero restart
  - Session resume works correctly via Claude CLI `--resume` flag

---

- [ ] **Unit 10: Settings and Preferences**

  **Goal:** Implement plugin settings UI for CLI path, behavior preferences, and keyboard shortcuts.

  **Requirements:** R2, R8

  **Dependencies:** Unit 1, Unit 2, Unit 3

  **Files:**
  - Modify: `addon/content/preferences.xhtml`
  - Create: `src/modules/settings/PreferenceManager.ts`
  - Modify: `addon/prefs.js`
  - Modify: `addon/locale/en-US/addon.ftl`

  **Approach:**
  - Zotero preferences pane (XHTML form) with settings:
    - Claude CLI path (with auto-detect + manual override)
    - Auto-attach context on item selection (on/off)
    - Sidebar keyboard shortcut customization
    - Default sidebar width
    - Max context length for attached items
    - User commands directory path
  - `PreferenceManager`: Reads/writes Zotero preferences via `Zotero.Prefs`, provides typed access throughout the plugin
  - CLI path validation: check file exists and is executable on save

  **Patterns to follow:**
  - zotero-plugin-template preference pane pattern
  - Zotero's native preference UI styling

  **Test scenarios:**
  - Happy path: Open preferences, change CLI path, save — new path used for subsequent Claude invocations
  - Happy path: Toggle auto-attach setting — behavior changes immediately
  - Error path: Invalid CLI path — validation error shown, setting not saved
  - Happy path: Preferences persist across Zotero restarts

  **Verification:**
  - All settings save and load correctly
  - CLI path validation prevents broken configuration
  - Settings take effect without requiring Zotero restart

## System-Wide Impact

- **Interaction graph:** `onMainWindowLoad` hook → SidebarManager (DOM injection) → ClauteroService (subprocess via `Subprocess.jsm`) → Zotero.Notifier (item selection events). Plugin is an observer of Zotero — but spawns an agentic subprocess with system access, requiring tool approval guardrails.
- **Error propagation:** Claude subprocess errors surface as chat messages (not Zotero alerts). CLI-not-found errors surface in settings with guidance. DOM injection failures prevent sidebar from appearing but don't crash Zotero. Subprocess crashes trigger error UI + session recovery.
- **State lifecycle risks:** Subprocess must be properly killed on sidebar close, tab close, and Zotero shutdown. On crash/force-quit, hooks don't fire — startup PID cleanup routine required. Zotero.Notifier observers must be deregistered on unload to prevent leaks.
- **Security boundary:** Claude subprocess has read access to files passed as context (absolute paths) and write access only to `<zotero-data>/clautero/workspace/`. Tool approval callback gates all Write/Bash operations. DOM rendering of Claude output uses strict sanitization (DOMPurify) to prevent privilege escalation in chrome-context XHTML.
- **API surface parity:** No external API exposed. Plugin is self-contained.
- **Multi-window model:** Each Zotero window gets its own SidebarManager and ClauteroService instance. Services are scoped per-window, not singleton, to avoid shared subprocess state.
- **Unchanged invariants:** Zotero's library, sync, PDF reader, and all native functionality remain completely untouched. Plugin reads Zotero metadata via APIs and files via absolute paths — never writes to library database or `zotero.sqlite`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Gecko `Subprocess.jsm` API may differ from expected or have undocumented quirks | Spike subprocess communication in Unit 3 before building full protocol. Test on actual Zotero 7 build |
| NDJSON streaming protocol is unofficially documented | Map message types by examining actual Claude CLI output. Protocol is stable in practice (used by many third-party integrations). Pin CLI version for testing |
| Zotero 8 may change DOM structure breaking sidebar injection | Use resilient DOM queries, abstract DOM specifics behind `SidebarDOM`. Fallback to `ItemPaneManager.registerSection()` for Zotero 8 |
| Claude CLI PATH resolution fails in Zotero's GUI context | Resolve to absolute path once at startup using ordered lookup. Manual path config in settings as ultimate fallback |
| Large PDFs exhaust Claude's context window | Implement max context length setting, truncation with page range selection |
| Orphaned Claude subprocesses after Zotero crash | PID file tracking + startup cleanup routine. Use process groups for parent-child termination |
| Indirect prompt injection via malicious PDF content | Tool approval callbacks gate Write/Bash operations. Sandboxed CWD limits blast radius. Display all tool use in UI for user awareness |
| DOM XSS in chrome-privileged XHTML context | Strict sanitization policy: DOMPurify for markdown, `textContent` for all other content. No `innerHTML` for Claude/user content |
| DOMPurify availability in Gecko/XPCOM context | Bundle DOMPurify as a dependency. Test compatibility with Gecko's DOM APIs early in Unit 4 |
| `InputController.ts` merge contention across Units 5, 6, 7, 8 | Design `InputController` with explicit extension points (middleware pipeline) in Unit 4 so downstream units integrate without conflicting edits |

## Sources & References

- Related code: [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)
- Related code: [YishenTu/claudian](https://github.com/YishenTu/claudian)
- External docs: [Zotero 7 for Developers](https://www.zotero.org/support/dev/zotero_7_for_developers)
- External docs: [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- External docs: [zotero-plugin-toolkit](https://github.com/windingwind/zotero-plugin-toolkit)
- Related plugins: [Aria AI Research Assistant](https://github.com/lifan0127/ai-research-assistant), [PapersGPT](https://github.com/papersgpt/papersgpt-for-zotero)
