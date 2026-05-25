# Creative Writing Assistant

A mobile-friendly React Native (Expo) app for creative writing assistance powered by the OpenRouter API.

## Features

### Projects System
- Create, rename, and delete projects
- Each project has its own system prompt, chat history, and memory notes
- Project dashboard with last-modified timestamps

### Chat & History
- Clean, mobile-optimized chat interface with bubble-style messages
- Full conversation history preserved per project
- Clear history option without deleting the project
- Export conversation as plain text

### System Prompt Management
- Editable system prompt per project
- Starter templates: Fantasy world-building, Noir editor, Creative writing coach

### Memory Panel
- Save important notes (characters, plot points, world-building details)
- Toggle individual memory entries on/off
- Memory content automatically injected into each AI message

### Creative Writing Tools
- **Story Outline Generator**: Generate structured 3-act or chapter-by-chapter outlines
- **Scene Suggestions**: AI suggests next scenes based on current story
- **Quick Actions**: One-tap prompts for common tasks

### Settings
- OpenRouter API key configuration
- Model selection (GPT-4, Claude, Mistral, Gemini, Llama)
- Dark/Light/System theme support
- Token usage tracking and cost estimates

## Setup

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Configuration

1. Get an OpenRouter API key from [openrouter.ai](https://openrouter.ai)
2. Open the app and navigate to Settings
3. Enter your API key
4. Select your preferred AI model
5. Start creating projects and writing!

## Building for Production

```bash
# Build for web
npm run build:web

# Build for iOS (requires Expo account)
npx expo build:ios

# Build for Android (requires Expo account)
npx expo build:android
```

## Tech Stack

- **React Native** with **Expo SDK 54**
- **Expo Router** for navigation
- **AsyncStorage** for local data persistence
- **OpenRouter API** for AI responses
- **Lucide React Native** for icons

## Data Storage

All data is stored locally on the device using AsyncStorage:
- Projects
- Chat messages
- Memory notes
- Settings

No backend or server required.

## License

MIT
