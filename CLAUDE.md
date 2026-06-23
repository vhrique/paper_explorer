# Paper Explorer

A stateless, frontend-only web app for exploring, annotating, and linking academic papers. Upload PDFs, highlight passages, tag them, ask questions, and discover semantically similar passages across papers in a project. All data lives in a user-picked local folder — no server, no database.

## Architecture

```
paper_explorer/
├── frontend/                         # React + TypeScript + Vite + Tailwind CSS
│   └── src/
│       ├── App.tsx                   # Root: switches between LibraryView and ReaderView
│       ├── api/
│       │   └── index.ts              # Shared types; client-side implementations of all "API" calls
│       ├── components/
│       │   ├── LibraryView.tsx       # Project/paper management, uploads
│       │   ├── ReaderView.tsx        # Double-pane PDF reader, orchestrates all sub-components
│       │   ├── PDFPanel.tsx          # PDF renderer (react-pdf), text selection → highlights
│       │   ├── ContextPanel.tsx      # Sidebar: Highlights, Links, Similar, Search, Notes tabs
│       │   └── ConnectionOverlay.tsx # SVG Bezier lines connecting similar/linked passages
│       ├── services/
│       │   ├── pdfProcessor.ts       # pdfjs: PDF → blocks/paragraphs/sentences + per-line rects
│       │   ├── embeddingService.ts   # OpenAI-compatible embedding API client
│       │   ├── llmService.ts         # OpenAI-compatible LLM API client (Q&A)
│       │   ├── similarityModel.ts    # TF.js learned projection model (training + inference)
│       │   ├── settingsService.ts    # Read/write app settings (embedding URL, model, etc.)
│       │   └── metadataService.ts    # DOI/arXiv metadata lookup
│       ├── storage/
│       │   ├── types.ts              # TypeScript interfaces for all on-disk data shapes
│       │   ├── LocalFolderAdapter.ts # File System Access API: read/write files in user folder
│       │   └── workspace.ts          # All CRUD: projects, papers, passages, notes, links
│       └── utils/
│           └── similarity.ts         # Cosine + BM25 similarity search; chunk cache management
└── docker-compose.yml                # Single service: Vite dev server on :5173
```

## Running

```bash
docker compose up --build
# → http://localhost:5173
```

On first load the app asks you to pick a local folder — all data is stored there as JSON files and binaries. The folder persists across sessions via IndexedDB (no re-picking needed).

## Storage Layout

All files live inside the user-picked folder:

```
<workspace>/
├── workspace.json                          # projects, tags, passage links
├── settings.json                           # embedding/LLM API config
├── papers/
│   └── {id}/
│       ├── metadata.json                   # title, filename, DOI, arxiv_id, project_ids
│       ├── {filename}.pdf                  # original PDF
│       ├── chunks_meta.json                # chunk text, page, granularity, parent_idx, rects[]
│       ├── embeddings.bin                  # Float32Array: chunk embeddings (flat, row-major)
│       └── annotations.json               # passages (highlights) + notes
└── models/
    └── project_{id}/
        └── similarity_projection.json      # learned query/key projection weights
```

## Key Concepts

### PDF Processing (`pdfProcessor.ts`)
Uses pdfjs-dist to parse PDFs client-side. Trusts the PDF content-stream order (reading order for LaTeX-generated papers) to build blocks without explicit column detection:
- y goes backward → column/section boundary → new block
- y gap > 1.2× line height → paragraph break → new block
- Otherwise → new line within the same block

Each block is split into paragraphs (blank-line splits) and sentences (punctuation boundaries). Rects are computed per text line (not per bounding box) so highlights never bleed across columns.

### Embeddings
Sent to an OpenAI-compatible endpoint configured in Settings (LM Studio, Ollama, OpenAI, etc.). Embeddings are optional — BM25 (via MiniSearch) is used as fallback for papers without embeddings.

### Similarity Search (`similarity.ts`)
For each query (a user highlight or a search string):
1. Dense path: cosine similarity in the learned projected space (if embeddings available)
2. BM25 fallback: for papers using a different or absent embedding model
3. Resolution: if both a sentence and its parent paragraph rank, the sentence wins

### Learned Projection (`similarityModel.ts`)
Two linear projections (query, key) initialized as identity and trained with TF.js in the browser. Positive pairs:
- Manual passage links (bidirectional)
- Note → annotated passage pairs (the note content and its passage are pulled together)
- Passages co-annotated by the same note

Training triggers automatically after linking or deleting passages; can also be triggered manually.

### Q&A
User types a question → top-k paragraph chunks retrieved by cosine similarity → prompt sent to the LLM API → answer displayed in the Search tab.

## Common Tasks

### Adding a new stored field
1. Add the field to the relevant interface in `storage/types.ts`
2. Update the hydrate function in `storage/workspace.ts`
3. Update any create/update functions to persist the new field

### Changing the Embedding or LLM provider
Open Settings in the app (⚙ icon). Set the Base URL, API Key, and Model name. Settings are saved to `settings.json` in the workspace folder.

### Re-processing a paper's chunks
Delete and re-upload the paper, or add a dev-mode reprocess button — the PDF is stored at `papers/{id}/{filename}.pdf` and can be re-fed through `processPaperClientSide`.
