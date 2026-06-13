import io
import json
import os
from pathlib import Path
from typing import List, Optional

import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv()  # loads .env if present; env vars already set take precedence

from database import (
    execute, execute_returning, fetchall, fetchone,
    embedding_to_json, json_to_embedding, init_db
)
from models import (
    ChunkResult, Note, NoteCreate, NoteUpdate,
    Paper, PaperUpdate, Passage, PassageCreate, PassageLink, PassageUpdate,
    Project, ProjectCreate, ProjectUpdate,
    SearchQuery, SearchResponse, SimilarPassage, Tag, TagCreate, TagUpdate,
)
from services.embedding import get_embedding_service
from services.llm_service import get_llm_service
from services.pdf_processor import extract_chunks, extract_doi
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

storage = get_storage()


@app.on_event("startup")
def startup():
    init_db()


# ---------------------------------------------------------------------------
# Files (local storage proxy)
# ---------------------------------------------------------------------------

@app.get("/files/{file_path:path}")
def serve_file(file_path: str):
    try:
        data = storage.stream(file_path)
        media_type = "application/pdf" if file_path.endswith(".pdf") else "application/octet-stream"
        return StreamingResponse(data, media_type=media_type)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@app.get("/projects", response_model=List[Project])
def list_projects():
    return fetchall("SELECT * FROM projects ORDER BY created_at DESC")


@app.post("/projects", response_model=Project)
def create_project(project: ProjectCreate):
    return execute_returning(
        "INSERT INTO projects (name, description) VALUES (%s, %s) RETURNING *",
        (project.name, project.description)
    )


@app.patch("/projects/{project_id}", response_model=Project)
def update_project(project_id: int, update: ProjectUpdate):
    existing = fetchone("SELECT * FROM projects WHERE id = %s", (project_id,))
    if not existing:
        raise HTTPException(status_code=404, detail="Project not found")

    fields, params = [], []
    if update.name is not None:
        fields.append("name = %s"); params.append(update.name)
    if update.description is not None:
        fields.append("description = %s"); params.append(update.description)
    if not fields:
        return existing

    params.append(project_id)
    return execute_returning(
        f"UPDATE projects SET {', '.join(fields)} WHERE id = %s RETURNING *", tuple(params)
    )


@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    execute("DELETE FROM projects WHERE id = %s", (project_id,))
    return {"message": "Project deleted"}


# ---------------------------------------------------------------------------
# Papers
# ---------------------------------------------------------------------------

def _paper_with_meta(row: dict) -> dict:
    paper = dict(row)
    paper["url"] = f"/api/papers/{paper['id']}/pdf"
    paper["project_ids"] = [
        r["project_id"] for r in
        fetchall("SELECT project_id FROM paper_projects WHERE paper_id = %s", (paper["id"],))
    ]
    return paper


@app.get("/papers", response_model=List[Paper])
def list_all_papers():
    rows = fetchall("SELECT * FROM papers ORDER BY created_at DESC")
    return [_paper_with_meta(r) for r in rows]


@app.get("/projects/{project_id}/papers", response_model=List[Paper])
def list_papers(project_id: int):
    rows = fetchall("""
        SELECT p.* FROM papers p
        JOIN paper_projects pp ON pp.paper_id = p.id
        WHERE pp.project_id = %s
        ORDER BY p.created_at DESC
    """, (project_id,))
    return [_paper_with_meta(r) for r in rows]


