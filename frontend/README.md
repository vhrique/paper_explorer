# Paper Explorer

A stateless, frontend-only web app for exploring, annotating, and linking academic papers.

- Upload PDFs and organize them into projects
- Highlight passages, add tags and notes
- Discover semantically similar passages across papers (dense retrieval + BM25 fallback)
- Draw manual links between related passages across papers
- Ask questions about a paper (RAG with any OpenAI-compatible LLM)
- Train a per-project similarity model from your own annotations (manual links + notes)

All data is stored in a local folder you pick — no server, no database, no account.

## Running

```bash
docker compose up --build
```

Opens at `http://localhost:5173`. On first load, pick a local folder to use as your workspace. The selection persists across sessions.

## Configuration

Open **Settings** (⚙ in the top-right of the reader) to configure:

| Setting | Purpose |
|---|---|
| Embedding Base URL | OpenAI-compatible endpoint (LM Studio, Ollama, OpenAI, …) |
| Embedding API Key | API key for the embedding endpoint |
| Embedding Model | Model identifier (e.g. `text-embedding-3-small`) |
| LLM Base URL | OpenAI-compatible endpoint for Q&A |
| LLM API Key | API key for the LLM endpoint |
| LLM Model | Model identifier (e.g. `gemma3`, `gpt-4o-mini`) |

Embeddings are optional — BM25 (MiniSearch) is used as a fallback for papers without them.

## Tech Stack

- **React + TypeScript + Vite + Tailwind CSS**
- **pdfjs-dist** — client-side PDF parsing and text extraction
- **react-pdf** — PDF rendering
- **TensorFlow.js** — in-browser training of the similarity projection model
- **MiniSearch** — BM25 full-text search fallback
- **File System Access API** — read/write files in the user's local folder

## Development

```bash
cd frontend
npm install
npm run dev     # Vite dev server with HMR at http://localhost:5173
npm run build   # Production build
```
