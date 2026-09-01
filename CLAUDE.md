# Paper Reader

A stateless, frontend-only web app for reading **one** academic PDF with an assistant.
Open a PDF, ask questions about it in a chat (answers point you to the exact
paragraphs), and highlight / comment / draw regions — all saved back into the PDF
file itself in its native annotation format, so they're portable to any PDF reader.

No server, no database, no accounts. Everything runs in the browser (or, packaged
with Electron, on the desktop). The user brings their own OpenAI-compatible
LLM/embedding endpoint.

> Was previously a multi-paper "explorer" (projects, library, cross-paper
> similarity, a learned TF.js projection model, dual-pane linking). That's all
> gone — see git history if you need it.

## Architecture

```
paper_explorer/
├── frontend/                          # React 19 + TypeScript + Vite 7 + Tailwind 3
│   ├── index.html
│   ├── vite.config.ts                 # base './' for build (Electron/subpath); VITE_BASE override
│   ├── Dockerfile                     # dev: Vite dev server on :5173
│   ├── Dockerfile.prod                # prod: `vite build` → nginx static
│   ├── nginx.conf
│   ├── electron-builder.yml           # win/mac/linux targets + .pdf file association
│   ├── electron/
│   │   ├── main.cjs                   # no menu bar; CORS relaxed; single-instance; "open with" PDF
│   │   └── preload.cjs                # contextBridge: window.electronPdf {onOpen, read, write}
│   ├── build/icon.png                 # 1024px app icon (electron-builder derives .ico/.icns)
│   └── src/
│       ├── App.tsx                    # state machine: no-pdf → reader; loadPdf() pipeline;
│       │                              #   subscribes to Electron "open with"; background embedding
│       ├── api/index.ts               # shared types + thin client API
│       │                              #   (processPaper, embedText, embedChunks, fetchMetadata*)
│       ├── components/
│       │   ├── OpenPdfScreen.tsx      # the "Open a PDF" landing screen
│       │   ├── ReaderView.tsx         # orchestrator: PDFPanel + sidebar (Chat / Annotations),
│       │   │                          #   annotation state + write-back, chat sessions, jump/flash
│       │   ├── PDFPanel.tsx           # react-pdf render; modes: select-text / region / add-note;
│       │   │                          #   selection→highlight; overlay drawn from parsed annotations
│       │   ├── ChatPanel.tsx          # multi-chat; JSON {answer, sources} Q&A; location cards
│       │   ├── AnnotationsList.tsx    # sidebar list: edit comment / delete / jump-to
│       │   └── SettingsPanel.tsx      # LLM + embedding endpoints, context window, require-sources
│       └── services/
│           ├── pdfFile.ts             # showOpenFilePicker (rw handle); debounced atomic write-back;
│           │                          #   WritableFileHandle structural type; IDB original stash
│           ├── electronFile.ts        # wraps an OS file path in the same WritableFileHandle shape
│           ├── pdfProcessor.ts        # pdfjs: PDF → block/paragraph/sentence chunks + per-line rects;
│           │                          #   page-level typography stats; embedChunkTexts() (background)
│           ├── pdfAnnotations.ts      # pdf-lib: read/create/update/delete /Highlight /Square /Text
│           ├── pdfText.ts             # extractRegionText() + getPageGeometry() (pdf.js viewport)
│           ├── qaService.ts           # retrieval (paragraph cosine / BM25) + answer():
│           │                          #   full / window / region modes, JSON contract + 1 retry
│           ├── paperCache.ts          # IndexedDB: processed papers, chat sessions, original bytes
│           ├── llmService.ts          # OpenAI-compatible chat; drops rejected params & retries
│           ├── embeddingService.ts    # OpenAI-compatible embeddings (batched)
│           ├── settingsService.ts     # localStorage settings
│           └── metadataService.ts     # DOI/arXiv lookup — currently unwired (kept for reuse)
├── .github/workflows/
│   ├── desktop.yml                    # electron-builder on win/mac/linux → artifacts + Release
│   ├── docker.yml                     # build Dockerfile.prod → push ghcr.io/<repo>
│   └── pages.yml                      # deploy frontend/dist to GitHub Pages (needs Pages enabled)
└── docker-compose.yml                # dev: Vite dev server on :5173
```

`*` `api.fetchMetadata` / `metadataService.ts` are dead code paths — the paper-info
edit UI they fed was removed. Left in tree, not imported by any component.

## Running

**Web (dev):**
```bash
docker compose up --build          # → http://localhost:5173
# or: cd frontend && npm install && npm run dev
```

**Desktop (dev):** `cd frontend && npm run electron:dev` (Vite + Electron together)

**Desktop (package):** `cd frontend && npm run electron:dist` → installers in `frontend/release/`
(`electron:pack` for an unpacked dir). CI (`desktop.yml`) does this for all three OSes.

**Web (prod static):** `docker build -f frontend/Dockerfile.prod ./frontend`, or pull
`ghcr.io/vhrique/paper_explorer:latest` (published by `docker.yml`).

Browser support: **Chromium only** (Chrome/Edge) — the app relies on the File System
Access API (`showOpenFilePicker`, `createWritable`). Needs a secure context (HTTPS or
localhost).

## Storage

There is no workspace folder any more. Data lives in three places, all per-browser:

