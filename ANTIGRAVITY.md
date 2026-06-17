# Paper Explorer v2

A full-stack web application for exploring, annotating, and linking academic papers. Upload PDFs, highlight passages, tag them, search/ask questions about them, and discover similar passages or establish manual links across papers in your projects.

## Architecture

```
paper_explorer/
├── backend/                  # FastAPI Python server
│   ├── main.py               # API endpoints
│   ├── database.py           # PostgreSQL connection & schema initialization
│   ├── models.py             # Pydantic schemas
│   └── services/
│       ├── pdf_processor.py  # PDF parsing -> text chunks & metadata (PyMuPDF)
│       ├── embedding.py      # OpenAI-compatible embedding service client
│       ├── similarity.py     # NumPy-based Cosine similarity helper
│       ├── llm_service.py    # OpenAI-compatible LLM service client
│       └── storage.py        # Storage abstraction (Local or Google Cloud Storage)
├── frontend/                 # React + TypeScript + Vite + Tailwind CSS
│   └── src/
│       ├── App.tsx           # Switcher between LibraryView and ReaderView
│       ├── api/
│       │   └── index.ts      # Axios API definition and typings
│       └── components/
│           ├── LibraryView.tsx       # Project and Paper listing, uploads, project assignment
│           ├── ReaderView.tsx        # Main double-pane PDF reading interface
│           ├── PDFPanel.tsx          # PDF renderer, text highlighting, hover actions
│           ├── ContextPanel.tsx      # Sidebar with Highlights, Links, Similarities, Q&A, and Notes
│           └── ConnectionOverlay.tsx # SVG overlay rendering similarity and link lines
└── docker-compose.yml
```

## Running the Stack

Everything runs via Docker Compose:

```bash
docker compose up --build
```

### Services
- **Frontend**: `http://localhost:5173` (Vite dev server with hot-reload)
- **Backend API**: `http://localhost:8000` (FastAPI, auto-reloads from mounted volume)
- **PostgreSQL**: `localhost:5432` (user/password/paper_explorer)
- **Ollama / Local LLM**: Configurable via environment variables.

---

## Configuration & Environment Variables

Key backend configurations are loaded in `backend/main.py` via python-dotenv:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:password@localhost:5432/paper_explorer` | DB connection string |
| `STORAGE_BACKEND` | `local` | `'local'` or `'gcs'` |
| `LOCAL_STORAGE_PATH` | `./storage` | Location to save uploaded PDFs locally |
| `GCS_BUCKET_NAME` | `paper-explorer` | GCS Bucket Name (if using Google Cloud Storage) |
| `EMBEDDING_BASE_URL` | `http://localhost:1234/v1` | Base URL for OpenAI-compatible embedding API |
| `EMBEDDING_API_KEY` | `lm-studio` | API Key for embedding |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model identifier |
| `LLM_BASE_URL` | `http://localhost:1234/v1` | Base URL for OpenAI-compatible LLM API |
| `LLM_API_KEY` | `lm-studio` | API Key for LLM |
| `LLM_MODEL` | `gemma3` | LLM model identifier |

---

## Data Model

PostgreSQL database initialized on startup (`database.py:init_db`).

- **projects** — top-level containers
- **papers** — PDF records; stores title, filename, DOI, and abstract
- **paper_projects** — many-to-many junction table linking papers to projects
- **tags** — content or paper tags (scoped per-project or global)
- **paper_tags** — many-to-many junction table between papers and tags
- **passages** — user highlights (text block, page number, coordinates `rects` stored as JSON, and serialized embedding vector)
- **passage_tags** — many-to-many junction table between passages and tags
- **notes** — comments annotated on passages (or tags) with serialized embeddings
- **note_passages** / **note_tags** — connection tables mapping notes to passages and tags
- **chunks** — full-text segments parsed from PDFs on upload, stored at three granularity levels: `block` (PyMuPDF text block), `paragraph` (blank-line split of a block), and `sentence` (punctuation-boundary split of a paragraph). Each row carries a `granularity TEXT` field and a `parent_id INTEGER` self-reference (sentence → paragraph → block). All three levels share the enclosing block's normalized bounding rect. Used for similarity search and Q&A.
- **passage_links** — manual bidirectional links established between passages
- **svm_models** — metadata for SVM-based classifiers (legacy)

