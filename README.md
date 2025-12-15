# LingoPlayer AI 🎬

> **The Intelligent Offline Video Player for Language Learners**

LingoPlayer AI is a modern, privacy-focused video player designed to supercharge your language learning journey. It leverages on-device AI and local Large Language Models (LLMs) to generate subtitles, provide context-aware dictionary definitions, and manage vocabulary—all without leaving your app.

![LingoPlayer Screenshot](https://images.unsplash.com/photo-1611162617474-5b21e879e113?q=80&w=1000&auto=format&fit=crop)

## ✨ Key Features

* **🤖 AI Subtitles (Offline & Online)**
  * **Offline:** Uses `Whisper` (via WebAssembly) to generate subtitles locally in your browser. No internet required.
  * **Online:** optional integration with **Google Gemini** for ultra-fast, high-precision transcription.
  * **Local Server:** Connect to `Whisper.cpp` or `Faster-Whisper` servers for GPU-accelerated performance.
* **📚 Context-Aware Dictionary**
  * Click any word in the subtitle to get a definition based on the *current sentence context*.
  * Supports **Ollama** for completely offline, private AI definitions.
* **🧠 Vocabulary Building**
  * Save words with their meanings, phonetic transcription, and usage examples to your personal vocabulary list.
* **🛠️ Smart Playback Controls**
  * **Loop Sentence:** Automatically loop the current subtitle segment for shadowing practice.
  * **Keyboard Shortcuts:** Full control over playback speed, seeking, and mode switching.
  * **Auto-Conversion:** Automatically converts unsupported formats (MKV, AVI) to MP4 using FFmpeg (WASM or Native).
* **🔒 Privacy First**
  * Your videos never leave your device. All processing can be done locally.

## 🛠️ Tech Stack

* **Frontend:** React 18, TypeScript, Vite
* **Styling:** Tailwind CSS, Lucide React
* **Desktop Wrapper:** Electron (Optional)
* **AI/ML:**
  * `@xenova/transformers` (In-browser Whisper)
  * `@google/genai` (Gemini API)
  * `@ffmpeg/ffmpeg` (WASM Video Processing)
  * Ollama Connector (Local LLM)

## 🚀 Getting Started

### Prerequisites

* Node.js (v18 or higher)
* NPM or Yarn

### Installation

1. Clone the repository:
   
   ```bash
   git clone https://github.com/benzhou222/lingoplayer-offline.git
   cd lingoplayer-offline
   ```

2. Install dependencies:
   
   ```bash
   npm install
   ```

### Running the App

**Web Version (Browser):**

```bash
npm run dev
```

*Accessible at `http://localhost:3000`*

**Desktop Version (Electron):**

```bash
npm run electron:dev
```

**Build for Production:**

```bash
# Build Web
npm run build

# Build Desktop App (Windows/Mac/Linux)
npm run electron:build
```

## ⚙️ Configuration Guide

### 1. Online AI (Google Gemini)

To use the fastest subtitle generation and definitions:

1. Get an API Key from [Google AI Studio](https://aistudio.google.com/).
2. Open **Settings** in the app.
3. Switch to the **Online (Gemini)** tab.
4. Paste your API Key.

### 2. Local LLM (Ollama)

For offline dictionary definitions:

1. Install [Ollama](https://ollama.com/).
2. Pull a model (e.g., `ollama pull llama3` or `ollama pull mistral`).
3. Start Ollama: `ollama serve`.
4. In the app **Settings** -> **Local AI**, enable "Use Local Ollama" and select your model.
   * *Note: Ensure your browser allows CORS connections to localhost:11434.*

### 3. Local Speech-to-Text Server

For GPU-accelerated subtitles:

1. Run a server compatible with OpenAI's API format (e.g., `faster-whisper-server`).
2. In **Settings**, enable "Use Local Whisper Server".
3. Set the endpoint (e.g., `http://127.0.0.1:8080/v1/audio/transcriptions`).

## 🎮 Keyboard Shortcuts

| Key       | Action                        |
|:--------- |:----------------------------- |
| **Space** | Play / Pause                  |
| **A / D** | Previous / Next Sentence      |
| **W / S** | Increase / Decrease Speed     |
| **Q**     | Toggle Loop Mode              |
| **E**     | Toggle Mute                   |
| **< / >** | Step Frame Backward / Forward |
| **- / =** | Volume Down / Up              |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

# 