| Where | What |
|---|---|
| **The PDF file itself** | The source of truth for annotations. `pdf-lib` writes `/Highlight`, `/Square`, `/Text` objects into the file (identified by `/NM`); parsed back on load. Debounced atomic write-back via the file handle's `createWritable()` (or `fs.writeFile` in Electron). |
| **IndexedDB** `paper-explorer-reader` | `papers` — processed chunks + embeddings, keyed by PDF content hash (SHA-256). `chats` — chat sessions per paper. `originals` — one pristine copy of each opened PDF's bytes for recovery. |
| **localStorage** `paper-explorer-settings` | LLM + embedding Base URL / key / model, context-window tokens, require-sources flag. |

Opening the same PDF again is instant (cache hit by hash). The ⟳ button in the reader
re-runs processing; clearing the `paper-explorer-reader` IndexedDB database forces a
full reprocess.

## Key Concepts

### PDF processing & paragraph chunking (`pdfProcessor.ts`)
pdfjs-dist parses the PDF client-side, trusting content-stream order (reading order for
LaTeX papers — no column detection). Per page it computes **page-level typography
stats** (median line advance, median line height) and:
- new **block** when y jumps backward (column) or the gap is > ~2.2× the page median advance
- inside a block, `makeBlock` inserts a paragraph break (`\n\n`) when the gap is
  > 1.4× median, or a line has a genuine first-line indent (indented while the *next*
  line returns to the margin — so hanging-indent bullet lists don't shatter)

Blocks split into paragraphs (blank-line) and sentences (punctuation). Rects are
per text line (never per bounding box) so highlights don't bleed across columns.
`embedChunkTexts()` is separate so embedding can run in the background after the reader
opens (progress shown next to the ⟳ icon).

### Native PDF annotations (`pdfAnnotations.ts`)
Highlights → `/Highlight` (QuadPoints), region boxes → `/Square`, sticky notes →
`/Text`. Geometry goes through pdf.js's viewport transform (`getPageGeometry` in
`pdfText.ts`) so page rotation and MediaBox offsets are handled. `renderAnnotationLayer`
is off; `PDFPanel` draws its own `%`-positioned overlay from the parsed annotations, so
they look identical in-app and in external readers.

### Q&A (`qaService.ts` + `ChatPanel.tsx`)
No RAG on the answer path. The paper's paragraphs are sent to the LLM as a numbered
JSON array `[{id, page, text}]`; the model must reply with
`{"answer": string, "sources": number[]}` (≤5 ids, `response_format: json_object`,
one automatic retry if it doesn't comply). Cited ids resolve to passages → clickable
"jump to location" cards that scroll + flash the paragraph in the PDF.

Three modes, chosen automatically:
- **full** — the whole paper fits the configured context window
- **window** — paper too big; fill the budget with the most relevant paragraphs
  (embedding cosine, else BM25), re-sorted into reading order
- **region** — a text selection / drawn region is attached; send only a slice of
  passages centred on the ones it overlaps, and tell the model to answer about that
  selection specifically

`SettingsPanel` exposes the context window (tokens) and a "require the model to cite
its sources" toggle (off → `{answer}` only, faster/looser for small local models).
`llmService.chat()` drops request params a model rejects (`temperature`,
`response_format`) and retries — so GPT-5 / o-series models work unchanged.

### Multi-chat
Several chats per paper, cycled/switched/deleted from the bar at the top of the Chat
panel, persisted in the IndexedDB `chats` store keyed by paper hash. Chat title is
derived from the first question.

### Desktop (`electron/`)
`main.cjs`: no application menu (`Menu.setApplicationMenu(null)`), a `webRequest`
handler that adds `Access-Control-Allow-Origin: *` so any endpoint works without CORS
friction, single-instance lock, and "Open with… Paper Reader" — the PDF path arrives
via `process.argv` (Windows/Linux) or the `open-file` event (macOS), is buffered until
the renderer signals ready, then delivered over IPC. `electronFile.ts` turns that path
into the same `WritableFileHandle` the file picker returns, so annotation write-back is
identical. `electron-builder.yml` registers `.pdf` as an *option* in the OS "Open with"
menu — it never forces the default.

## Common Tasks

### Add a field to the processed-paper cache
1. Add it to `PaperCacheEntry` in `services/paperCache.ts`
2. Populate it in `toEntry()` in `App.tsx` (and `ProcessResponse` / `ChunkMetaItem` in
   `api/index.ts` if it comes from processing)
3. Bump `DB_VERSION` in `paperCache.ts` only if you need a new object store

### Change the LLM / embedding provider
Settings (⚙) → Base URL, API Key, Model. Saved to localStorage. "Test connection"
mirrors the real request (incl. the param-drop fallback).

### Reprocess a paper
The ⟳ button in the reader (re-chunk + re-embed with current settings, embedding in the
background), or clear the `paper-explorer-reader` IndexedDB database and reopen.

### Tune paragraph detection
`extractPageBlocks` / `makeBlock` thresholds in `pdfProcessor.ts`. There's a standalone
node script pattern for testing chunking against a real PDF (see git history around the
pivot).

### Adjust the Q&A prompt / output contract
`qaService.ts` — `SYSTEM_JSON` / `SYSTEM_ANSWER_ONLY`, `parseAnswerJson`, and the
mode-selection logic in `answer()`.