---

## Core Backend Logic

### PDF Processing (`pdf_processor.py`)
Utilizes `PyMuPDF` (`fitz`) to extract text and compute normalized bounding box coordinates (`x`, `y`, `width`, `height`). On upload, `extract_chunks_hierarchical` produces three granularity levels per PDF block: the block itself, its paragraphs (split on blank lines), and their sentences (split on punctuation boundaries). All sub-units inherit the enclosing block's bounding rect — word-level rect computation per sentence is a planned improvement. Also extracts DOIs and arXiv IDs from the first pages.

### Embeddings (`embedding.py`)
Sends text to an OpenAI-compatible embedding endpoint (e.g., LM Studio, Ollama, OpenAI) to generate vector embeddings. Used for highlights, note content, and parsed PDF chunks.

### Similarity Searching (`similarity.py`)
Applies Cosine Similarity over candidate text/passage embeddings in Python using NumPy:
$$\text{similarity} = \frac{\mathbf{u} \cdot \mathbf{v}}{\|\mathbf{u}\| \|\mathbf{v}\|}$$
Used to display related highlights/chunks in the "Similar" tab.

Candidates are `sentence` and `paragraph` chunks from other papers in the project (plus user passage highlights). Resolution rule: if both a sentence and its parent paragraph rank in results, the **sentence wins** and the paragraph is suppressed. If only the paragraph ranks, the paragraph is shown. Results are deduplicated by resolved display ID.

### Q&A vector search (`main.py:search_paper`)
1. Embeds the user's question.
2. Finds the top-k most similar `paragraph` (or legacy `block`) chunks within the paper via cosine similarity. Sentences are excluded here so the LLM receives sufficient context per passage.
3. Formulates a prompt appending the context from the matching chunks.
4. Feeds the prompt to the LLM service to synthesize a concise, source-based answer.

---

## Frontend Components

The React UI is split into two primary modes controlled by `App.tsx`:
1. **LibraryView.tsx**:
   - Manage projects (create, delete).
   - Upload papers, delete papers, and assign them to projects.
   - Click a paper in a project to open it in `ReaderView`.
2. **ReaderView.tsx**:
   - Manages layout with a header, side-by-side PDF panels, and the `ContextPanel` sidebar.
   - **PDFPanel.tsx**:
     - Renders PDF pages using `react-pdf`.
     - Supports text selection to trigger highlighting with adjustable colors.
     - Displays tags, toolbar actions (delete, tag, link), and draws overlays.
   - **ContextPanel.tsx**:
     - Sidebar tracking information relative to the active highlight selection.
     - Tabs:
       - **Highlights**: Browse all highlights in the paper.
       - **Links**: Manage manual links connecting to other papers.
       - **Similar**: List automatically retrieved similar segments (highlights and chunks) across other papers in the project.
       - **Search**: Perform semantic Q&A about the document.
       - **Notes**: Read and write annotations on the selected highlight.
   - **ConnectionOverlay.tsx**:
     - Standard SVG canvas layered on top of both panels.
     - Computes cubic Bezier curves in absolute DOM screen space to visually connect passages between the left and right PDF panels.
     - Draws purple lines for semantic similarity and solid teal lines for manual passage links.

---

## Common Tasks

### Adding a new endpoint
1. Define any request/response validation schemas in `backend/models.py`.
2. Write the FastAPI endpoint handler in `backend/main.py`.
3. If necessary, write custom SQL utility functions in `backend/database.py`.
4. Register the client method inside `frontend/src/api/index.ts`.

### Changing the Embedding or LLM Provider
Set the environment variables `EMBEDDING_BASE_URL` / `LLM_BASE_URL` and `EMBEDDING_MODEL` / `LLM_MODEL` to match your local Ollama instance, LM Studio endpoint, or OpenAI API credentials in `docker-compose.yml` or your `.env` configuration file.

### Reprocessing chunks for an existing paper
If a paper was uploaded before the hierarchical chunk extraction was introduced, call:
```
POST /papers/{paper_id}/reprocess-chunks
```
This deletes all existing chunks for that paper and re-runs `extract_chunks_hierarchical` on the stored PDF, inserting block, paragraph, and sentence chunks with correct `parent_id` references. Returns `{"paper_id": ..., "chunks_inserted": N}`.
