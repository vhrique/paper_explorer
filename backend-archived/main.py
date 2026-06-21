"""
Stateless processing backend — no storage, no database.
Three responsibilities only:
  POST /papers/process  — parse PDF, embed chunks, return data for client to store
  POST /embed           — embed a text string, return vector
  POST /qa              — synthesize an LLM answer from caller-supplied context chunks
"""

import base64
from pathlib import Path
from typing import List, Optional

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

from services.embedding import get_embedding_service
from services.llm_service import get_llm_service
from services.metadata_service import fetch_paper_metadata
from services.pdf_processor import (
    extract_arxiv_id, extract_chunks_hierarchical,
    extract_doi, extract_title_from_pdf,
)

app = FastAPI(title="Paper Explorer — Processing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class ChunkMetaItem(BaseModel):
    idx: int
    text: str
    page: int
    granularity: str   # 'block' | 'paragraph' | 'sentence'
    parent_idx: int    # -1 for root chunks
    rects: List[dict]  # [{x, y, width, height}]


class ProcessResponse(BaseModel):
    """Everything the client needs to store a newly uploaded paper."""
    metadata: dict          # ready to write as metadata.json
    embeddings_bin_b64: str # base64-encoded flat float32 LE binary (N*D floats)
    chunk_meta: List[ChunkMetaItem]   # parallel metadata (texts, pages, rects)
    embedding_dim: int


class FetchMetadataRequest(BaseModel):
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    title: Optional[str] = None


class FetchMetadataResponse(BaseModel):
    title: Optional[str] = None
    doi: Optional[str] = None
    abstract: Optional[str] = None
    authors: Optional[List[str]] = None
    year: Optional[int] = None
    venue: Optional[str] = None
    source: str = ""


class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    embedding: List[float]


class QAChunk(BaseModel):
    text: str
    page: int

class QARequest(BaseModel):
    query: str
    paper_title: str
    chunks: List[QAChunk]   # top-k chunks already selected by the client

class QAResponse(BaseModel):
    answer: Optional[str] = None


# ---------------------------------------------------------------------------
# /papers/process
# ---------------------------------------------------------------------------

@app.post("/papers/process", response_model=ProcessResponse)
async def process_paper(file: UploadFile = File(...)):
    pdf_bytes = await file.read()
    filename = file.filename or "paper.pdf"

    # Extract basic info
    title = extract_title_from_pdf(pdf_bytes) or Path(filename).stem
    doi = extract_doi(pdf_bytes)
    arxiv_id = extract_arxiv_id(pdf_bytes)

    # Try to enrich metadata from external APIs
    abstract = None
    try:
        ext = fetch_paper_metadata(doi=doi, title=title, arxiv_id=arxiv_id)
        if ext:
            title = ext.get("title") or title
            doi = ext.get("doi") or doi
            abstract = ext.get("abstract")
    except Exception as e:
        print(f"Metadata fetch failed: {e}")

    metadata = {
        "title": title,
        "filename": filename,
        "doi": doi,
        "arxiv_id": arxiv_id,
        "abstract": abstract,
    }

    # Extract and embed chunks
    chunk_meta: List[ChunkMetaItem] = []
    chunks_npz_b64 = ""
    embedding_dim = 0

    try:
        blocks = extract_chunks_hierarchical(pdf_bytes)
        if blocks:
            ordered = []
            for block in blocks:
                block_idx = len(ordered)
                ordered.append({"page": block["page"], "text": block["text"],
                                 "rects": block["rects"], "granularity": "block", "parent_idx": -1})
                for para in block["paragraphs"]:
                    para_idx = len(ordered)
                    ordered.append({"page": block["page"], "text": para["text"],
                                     "rects": para["rects"], "granularity": "paragraph", "parent_idx": block_idx})
                    for sent in para["sentences"]:
                        ordered.append({"page": block["page"], "text": sent["text"],
                                         "rects": sent["rects"], "granularity": "sentence", "parent_idx": para_idx})

            texts = [item["text"] for item in ordered]
            embeddings = get_embedding_service().embed_batch(texts)
            embedding_dim = len(embeddings[0]) if embeddings else 0

            rects_flat = [
                item["rects"][0] if item["rects"] else {"x": 0, "y": 0, "width": 0, "height": 0}
                for item in ordered
            ]

            chunk_meta = [
                ChunkMetaItem(
                    idx=i,
                    text=ordered[i]["text"],
                    page=ordered[i]["page"],
                    granularity=ordered[i]["granularity"],
                    parent_idx=ordered[i]["parent_idx"],
                    rects=[rects_flat[i]],
                )
                for i in range(len(ordered))
            ]

            # Build flat float32 binary (row-major N×D)
            emb_array = np.array(embeddings, dtype=np.float32)
            chunks_npz_b64 = base64.b64encode(emb_array.tobytes()).decode()
    except Exception as e:
        print(f"Chunk extraction/embedding failed: {e}")

    return ProcessResponse(
        metadata=metadata,
        embeddings_bin_b64=chunks_npz_b64,
        chunk_meta=chunk_meta,
        embedding_dim=embedding_dim,
    )


# ---------------------------------------------------------------------------
# /embed
# ---------------------------------------------------------------------------

@app.post("/embed", response_model=EmbedResponse)
def embed_text(req: EmbedRequest):
    try:
        return EmbedResponse(embedding=get_embedding_service().embed(req.text))
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Embedding service unavailable: {e}")


# ---------------------------------------------------------------------------
# /qa
# ---------------------------------------------------------------------------

@app.post("/qa", response_model=QAResponse)
def answer_question(req: QARequest):
    if not req.chunks:
        return QAResponse(answer=None)
    try:
        context = "\n\n---\n\n".join(f"[Page {c.page + 1}] {c.text}" for c in req.chunks)
        answer = get_llm_service().complete(
            prompt=(
                f"Question: {req.query}\n\n"
                f"Relevant passages from \"{req.paper_title}\":\n\n{context}\n\n"
                "Answer the question based only on the passages above. "
                "Be concise. If the passages don't contain enough information, say so."
            ),
            system="You are a research assistant helping a scientist understand a paper. "
                   "Answer questions based strictly on the provided passages.",
        )
        return QAResponse(answer=answer)
    except Exception as e:
        print(f"LLM failed: {e}")
        return QAResponse(answer=None)


# ---------------------------------------------------------------------------
# /fetch-metadata
# ---------------------------------------------------------------------------

@app.post("/fetch-metadata", response_model=FetchMetadataResponse)
def fetch_metadata(req: FetchMetadataRequest):
    try:
        result = fetch_paper_metadata(doi=req.doi, title=req.title, arxiv_id=req.arxiv_id)
        if not result:
            raise HTTPException(status_code=404, detail="No metadata found")
        return FetchMetadataResponse(**{k: result.get(k) for k in FetchMetadataResponse.model_fields})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"message": "Paper Explorer Processing API"}


@app.get("/health")
def health():
    status = {"api": "ok", "embedding": "unknown", "llm": "unknown"}
    try:
        get_embedding_service().embed("health check")
        status["embedding"] = "ok"
    except Exception as e:
        status["embedding"] = f"error: {e}"
    try:
        get_llm_service().complete("Reply with the single word: ok", system="Reply with exactly one word.")
        status["llm"] = "ok"
    except Exception as e:
        status["llm"] = f"error: {e}"
    return status