@app.get("/papers/{paper_id}", response_model=Paper)
def get_paper(paper_id: int):
    row = fetchone("SELECT * FROM papers WHERE id = %s", (paper_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    return _paper_with_meta(row)


@app.get("/papers/{paper_id}/pdf")
def get_paper_pdf(paper_id: int):
    row = fetchone("SELECT filename FROM papers WHERE id = %s", (paper_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    try:
        stream = storage.stream(f"pdfs/{paper_id}/{row['filename']}")
        return StreamingResponse(
            stream, media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename={row['filename']}"}
        )
    except Exception:
        raise HTTPException(status_code=404, detail="PDF not found in storage")


def _create_paper_from_upload(pdf_bytes: bytes, filename: str) -> dict:
    title = Path(filename).stem
    doi = extract_doi(pdf_bytes)

    storage.upload(io.BytesIO(pdf_bytes), f"pdfs/temp/{filename}", content_type="application/pdf")
    paper = execute_returning(
        "INSERT INTO papers (title, filename, doi) VALUES (%s, %s, %s) RETURNING *",
        (title, filename, doi)
    )
    paper_id = paper["id"]
    storage.upload(io.BytesIO(pdf_bytes), f"pdfs/{paper_id}/{filename}", content_type="application/pdf")
    storage.delete(f"pdfs/temp/{filename}")

    try:
        chunks = extract_chunks(pdf_bytes)
        if chunks:
            emb_service = get_embedding_service()
            embeddings = emb_service.embed_batch([c["text"] for c in chunks])
            from database import get_db_connection
            conn = get_db_connection()
            cur = conn.cursor()
            for chunk, emb in zip(chunks, embeddings):
                cur.execute(
                    "INSERT INTO chunks (paper_id, page, text, rects, embedding) VALUES (%s, %s, %s, %s, %s)",
                    (paper_id, chunk["page"], chunk["text"],
                     json.dumps(chunk["rects"]), embedding_to_json(emb))
                )
            conn.commit()
            conn.close()
    except Exception as e:
        print(f"Chunk extraction/embedding failed: {e}")

    return paper


@app.post("/papers", response_model=Paper)
def upload_paper(file: UploadFile = File(...)):
    pdf_bytes = file.file.read()
    paper = _create_paper_from_upload(pdf_bytes, file.filename)
    return _paper_with_meta(paper)


@app.post("/projects/{project_id}/papers", response_model=Paper)
def upload_paper_to_project(project_id: int, file: UploadFile = File(...)):
    project = fetchone("SELECT id FROM projects WHERE id = %s", (project_id,))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    pdf_bytes = file.file.read()
    paper = _create_paper_from_upload(pdf_bytes, file.filename)
    execute(
        "INSERT INTO paper_projects (paper_id, project_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (paper["id"], project_id)
    )
    return _paper_with_meta(paper)


@app.post("/papers/{paper_id}/projects/{project_id}")
def add_paper_to_project(paper_id: int, project_id: int):
    execute(
        "INSERT INTO paper_projects (paper_id, project_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (paper_id, project_id)
    )
    return {"message": "Paper added to project"}


@app.delete("/papers/{paper_id}/projects/{project_id}")
def remove_paper_from_project(paper_id: int, project_id: int):
    execute(
        "DELETE FROM paper_projects WHERE paper_id = %s AND project_id = %s",
        (paper_id, project_id)
    )
    return {"message": "Paper removed from project"}


@app.patch("/papers/{paper_id}", response_model=Paper)
def update_paper(paper_id: int, update: PaperUpdate):
    row = fetchone("SELECT * FROM papers WHERE id = %s", (paper_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")

    fields, params = [], []
    if update.title is not None:
        fields.append("title = %s"); params.append(update.title)
    if update.doi is not None:
        fields.append("doi = %s"); params.append(update.doi)
    if update.abstract is not None:
        fields.append("abstract = %s"); params.append(update.abstract)
    if not fields:
        return _paper_with_meta(row)

    params.append(paper_id)
    updated = execute_returning(
        f"UPDATE papers SET {', '.join(fields)} WHERE id = %s RETURNING *", tuple(params)
    )
    return _paper_with_meta(updated)


@app.delete("/papers/{paper_id}")
def delete_paper(paper_id: int):
    row = fetchone("SELECT filename FROM papers WHERE id = %s", (paper_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    execute("DELETE FROM papers WHERE id = %s", (paper_id,))
    try:
        storage.delete(f"pdfs/{paper_id}/{row['filename']}")
    except Exception as e:
        print(f"Could not delete PDF from storage: {e}")
    return {"message": "Paper deleted"}


# ---------------------------------------------------------------------------
# Passages
# ---------------------------------------------------------------------------

def _passage_with_tags(row: dict) -> dict:
    passage = dict(row)
    passage["rects"] = json.loads(passage.get("rects") or "[]")
    passage["tags"] = fetchall("""
        SELECT t.* FROM tags t
        JOIN passage_tags pt ON pt.tag_id = t.id
        WHERE pt.passage_id = %s
    """, (passage["id"],))
    return passage


@app.get("/papers/{paper_id}/passages", response_model=List[Passage])
def list_passages(paper_id: int):
    rows = fetchall(
        "SELECT * FROM passages WHERE paper_id = %s ORDER BY page, created_at",
        (paper_id,)
    )
    return [_passage_with_tags(r) for r in rows]


@app.post("/papers/{paper_id}/passages", response_model=Passage)
def create_passage(paper_id: int, passage: PassageCreate):
    paper = fetchone("SELECT id FROM papers WHERE id = %s", (paper_id,))
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    row = execute_returning(
        "INSERT INTO passages (paper_id, page, text, rects, color) VALUES (%s, %s, %s, %s, %s) RETURNING *",
        (paper_id, passage.page, passage.text, json.dumps(passage.rects), passage.color)
    )

    # Generate and store embedding
    try:
        emb = get_embedding_service().embed(passage.text)
        execute(
            "UPDATE passages SET embedding = %s WHERE id = %s",
            (embedding_to_json(emb), row["id"])
        )
    except Exception as e:
        print(f"Passage embedding failed: {e}")

    return _passage_with_tags(row)


@app.patch("/passages/{passage_id}", response_model=Passage)
def update_passage(passage_id: int, update: PassageUpdate):
    row = fetchone("SELECT * FROM passages WHERE id = %s", (passage_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Passage not found")

    if update.color is not None:
        row = execute_returning(
            "UPDATE passages SET color = %s WHERE id = %s RETURNING *",
            (update.color, passage_id)
        )
    return _passage_with_tags(row)


@app.delete("/passages/{passage_id}")
def delete_passage(passage_id: int):
    tag_ids = [r["tag_id"] for r in fetchall(
        "SELECT tag_id FROM passage_tags WHERE passage_id = %s", (passage_id,)
    )]
    execute("DELETE FROM passages WHERE id = %s", (passage_id,))
    for tag_id in tag_ids:
        still_used = fetchone("SELECT 1 FROM passage_tags WHERE tag_id = %s LIMIT 1", (tag_id,))
        if not still_used:
            execute("DELETE FROM tags WHERE id = %s", (tag_id,))
    return {"message": "Passage deleted"}


@app.post("/passages/{passage_id}/links/{other_id}", response_model=PassageLink)
def create_passage_link(passage_id: int, other_id: int):
    p1, p2 = min(passage_id, other_id), max(passage_id, other_id)
    row = fetchone(
        "INSERT INTO passage_links (passage_id_1, passage_id_2) VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING *",
        (p1, p2)
    )
    if not row:
        row = fetchone(
            "SELECT * FROM passage_links WHERE passage_id_1 = %s AND passage_id_2 = %s",
            (p1, p2)
        )
    return row


@app.get("/passages/{passage_id}/links", response_model=List[PassageLink])
def get_passage_links(passage_id: int):
    return fetchall(
        "SELECT * FROM passage_links WHERE passage_id_1 = %s OR passage_id_2 = %s ORDER BY created_at DESC",
        (passage_id, passage_id)
    )


@app.delete("/passages/{passage_id}/links/{other_id}")
def delete_passage_link(passage_id: int, other_id: int):
    p1, p2 = min(passage_id, other_id), max(passage_id, other_id)
    execute("DELETE FROM passage_links WHERE passage_id_1 = %s AND passage_id_2 = %s", (p1, p2))
    return {"message": "Link deleted"}


@app.get("/passages/{passage_id}/similar", response_model=List[SimilarPassage])
def get_similar_passages(passage_id: int, limit: int = 10):
    passage = fetchone("SELECT * FROM passages WHERE id = %s", (passage_id,))
    if not passage:
        raise HTTPException(status_code=404, detail="Passage not found")

    query_emb = json_to_embedding(passage.get("embedding"))
    if not query_emb:
        raise HTTPException(status_code=400, detail="Passage has no embedding yet")

    project_ids_subquery = "SELECT project_id FROM paper_projects WHERE paper_id = %s"

    # Passage candidates (highlights from other papers in the same project)
    passage_rows = fetchall("""
        SELECT p.*, pa.title as paper_title, 'passage' as source
        FROM passages p
        JOIN papers pa ON pa.id = p.paper_id
        JOIN paper_projects pp ON pp.paper_id = pa.id
        WHERE pp.project_id IN ({})
        AND pa.id != %s
        AND p.embedding IS NOT NULL
    """.format(project_ids_subquery), (passage["paper_id"], passage["paper_id"]))

    # Chunk candidates (raw chunks from other papers in the same project)
    chunk_rows = fetchall("""
        SELECT c.*, pa.title as paper_title, 'chunk' as source
        FROM chunks c
        JOIN papers pa ON pa.id = c.paper_id
        JOIN paper_projects pp ON pp.paper_id = pa.id
        WHERE pp.project_id IN ({})
        AND pa.id != %s
        AND c.embedding IS NOT NULL
    """.format(project_ids_subquery), (passage["paper_id"], passage["paper_id"]))

    all_rows = passage_rows + chunk_rows
    candidates = [
        {"id": (r["source"], r["id"]), "embedding": json_to_embedding(r["embedding"]), "_row": r}
        for r in all_rows
    ]

    results = find_similar(query_emb, candidates, limit=limit)

    row_map = {(r["source"], r["id"]): r for r in all_rows}
    similar = []
    for key, sim in results:
        r = row_map[key]
        tags = _passage_with_tags(r)["tags"] if r["source"] == "passage" else []
        similar.append({
            "passage_id": r["id"],
            "paper_id": r["paper_id"],
            "paper_title": r["paper_title"],
            "page": r["page"],
            "text": r["text"],
            "similarity": sim,
            "rects": json.loads(r.get("rects") or "[]"),
            "tags": tags,
            "source": r["source"],
        })
    return similar


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

@app.get("/projects/{project_id}/tags", response_model=List[Tag])
def list_tags(project_id: int):
    return fetchall("""
        SELECT * FROM tags
        WHERE project_id = %s OR project_id IS NULL
        ORDER BY type, name
    """, (project_id,))


@app.post("/tags", response_model=Tag)
def create_tag(tag: TagCreate):
    try:
        return execute_returning(
            "INSERT INTO tags (name, type, project_id) VALUES (%s, %s, %s) RETURNING *",
            (tag.name, tag.type, tag.project_id)
        )
    except psycopg2.IntegrityError:
        raise HTTPException(status_code=400, detail="Tag already exists")


@app.patch("/tags/{tag_id}", response_model=Tag)
def update_tag(tag_id: int, update: TagUpdate):
    row = fetchone("SELECT * FROM tags WHERE id = %s", (tag_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Tag not found")
    if update.name:
        row = execute_returning(
            "UPDATE tags SET name = %s WHERE id = %s RETURNING *",
            (update.name, tag_id)
        )
    return row


@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: int):
    execute("DELETE FROM tags WHERE id = %s", (tag_id,))
    return {"message": "Tag deleted"}


@app.post("/passages/{passage_id}/tags/{tag_id}")
def add_passage_tag(passage_id: int, tag_id: int):
    try:
        execute(
            "INSERT INTO passage_tags (passage_id, tag_id) VALUES (%s, %s)",
            (passage_id, tag_id)
        )
    except psycopg2.IntegrityError:
        pass  # already tagged
    return {"message": "Tag added"}


@app.delete("/passages/{passage_id}/tags/{tag_id}")
def remove_passage_tag(passage_id: int, tag_id: int):
    execute(
        "DELETE FROM passage_tags WHERE passage_id = %s AND tag_id = %s",
        (passage_id, tag_id)
    )
    still_used = fetchone(
        "SELECT 1 FROM passage_tags WHERE tag_id = %s LIMIT 1",
        (tag_id,)
    )
    if not still_used:
        execute("DELETE FROM tags WHERE id = %s", (tag_id,))
    return {"message": "Tag removed"}


@app.get("/tags/{tag_id}/passages", response_model=List[Passage])
def get_tag_passages(tag_id: int):
    rows = fetchall("""
        SELECT p.* FROM passages p
        JOIN passage_tags pt ON pt.passage_id = p.id
        WHERE pt.tag_id = %s
        ORDER BY p.paper_id, p.page
    """, (tag_id,))
    return [_passage_with_tags(r) for r in rows]


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------

def _note_with_links(row: dict) -> dict:
    note = dict(row)
    note["passage_ids"] = [
        r["passage_id"] for r in
        fetchall("SELECT passage_id FROM note_passages WHERE note_id = %s", (note["id"],))
    ]
    note["tag_ids"] = [
        r["tag_id"] for r in
        fetchall("SELECT tag_id FROM note_tags WHERE note_id = %s", (note["id"],))
    ]
    return note


@app.post("/notes", response_model=Note)
def create_note(note: NoteCreate):
    row = execute_returning(
        "INSERT INTO notes (type, content) VALUES (%s, %s) RETURNING *",
        (note.type, note.content)
    )
    note_id = row["id"]

    for pid in (note.passage_ids or []):
        execute("INSERT INTO note_passages (note_id, passage_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (note_id, pid))
    for tid in (note.tag_ids or []):
        execute("INSERT INTO note_tags (note_id, tag_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (note_id, tid))

    try:
        emb = get_embedding_service().embed(note.content)
        execute("UPDATE notes SET embedding = %s WHERE id = %s",
                (embedding_to_json(emb), note_id))
    except Exception as e:
        print(f"Note embedding failed: {e}")

    return _note_with_links(row)


@app.get("/passages/{passage_id}/notes", response_model=List[Note])
def get_passage_notes(passage_id: int):
    rows = fetchall("""
        SELECT n.* FROM notes n
        JOIN note_passages np ON np.note_id = n.id
        WHERE np.passage_id = %s
        ORDER BY n.created_at DESC
    """, (passage_id,))
    return [_note_with_links(r) for r in rows]


@app.get("/tags/{tag_id}/notes", response_model=List[Note])
def get_tag_notes(tag_id: int):
    rows = fetchall("""
        SELECT n.* FROM notes n
        JOIN note_tags nt ON nt.note_id = n.id
        WHERE nt.tag_id = %s
        ORDER BY n.created_at DESC
    """, (tag_id,))
    return [_note_with_links(r) for r in rows]


@app.patch("/notes/{note_id}", response_model=Note)
def update_note(note_id: int, update: NoteUpdate):
    row = fetchone("SELECT * FROM notes WHERE id = %s", (note_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    if update.content is not None:
        row = execute_returning(
            "UPDATE notes SET content = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s RETURNING *",
            (update.content, note_id)
        )
        try:
            emb = get_embedding_service().embed(update.content)
            execute("UPDATE notes SET embedding = %s WHERE id = %s",
                    (embedding_to_json(emb), note_id))
        except Exception as e:
            print(f"Note embedding update failed: {e}")
    return _note_with_links(row)


@app.delete("/notes/{note_id}")
def delete_note(note_id: int):
    execute("DELETE FROM notes WHERE id = %s", (note_id,))
    return {"message": "Note deleted"}


# ---------------------------------------------------------------------------
# Q&A: question → relevant chunks + LLM-synthesized answer
# ---------------------------------------------------------------------------

@app.post("/papers/{paper_id}/search", response_model=SearchResponse)
def search_paper(paper_id: int, query: SearchQuery):
    paper = fetchone("SELECT title FROM papers WHERE id = %s", (paper_id,))
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    try:
        query_emb = get_embedding_service().embed(query.query)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Embedding service unavailable: {e}")

    chunks_raw = fetchall(
        "SELECT * FROM chunks WHERE paper_id = %s AND embedding IS NOT NULL",
        (paper_id,)
    )
    candidates = [
        {"id": r["id"], "embedding": json_to_embedding(r["embedding"])}
        for r in chunks_raw
    ]

    results = find_similar(query_emb, candidates, limit=query.limit)
    row_map = {r["id"]: r for r in chunks_raw}

    chunks = [
        ChunkResult(
            chunk_id=cid,
            page=row_map[cid]["page"],
            text=row_map[cid]["text"],
            similarity=sim,
            rects=json.loads(row_map[cid].get("rects") or "[]"),
        )
        for cid, sim in results
    ]

    # Try to synthesize an answer with the LLM
    answer = None
    if chunks:
        try:
            context = "\n\n---\n\n".join(
                f"[Page {c.page + 1}] {c.text}" for c in chunks[:5]
            )
            answer = get_llm_service().complete(
                prompt=(
                    f"Question: {query.query}\n\n"
                    f"Relevant passages from \"{paper['title']}\":\n\n{context}\n\n"
                    "Answer the question based only on the passages above. "
                    "Be concise. If the passages don't contain enough information, say so."
                ),
                system="You are a research assistant helping a scientist understand a paper. Answer questions based strictly on the provided passages.",
            )
        except Exception as e:
            print(f"LLM synthesis failed: {e}")

    return SearchResponse(answer=answer, chunks=chunks)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.post("/admin/normalize-chunk-rects")
def normalize_chunk_rects():
    """One-time migration: convert chunk rects from absolute PDF-point coords to 0-1 normalized."""
    import fitz

    paper_rows = fetchall("SELECT DISTINCT c.paper_id FROM chunks c")
    updated = 0
    errors = []

    for row in paper_rows:
        paper_id = row["paper_id"]
        paper = fetchone("SELECT filename FROM papers WHERE id = %s", (paper_id,))
        if not paper:
            continue
        try:
            pdf_bytes = storage.download(f"pdfs/{paper_id}/{paper['filename']}")
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            page_dims = {i: (p.rect.width or 612, p.rect.height or 792) for i, p in enumerate(doc)}
            doc.close()
        except Exception as e:
            errors.append(f"paper {paper_id}: {e}")
            continue

        chunks = fetchall("SELECT id, page, rects FROM chunks WHERE paper_id = %s", (paper_id,))
        for chunk in chunks:
            rects = json.loads(chunk.get("rects") or "[]")
            if not rects:
                continue
            r = rects[0]
            # skip already-normalized rects
            if r.get("x", 0) <= 2 and r.get("y", 0) <= 2:
                continue
            pw, ph = page_dims.get(chunk["page"], (612, 792))
            normalized = [{"x": rc["x"] / pw, "y": rc["y"] / ph,
                           "width": rc["width"] / pw, "height": rc["height"] / ph}
                          for rc in rects]
            execute("UPDATE chunks SET rects = %s WHERE id = %s",
                    (json.dumps(normalized), chunk["id"]))
            updated += 1

    return {"updated": updated, "errors": errors}


@app.get("/")
def root():
    return {"message": "Paper Explorer API v2"}


@app.get("/health")
def health():
    """Check connectivity to embedding and LLM services."""
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
