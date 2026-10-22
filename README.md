# Paper Reader

A stateless, local-first assistant for reading **one** academic PDF at a time.
Open a PDF, ask questions about it in a chat (answers point you to the exact
paragraphs), and highlight, comment, or draw regions — all saved back into the
PDF file itself in its native annotation format, so your annotations are
portable to any other PDF reader.

No server, no database, no accounts. Runs entirely in the browser, or packaged
with Electron as a desktop app. You bring your own OpenAI-compatible LLM /
embedding endpoint (OpenAI, LM Studio, Ollama, etc.) — nothing is sent anywhere
else.

## Running

**Web (Docker):**

```bash
docker compose up --build
```

Opens at `http://localhost:5173`. Requires a Chromium-based browser (Chrome or
Edge) — the app relies on the File System Access API.

**Web (prebuilt image):**

```bash
docker run -p 8080:80 ghcr.io/vhrique/paper_explorer:latest
```

**Desktop:** download the latest installer for your OS from the
[Releases](https://github.com/vhrique/paper_explorer/releases) page
(Windows `.exe`, macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`).

**Local development:**

```bash
cd frontend
npm install
npm run dev            # Vite dev server at http://localhost:5173
npm run electron:dev   # Electron + Vite together
```

## Configuration

Open **Settings** (⚙ in the top-right of the reader) to set:

| Setting | Purpose |
|---|---|
| LLM Base URL / API Key / Model | OpenAI-compatible endpoint used to answer questions about the open paper |
| Embedding Base URL / API Key / Model | Optional — used to retrieve the most relevant paragraphs for long papers |
| Context window | How many tokens of the paper to send per question |
| Require sources | Whether the model must cite the paragraphs it used |

Embeddings are optional — BM25 full-text search is used as a fallback for
retrieval when no embedding endpoint is configured.

## Storage & privacy

There's no workspace folder or account. Data lives in three places, all local
to your browser (or desktop install):

- **The PDF file itself** — highlights, regions, and notes are written directly
  into the PDF as native annotation objects, so they open correctly in any
  other PDF reader too.
- **IndexedDB** — cached chunks/embeddings per paper (keyed by content hash, so
  reopening the same PDF is instant) and your chat sessions.
- **localStorage** — your LLM/embedding settings.

Nothing is sent anywhere except the LLM/embedding endpoint you configure
yourself.

## Tech stack

- React 19 + TypeScript + Vite + Tailwind CSS
- **pdfjs-dist** — client-side PDF parsing and text extraction
- **react-pdf** — PDF rendering
- **pdf-lib** — reading/writing native PDF annotations
- **MiniSearch** — BM25 full-text search fallback
- **Electron** — optional desktop packaging

See [CLAUDE.md](CLAUDE.md) for a detailed architecture walkthrough.

## License

[MIT](LICENSE)
