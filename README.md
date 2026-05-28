# Creative Writing Assistant

Creative Writing Assistant is a mobile-friendly Expo app for writing with AI. It gives each story or project its own workspace, then lets you chat with an OpenRouter model while keeping prompts, notes, and imported reference files tied to that project.

## What the app does

- Create and manage writing projects
- Keep separate chats inside each project
- Configure a custom system prompt per project
- Store persistent memory notes for characters, plot points, lore, or reminders
- Import text-based reference files and include them in AI requests automatically
- Generate a saved story outline from your project context and use built-in prompt starters for scenes, rewrites, dialogue, and continuation
- Export a conversation as plain text
- Choose an OpenRouter model and switch between light, dark, and system theme modes

## Current feature set

### Projects

Each project has its own:

- Name
- Multiple chats
- System prompt
- Memory notes
- Imported files
- Saved outline

Projects are stored locally and sorted by most recently updated.

### Chat

The main writing screen includes:

- A mobile-first chat interface
- Multiple persistent chats per project
- Per-response token counts
- Clear-history action
- Export/share conversation action

### Memory

The Memory tab is for reusable project context such as:

- Character notes
- World-building rules
- Plot threads
- Research reminders

Enabled memory notes are automatically appended to the AI context for that project.

### Files and Context

You can import text-based files into a project to give the assistant more grounded context. The app currently supports files such as:

- `.txt`
- `.md` / `.markdown`
- `.json`
- `.csv`
- `.yaml` / `.yml`
- `.html`
- `.py`, `.js`, `.ts`, `.jsx`, `.tsx`
- `.sql`
- `.xml`

Imported files are:

- Read locally on-device
- Normalized and chunked
- Given a lightweight local summary and keyword list
- Reused as context during AI requests

Each file can be included in one of three modes:

- `Auto`: send the summary plus the most relevant excerpts
- `Summary only`: send only the file summary
- `Full file`: send the full file content

This makes the app useful not just for fiction drafting, but also for working from outlines, notes, research snippets, and structured reference material.

### Tools

The Tools tab provides a saved outline generator plus prompt starters for common writing tasks, including:

- Story outline generation
- Scene suggestions
- Continue writing
- Dialogue suggestions
- Setting descriptions
- Plot-hole checks
- Rewriting assistance

### Settings

Settings currently let you:

- Save an OpenRouter API key
- Choose from multiple OpenRouter-served models
- Switch theme mode

The bundled model list includes options from providers such as OpenAI, Anthropic, Google, Meta, Mistral, Z.ai, and OpenRouter.

## Tech stack

- React Native
- Expo SDK 54
- Expo Router
- AsyncStorage for local persistence
- OpenRouter Chat Completions API

## Local-first storage

The app does not require its own backend. Project data is stored locally with AsyncStorage, including:

- Projects
- Messages
- Memory notes
- Imported files
- File chunks and summaries
- User settings

## Getting started

### Prerequisites

- Node.js 18+
- npm

### Install and run

```bash
npm install
npm run dev
```

From the Expo dev server, you can run the app on web, Android, or iOS.

## Configuration

1. Create or copy an API key from [OpenRouter](https://openrouter.ai)
2. Open the app and go to Settings
3. Paste your API key
4. Choose a model
5. Create a project and start writing

## Build

### Web export

```bash
npm run build:web
```

### Native builds

This repo includes an `eas.json` configuration for EAS builds. Use EAS for native release builds rather than the old `expo build:*` commands.

## License

MIT
