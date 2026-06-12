# Paper Explorer

A full-stack web app for exploring, annotating, and discovering relationships in academic papers. Upload PDFs, view them as interactive knowledge graphs, tag chunks semantically, and find similar content across your library.

## Architecture

```
paper_explorer/
├── backend/          # FastAPI Python server
│   ├── main.py       # All API routes
│   ├── database.py   # PostgreSQL/pgvector helpers
│   ├── models.py     # Pydantic models
│   └── services/
│       ├── pdf_processor.py      # PDF parsing → nodes (text + image chunks)
│       ├── embedding.py          # SentenceTransformer embeddings (intfloat/e5-large-v2)
│       ├── similarity.py         # Cosine similarity + LLM-based excerpt extraction
│       ├── tag_service.py        # SVM-based tag suggestion model
│       ├── llm_service.py        # Ollama/Gemma3 client (OpenAI-compatible API)
│       ├── storage.py            # MinIO/S3 file storage
│       ├── graph.py              # Graph layout computation
│       ├── discovery.py          # Paper discovery via Semantic Scholar
│       ├── semantic_scholar.py   # Semantic Scholar API client
│       └── crossref_service.py   # CrossRef DOI metadata + references
├── frontend/         # React + TypeScript + Vite
│   └── src/
│       ├── App.tsx
│       ├── api/index.ts          # All API calls to backend
│       └── components/           # UI components
└── docker-compose.yml
```

## Running the Stack

Everything runs via Docker Compose. Requires an NVIDIA GPU (configured for GPU passthrough).

```bash
docker compose up --build
```

Services:
- **Frontend**: http://localhost:5173 (Vite dev server with hot-reload)
- **Backend API**: http://localhost:8000 (FastAPI, auto-reloads from mounted volume)
- **MinIO console**: http://localhost:9001 (admin/minioadmin)
- **PostgreSQL**: localhost:5432 (user/password/paper_explorer)
- **Ollama**: http://localhost:11434 (gemma3:4b pulled automatically; custom `gemma3-32k` model with 32k context created from `backend/Modelfile`)

On first boot: Ollama pulls gemma3:4b and creates the `gemma3-32k` model — this takes a few minutes.

## Key Environment Variables (set in docker-compose.yml)

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@postgres:5432/paper_explorer` |
| `MINIO_ENDPOINT` | `minio:9000` |
| `MINIO_ACCESS_KEY` | `minioadmin` |
| `MINIO_SECRET_KEY` | `minioadmin` |
| `MINIO_BUCKET_NAME` | `paper-explorer` |
| `OLLAMA_BASE_URL` | `http://ollama:11434` |

## Data Model

PostgreSQL with pgvector extension. Schema created automatically on startup (`database.py:init_db`).

- **projects** — top-level containers
- **papers** — PDFs uploaded to a project; stores DOI, abstract, color
- **nodes** — chunks extracted from papers (type: `text` | `image` | `note`); each has a `vector(1024)` embedding; IVFFlat cosine index
- **tags** — `global` (cross-project) or `local` (per-project)
- **node_tags** — many-to-many: nodes ↔ tags
- **links** — manual connections between nodes
- **notes** — free-text annotations; also stored as nodes with embeddings
- **paper_references** / **paper_citations** — populated from CrossRef + Semantic Scholar on upload
- **svm_models** — metadata for trained tag-suggestion models (actual model pickles in MinIO)

## Backend Services

### PDF Processing (`pdf_processor.py`)
Extracts text blocks and images from PDFs via PyMuPDF, assigns them UUIDs, stores images in MinIO.

### Embeddings (`embedding.py`)
Uses `intfloat/e5-large-v2` (1024-dim) via `sentence-transformers`. Batch-processes all nodes after upload. Images are also embedded (model supports multimodal input).

### Similarity Search (`similarity.py`)
1. Cosine similarity over pgvector embeddings (max-similarity across multiple query vectors)
2. LLM excerpt extraction: sends top-k nodes to Gemma3 to extract relevant passages
3. Re-embeds those passages and re-runs search (improving retrieval recall)
4. Optional cross-encoder reranking (currently disabled — `self.cross_encoder = None`)

### Tag Suggestions (`tag_service.py`)
- One-vs-rest SVM with RBF kernel trained on tagged nodes
- Separate models for global vs local tags
- Models pickled and stored in MinIO at `models/project_{id}/svm_model_{global|local}.pkl`
- Decision function scores stored in `nodes.tag_scores` (JSON) after training
- `use_global_context=True` pulls tagged nodes from other projects as additional training data

### LLM Service (`llm_service.py`)
Singleton wrapping Ollama via the OpenAI Python SDK. Default model: `gemma3-32k`. Used for excerpt extraction in similarity search.

### Metadata Enrichment (on PDF upload)
1. DOI extracted from PDF
2. CrossRef: fetches abstract + outgoing references
3. Semantic Scholar: fetches incoming citations (up to 50)

## Frontend

React 19 + TypeScript + Vite + Tailwind CSS.

Key components:
- `GraphView.tsx` — ReactFlow canvas showing nodes as a 2D graph (PCA layout)
- `DiscoveryGraph.tsx` — graph for paper discovery recommendations
- `PapersSidebar.tsx` — paper list and upload
- `DetailPanel.tsx` — node detail view with tagging
- `SimilarityModal.tsx` — similar nodes search triggered from a note
- `AdvancedViewPanel.tsx` — tag training, SVM score-based layout
- `PDFViewer.tsx` — in-app PDF viewer

API base URL is proxied through Vite config to `http://backend:8000`.

## No Tests

There is no test suite. `backend/test_llm.py` is a one-off manual script.

## Common Tasks

**Add a new API endpoint**: add a route to `backend/main.py`, add any Pydantic models to `models.py`, add DB helpers to `database.py` if needed.

**Change the embedding model**: edit `EmbeddingService.__init__` in `services/embedding.py`. Changing the model changes vector dimensions — you'll need to drop and recreate the `nodes` table and re-process all PDFs.

**Change the LLM model**: edit `LLMService.__init__` default `model` arg in `services/llm_service.py` and update the model pulled in `docker-compose.yml`.

**Add a new frontend component**: add to `frontend/src/components/`, wire API calls through `frontend/src/api/index.ts`.
