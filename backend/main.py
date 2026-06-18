import io
import json
import os
from pathlib import Path
from typing import List, Optional

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

load_dotenv()

from file_store import FileStore
from models import (
    ChunkMeta, ChunkMetaResponse, EmbedRequest, EmbedResponse,
    FetchMetadataRequest, Note, NoteCreate, NoteUpdate,
    Paper, PaperMetadataResult, PaperUpdate, Passage, PassageCreate,
    PassageLink, PassageLinkDetail, PassageUpdate,
    Project, ProjectCreate, ProjectUpdate,
    SearchQuery, SearchResponse, Tag, TagCreate, TagUpdate,
)
from services.embedding import get_embedding_service
from services.llm_service import get_llm_service
from services.metadata_service import fetch_paper_metadata
from services.pdf_processor import extract_arxiv_id, extract_chunks_hierarchical, extract_doi, extract_title_from_pdf
from services.similarity import find_similar
from services.storage import get_storage

app = FastAPI(title="Paper Explorer API v2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_store: Optional[FileStore] = None


def store() -> FileStore:
    global _store
    if _store is None:
        _store = FileStore(get_storage())
    return _store


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _paper_response(meta: dict) -> dict:
    return {**meta, "url": f"/api/papers/{meta['id']}/pdf"}


def _hydrate_passage(p: dict, tags_lookup: dict) -> dict:
    """Return a passage dict with tags hydrated and embedding stripped."""
    return {
        "id": p["id"],
        "paper_id": p["paper_id"],
        "page": p["page"],
        "text": p["text"],
        "rects": p.get("rects", []),
        "color": p.get("color", "#FDE047"),
        "created_at": p["created_at"],
        "tags": [tags_lookup[tid] for tid in p.get("tag_ids", []) if tid in tags_lookup],
    }


def _tags_lookup(project_id: Optional[int] = None) -> dict:
    tags = store().list_tags()
    return {t["id"]: t for t in tags}


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@app.get("/projects", response_model=List[Project])
def list_projects():
    return store().list_projects()


@app.post("/projects", response_model=Project)
def create_project(project: ProjectCreate):
    return store().create_project(project.name, project.description)


@app.patch("/projects/{project_id}", response_model=Project)
def update_project(project_id: int, update: ProjectUpdate):
    result = store().update_project(project_id, {"name": update.name, "description": update.description})
    if not result:
        raise HTTPException(status_code=404, detail="Project not found")
    return result


@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    if not store().get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    store().delete_project(project_id)
    return {"message": "Project deleted"}


# ---------------------------------------------------------------------------
# Papers
# ---------------------------------------------------------------------------

@app.get("/papers", response_model=List[Paper])
def list_all_papers():
    results = []
    for pid in store().list_paper_ids():
        meta = store().read_metadata(pid)
        if meta:
            results.append(_paper_response(meta))
    return sorted(results, key=lambda p: p["created_at"], reverse=True)


@app.get("/projects/{project_id}/papers", response_model=List[Paper])
def list_papers(project_id: int):
    results = []
    for pid in store().list_paper_ids():
        meta = store().read_metadata(pid)
        if meta and project_id in meta.get("project_ids", []):
            results.append(_paper_response(meta))
    return sorted(results, key=lambda p: p["created_at"], reverse=True)


@app.get("/papers/{paper_id}", response_model=Paper)
def get_paper(paper_id: int):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    return _paper_response(meta)


@app.get("/papers/{paper_id}/pdf")
def get_paper_pdf(paper_id: int):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    try:
        stream = get_storage().stream(f"papers/{paper_id}/{meta['filename']}")
        return StreamingResponse(
            stream, media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename={meta['filename']}"},
        )
    except Exception:
        raise HTTPException(status_code=404, detail="PDF not found in storage")


@app.patch("/papers/{paper_id}", response_model=Paper)
def update_paper(paper_id: int, update: PaperUpdate):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    for field in ("title", "doi", "arxiv_id", "abstract"):
        val = getattr(update, field, None)
        if val is not None:
            meta[field] = val
    store().write_metadata(paper_id, meta)
    return _paper_response(meta)


@app.delete("/papers/{paper_id}")
def delete_paper(paper_id: int):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    store().delete_paper_files(paper_id, meta["filename"])
    return {"message": "Paper deleted"}


@app.post("/papers/{paper_id}/projects/{project_id}")
def add_paper_to_project(paper_id: int, project_id: int):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    if project_id not in meta.get("project_ids", []):
        meta.setdefault("project_ids", []).append(project_id)
        store().write_metadata(paper_id, meta)
    return {"message": "Paper added to project"}


@app.delete("/papers/{paper_id}/projects/{project_id}")
def remove_paper_from_project(paper_id: int, project_id: int):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    meta["project_ids"] = [pid for pid in meta.get("project_ids", []) if pid != project_id]
    store().write_metadata(paper_id, meta)
    return {"message": "Paper removed from project"}


@app.post("/papers/{paper_id}/fetch-metadata", response_model=PaperMetadataResult)
def fetch_metadata(paper_id: int, req: FetchMetadataRequest):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    doi = req.doi or meta.get("doi")
    arxiv_id = req.arxiv_id or meta.get("arxiv_id")
    title = req.title or meta.get("title")
    result = fetch_paper_metadata(doi=doi, title=title, arxiv_id=arxiv_id)
    if not result:
        raise HTTPException(status_code=404, detail="No metadata found for this paper")
    return result


def _process_and_store_paper(pdf_bytes: bytes, filename: str) -> dict:
    title = extract_title_from_pdf(pdf_bytes) or Path(filename).stem
    doi = extract_doi(pdf_bytes)
    arxiv_id = extract_arxiv_id(pdf_bytes)

    meta = store().create_metadata(title, filename, doi, arxiv_id)
    paper_id = meta["id"]

    get_storage().upload(io.BytesIO(pdf_bytes), f"papers/{paper_id}/{filename}", "application/pdf")

    try:
        blocks = extract_chunks_hierarchical(pdf_bytes)
        if blocks:
            emb_service = get_embedding_service()
            ordered = []
            for block in blocks:
                block_idx = len(ordered)
                ordered.append({"page": block["page"], "text": block["text"], "rects": block["rects"],
                                 "granularity": "block", "parent_idx": -1})
                for para in block["paragraphs"]:
                    para_idx = len(ordered)
                    ordered.append({"page": block["page"], "text": para["text"], "rects": para["rects"],
                                     "granularity": "paragraph", "parent_idx": block_idx})
                    for sent in para["sentences"]:
                        ordered.append({"page": block["page"], "text": sent["text"], "rects": sent["rects"],
                                         "granularity": "sentence", "parent_idx": para_idx})

            texts = [item["text"] for item in ordered]
            embeddings = emb_service.embed_batch(texts)
            pages = [item["page"] for item in ordered]
            granularities = [item["granularity"] for item in ordered]
            parent_indices = [item["parent_idx"] for item in ordered]
            rects_flat = [
                [r["x"], r["y"], r["width"], r["height"]]
                for item in ordered
                for r in (item["rects"][:1] or [{"x": 0, "y": 0, "width": 0, "height": 0}])
            ]
            store().write_chunks(paper_id, texts, embeddings, pages, granularities, parent_indices, rects_flat)
    except Exception as e:
        print(f"Chunk extraction failed: {e}")

    try:
        ext_meta = fetch_paper_metadata(doi=doi, title=title, arxiv_id=arxiv_id)
        if ext_meta:
            if ext_meta.get("title"):
                meta["title"] = ext_meta["title"]
            if ext_meta.get("doi") and not doi:
                meta["doi"] = ext_meta["doi"]
            if ext_meta.get("abstract"):
                meta["abstract"] = ext_meta["abstract"]
            store().write_metadata(paper_id, meta)
    except Exception as e:
        print(f"Metadata auto-fetch failed: {e}")

    return meta


@app.post("/papers", response_model=Paper)
def upload_paper(file: UploadFile = File(...)):
    pdf_bytes = file.file.read()
    meta = _process_and_store_paper(pdf_bytes, file.filename)
    return _paper_response(meta)


@app.post("/projects/{project_id}/papers", response_model=Paper)
def upload_paper_to_project(project_id: int, file: UploadFile = File(...)):
    if not store().get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    pdf_bytes = file.file.read()
    meta = _process_and_store_paper(pdf_bytes, file.filename)
    meta.setdefault("project_ids", []).append(project_id)
    store().write_metadata(meta["id"], meta)
    return _paper_response(meta)


@app.post("/papers/{paper_id}/reprocess-chunks")
def reprocess_chunks(paper_id: int):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")
    try:
        pdf_bytes = get_storage().download(f"papers/{paper_id}/{meta['filename']}")
    except Exception:
        raise HTTPException(status_code=404, detail="PDF not found in storage")

    store().delete_chunks(paper_id)

    try:
        blocks = extract_chunks_hierarchical(pdf_bytes)
        if not blocks:
            return {"paper_id": paper_id, "chunks_inserted": 0}
        emb_service = get_embedding_service()
        ordered = []
        for block in blocks:
            block_idx = len(ordered)
            ordered.append({"page": block["page"], "text": block["text"], "rects": block["rects"],
                             "granularity": "block", "parent_idx": -1})
            for para in block["paragraphs"]:
                para_idx = len(ordered)
                ordered.append({"page": block["page"], "text": para["text"], "rects": para["rects"],
                                 "granularity": "paragraph", "parent_idx": block_idx})
                for sent in para["sentences"]:
                    ordered.append({"page": block["page"], "text": sent["text"], "rects": sent["rects"],
                                     "granularity": "sentence", "parent_idx": para_idx})

        texts = [item["text"] for item in ordered]
        embeddings = emb_service.embed_batch(texts)
        pages = [item["page"] for item in ordered]
        granularities = [item["granularity"] for item in ordered]
        parent_indices = [item["parent_idx"] for item in ordered]
        rects_flat = [
            [r["x"], r["y"], r["width"], r["height"]]
            for item in ordered
            for r in (item["rects"][:1] or [{"x": 0, "y": 0, "width": 0, "height": 0}])
        ]
        store().write_chunks(paper_id, texts, embeddings, pages, granularities, parent_indices, rects_flat)
        return {"paper_id": paper_id, "chunks_inserted": len(ordered)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reprocessing failed: {e}")


# ---------------------------------------------------------------------------
# Chunks (served to frontend for client-side similarity)
# ---------------------------------------------------------------------------

@app.get("/papers/{paper_id}/chunks", response_model=ChunkMetaResponse)
def get_paper_chunks(paper_id: int):
    npz = store().load_chunks_npz(paper_id)
    if npz is None:
        raise HTTPException(status_code=404, detail="Chunks not found — paper may need reprocessing")
    texts = npz["texts"].tolist()
    pages = npz["pages"].tolist()
    granularities = npz["granularities"].tolist()
    parent_indices = npz["parent_indices"].tolist()
    rects_arr = npz["rects"]
    emb_dim = int(npz["embeddings"].shape[1]) if npz["embeddings"].ndim == 2 else 0

    chunks = [
        {
            "idx": i,
            "text": texts[i],
            "page": int(pages[i]),
            "granularity": granularities[i],
            "parent_idx": int(parent_indices[i]),
            "rects": [{"x": float(rects_arr[i, 0]), "y": float(rects_arr[i, 1]),
                       "width": float(rects_arr[i, 2]), "height": float(rects_arr[i, 3])}],
        }
        for i in range(len(texts))
    ]
    return {"embedding_dim": emb_dim, "chunks": chunks}


@app.get("/papers/{paper_id}/embeddings.bin")
def get_paper_embeddings(paper_id: int):
    """Serve chunk embeddings as a raw float32 little-endian binary blob (shape: N × D)."""
    npz = store().load_chunks_npz(paper_id)
    if npz is None:
        raise HTTPException(status_code=404, detail="Chunks not found")
    emb_f32 = npz["embeddings"].astype(np.float32)
    return Response(
        content=emb_f32.tobytes(),
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Passages
# ---------------------------------------------------------------------------

@app.get("/papers/{paper_id}/passages", response_model=List[Passage])
def list_passages(paper_id: int):
    if not store().read_metadata(paper_id):
        raise HTTPException(status_code=404, detail="Paper not found")
    ann = store().read_annotations(paper_id)
    tags_lut = _tags_lookup()
    return [_hydrate_passage(p, tags_lut) for p in ann.get("passages", [])]


@app.get("/papers/{paper_id}/passages/embeddings")
def get_passage_embeddings(paper_id: int):
    """Return passage embeddings for client-side similarity search."""
    ann = store().read_annotations(paper_id)
    return [
        {"id": p["id"], "embedding": p["embedding"]}
        for p in ann.get("passages", [])
        if p.get("embedding")
    ]


@app.post("/papers/{paper_id}/passages", response_model=Passage)
def create_passage(paper_id: int, passage: PassageCreate):
    if not store().read_metadata(paper_id):
        raise HTTPException(status_code=404, detail="Paper not found")

    ws = store().read_workspace()
    pid = store()._alloc_id(ws)
    store()._write_workspace(ws)

    embedding = None
    try:
        embedding = get_embedding_service().embed(passage.text)
    except Exception as e:
        print(f"Passage embedding failed: {e}")

    from datetime import datetime, timezone
    new_passage = {
        "id": pid,
        "paper_id": paper_id,
        "page": passage.page,
        "text": passage.text,
        "rects": passage.rects,
        "color": passage.color or "#FDE047",
        "embedding": embedding,
        "tag_ids": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    ann = store().read_annotations(paper_id)
    ann.setdefault("passages", []).append(new_passage)
    store().write_annotations(paper_id, ann)

    tags_lut = _tags_lookup()
    return _hydrate_passage(new_passage, tags_lut)


@app.patch("/passages/{passage_id}", response_model=Passage)
def update_passage(passage_id: int, update: PassageUpdate):
    paper_id, _ = store().find_passage(passage_id)
    if paper_id is None:
        raise HTTPException(status_code=404, detail="Passage not found")
    ann = store().read_annotations(paper_id)
    tags_lut = _tags_lookup()
    for p in ann["passages"]:
        if p["id"] == passage_id:
            if update.color is not None:
                p["color"] = update.color
            store().write_annotations(paper_id, ann)
            return _hydrate_passage(p, tags_lut)
    raise HTTPException(status_code=404, detail="Passage not found")


@app.delete("/passages/{passage_id}")
def delete_passage(passage_id: int):
    paper_id, _ = store().find_passage(passage_id)
    if paper_id is None:
        raise HTTPException(status_code=404, detail="Passage not found")
    ann = store().read_annotations(paper_id)
    ann["passages"] = [p for p in ann["passages"] if p["id"] != passage_id]
    ann["notes"] = [n for n in ann.get("notes", []) if passage_id not in n.get("passage_ids", [])]
    store().write_annotations(paper_id, ann)
    return {"message": "Passage deleted"}


# ---------------------------------------------------------------------------
# Passage links
# ---------------------------------------------------------------------------

@app.get("/passages/{passage_id}/links", response_model=List[PassageLink])
def get_passage_links(passage_id: int):
    return store().get_passage_links(passage_id)


@app.post("/passages/{passage_id}/links/{other_id}", response_model=PassageLink)
def create_passage_link(passage_id: int, other_id: int):
    return store().create_passage_link(passage_id, other_id)


@app.delete("/passages/{passage_id}/links/{other_id}")
def delete_passage_link(passage_id: int, other_id: int):
    store().delete_passage_link(passage_id, other_id)
    return {"message": "Link deleted"}


@app.get("/papers/{paper_id}/links", response_model=List[PassageLinkDetail])
def get_paper_links(paper_id: int):
    links = store().get_paper_passage_links(paper_id)
    ann = store().read_annotations(paper_id)
    local_passages = {p["id"]: p for p in ann.get("passages", [])}
    tags_lut = _tags_lookup()

    result = []
    for link in links:
        p1_id, p2_id = link["passage_id_1"], link["passage_id_2"]
        local_id = p1_id if p1_id in local_passages else p2_id
        remote_id = p2_id if p1_id in local_passages else p1_id
        local_p = local_passages.get(local_id)
        if not local_p:
            continue

        remote_paper_id, remote_p = store().find_passage(remote_id)
        if not remote_p:
            continue
        remote_meta = store().read_metadata(remote_paper_id) or {}

        result.append({
            "id": link["id"],
            "created_at": link["created_at"],
            "local_passage_id": local_id,
            "local_passage_text": local_p["text"],
            "local_page": local_p["page"],
            "remote_passage_id": remote_id,
            "remote_passage_text": remote_p["text"],
            "remote_page": remote_p["page"],
            "remote_rects": remote_p.get("rects", []),
            "remote_paper_id": remote_paper_id,
            "remote_paper_title": remote_meta.get("title", ""),
        })
    return result


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

@app.get("/projects/{project_id}/tags", response_model=List[Tag])
def list_tags(project_id: int):
    return store().list_tags(project_id)


@app.post("/tags", response_model=Tag)
def create_tag(tag: TagCreate):
    result = store().create_tag(tag.name, tag.type, tag.project_id)
    if result is None:
        raise HTTPException(status_code=400, detail="Tag already exists")
    return result


@app.patch("/tags/{tag_id}", response_model=Tag)
def update_tag(tag_id: int, update: TagUpdate):
    result = store().update_tag(tag_id, update.name)
    if not result:
        raise HTTPException(status_code=404, detail="Tag not found")
    return result


@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: int):
    store().delete_tag(tag_id)
    return {"message": "Tag deleted"}


@app.post("/passages/{passage_id}/tags/{tag_id}")
def add_passage_tag(passage_id: int, tag_id: int):
    paper_id, _ = store().find_passage(passage_id)
    if paper_id is None:
        raise HTTPException(status_code=404, detail="Passage not found")
    ann = store().read_annotations(paper_id)
    for p in ann["passages"]:
        if p["id"] == passage_id:
            tag_ids = p.setdefault("tag_ids", [])
            if tag_id not in tag_ids:
                tag_ids.append(tag_id)
            store().write_annotations(paper_id, ann)
            return {"message": "Tag added"}
    raise HTTPException(status_code=404, detail="Passage not found")


@app.delete("/passages/{passage_id}/tags/{tag_id}")
def remove_passage_tag(passage_id: int, tag_id: int):
    paper_id, _ = store().find_passage(passage_id)
    if paper_id is None:
        raise HTTPException(status_code=404, detail="Passage not found")
    ann = store().read_annotations(paper_id)
    for p in ann["passages"]:
        if p["id"] == passage_id:
            p["tag_ids"] = [t for t in p.get("tag_ids", []) if t != tag_id]
            store().write_annotations(paper_id, ann)
            return {"message": "Tag removed"}
    raise HTTPException(status_code=404, detail="Passage not found")


@app.get("/tags/{tag_id}/passages", response_model=List[Passage])
def get_tag_passages(tag_id: int):
    tags_lut = _tags_lookup()
    result = []
    for pid in store().list_paper_ids():
        ann = store().read_annotations(pid)
        for p in ann.get("passages", []):
            if tag_id in p.get("tag_ids", []):
                result.append(_hydrate_passage(p, tags_lut))
    return result


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

def _hydrate_note(n: dict) -> dict:
    return {k: v for k, v in n.items() if k != "embedding"}


@app.post("/notes", response_model=Note)
def create_note(note: NoteCreate):
    # Determine paper from passage_ids
    paper_id = None
    for pid_candidate in (note.passage_ids or []):
        paper_id, _ = store().find_passage(pid_candidate)
        if paper_id:
            break
    if paper_id is None:
        raise HTTPException(status_code=400, detail="Could not determine paper from passage_ids")

    ws = store().read_workspace()
    note_id = store()._alloc_id(ws)
    store()._write_workspace(ws)

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    new_note = {
        "id": note_id,
        "type": note.type,
        "content": note.content,
        "passage_ids": note.passage_ids or [],
        "tag_ids": note.tag_ids or [],
        "created_at": now,
        "updated_at": now,
    }

    ann = store().read_annotations(paper_id)
    ann.setdefault("notes", []).append(new_note)
    store().write_annotations(paper_id, ann)

    return _hydrate_note(new_note)


@app.get("/passages/{passage_id}/notes", response_model=List[Note])
def get_passage_notes(passage_id: int):
    paper_id, _ = store().find_passage(passage_id)
    if paper_id is None:
        return []
    ann = store().read_annotations(paper_id)
    return [_hydrate_note(n) for n in ann.get("notes", []) if passage_id in n.get("passage_ids", [])]


@app.get("/tags/{tag_id}/notes", response_model=List[Note])
def get_tag_notes(tag_id: int):
    result = []
    for pid in store().list_paper_ids():
        ann = store().read_annotations(pid)
        for n in ann.get("notes", []):
            if tag_id in n.get("tag_ids", []):
                result.append(_hydrate_note(n))
    return result


@app.patch("/notes/{note_id}", response_model=Note)
def update_note(note_id: int, update: NoteUpdate):
    paper_id, _ = store().find_note(note_id)
    if paper_id is None:
        raise HTTPException(status_code=404, detail="Note not found")
    ann = store().read_annotations(paper_id)
    from datetime import datetime, timezone
    for n in ann["notes"]:
        if n["id"] == note_id:
            if update.content is not None:
                n["content"] = update.content
                n["updated_at"] = datetime.now(timezone.utc).isoformat()
            store().write_annotations(paper_id, ann)
            return _hydrate_note(n)
    raise HTTPException(status_code=404, detail="Note not found")


@app.delete("/notes/{note_id}")
def delete_note(note_id: int):
    paper_id, _ = store().find_note(note_id)
    if paper_id is None:
        raise HTTPException(status_code=404, detail="Note not found")
    ann = store().read_annotations(paper_id)
    ann["notes"] = [n for n in ann["notes"] if n["id"] != note_id]
    store().write_annotations(paper_id, ann)
    return {"message": "Note deleted"}


# ---------------------------------------------------------------------------
# Embedding (client-side similarity helper)
# ---------------------------------------------------------------------------

@app.post("/embed", response_model=EmbedResponse)
def embed_text(req: EmbedRequest):
    try:
        emb = get_embedding_service().embed(req.text)
        return {"embedding": emb}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Embedding service unavailable: {e}")


# ---------------------------------------------------------------------------
# Q&A
# ---------------------------------------------------------------------------

@app.post("/papers/{paper_id}/search", response_model=SearchResponse)
def search_paper(paper_id: int, query: SearchQuery):
    meta = store().read_metadata(paper_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Paper not found")

    try:
        query_emb = get_embedding_service().embed(query.query)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Embedding service unavailable: {e}")

    npz = store().load_chunks_npz(paper_id)
    if npz is None:
        raise HTTPException(status_code=404, detail="No chunks found for this paper")

    granularities = npz["granularities"].tolist()
    embeddings = npz["embeddings"].astype(np.float32).tolist()
    texts = npz["texts"].tolist()
    pages = npz["pages"].tolist()
    rects_arr = npz["rects"]

    candidates = [
        {"id": i, "embedding": embeddings[i]}
        for i, g in enumerate(granularities)
        if g in ("paragraph", "block")
    ]

    results = find_similar(query_emb, candidates, limit=query.limit)

    from models import ChunkResult
    chunks = [
        ChunkResult(
            chunk_id=idx,
            page=int(pages[idx]),
            text=texts[idx],
            similarity=sim,
            rects=[{"x": float(rects_arr[idx, 0]), "y": float(rects_arr[idx, 1]),
                    "width": float(rects_arr[idx, 2]), "height": float(rects_arr[idx, 3])}],
        )
        for idx, sim in results
    ]

    answer = None
    if chunks:
        try:
            context = "\n\n---\n\n".join(f"[Page {c.page + 1}] {c.text}" for c in chunks[:5])
            answer = get_llm_service().complete(
                prompt=(
                    f"Question: {query.query}\n\n"
                    f"Relevant passages from \"{meta['title']}\":\n\n{context}\n\n"
                    "Answer the question based only on the passages above. "
                    "Be concise. If the passages don't contain enough information, say so."
                ),
                system="You are a research assistant helping a scientist understand a paper. "
                       "Answer questions based strictly on the provided passages.",
            )
        except Exception as e:
            print(f"LLM synthesis failed: {e}")

    return SearchResponse(answer=answer, chunks=chunks)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"message": "Paper Explorer API v2"}


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
