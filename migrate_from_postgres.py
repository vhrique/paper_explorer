"""
One-time migration: PostgreSQL → file-based store.
Run from the repo root: python migrate_from_postgres.py
"""

import io
import json
import os
import shutil
import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor
from pathlib import Path

DB_URL = "postgresql://user:password@localhost:5432/paper_explorer"
OLD_STORAGE = Path("./storage/pdfs")
NEW_STORAGE = Path("./storage")


def query(conn, sql, params=()):
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, default=str))


def main():
    conn = psycopg2.connect(DB_URL)
    print("Connected to PostgreSQL.")

    # -------------------------------------------------------------------------
    # Projects
    # -------------------------------------------------------------------------
    projects = query(conn, "SELECT * FROM projects ORDER BY id")
    print(f"  {len(projects)} projects")

    # -------------------------------------------------------------------------
    # Tags
    # -------------------------------------------------------------------------
    tags = query(conn, "SELECT * FROM tags ORDER BY id")
    for t in tags:
        t["created_at"] = str(t["created_at"])
    print(f"  {len(tags)} tags")

    # -------------------------------------------------------------------------
    # Papers
    # -------------------------------------------------------------------------
    papers = query(conn, "SELECT * FROM papers ORDER BY id")
    print(f"  {len(papers)} papers")

    # Build project_ids mapping
    pp_rows = query(conn, "SELECT * FROM paper_projects")
    paper_project_ids: dict[int, list[int]] = {}
    for row in pp_rows:
        paper_project_ids.setdefault(row["paper_id"], []).append(row["project_id"])

    # -------------------------------------------------------------------------
    # Passages
    # -------------------------------------------------------------------------
    passages = query(conn, "SELECT * FROM passages ORDER BY id")
    passage_tags_rows = query(conn, "SELECT * FROM passage_tags")
    passage_tag_ids: dict[int, list[int]] = {}
    for row in passage_tags_rows:
        passage_tag_ids.setdefault(row["passage_id"], []).append(row["tag_id"])
    print(f"  {len(passages)} passages")

    # Group passages by paper
    passages_by_paper: dict[int, list[dict]] = {}
    for p in passages:
        passages_by_paper.setdefault(p["paper_id"], []).append(p)

    # -------------------------------------------------------------------------
    # Notes
    # -------------------------------------------------------------------------
    notes = query(conn, "SELECT * FROM notes ORDER BY id")
    note_passages_rows = query(conn, "SELECT * FROM note_passages")
    note_tags_rows = query(conn, "SELECT * FROM note_tags")
    note_passage_ids: dict[int, list[int]] = {}
    note_tag_ids_map: dict[int, list[int]] = {}
    for row in note_passages_rows:
        note_passage_ids.setdefault(row["note_id"], []).append(row["passage_id"])
    for row in note_tags_rows:
        note_tag_ids_map.setdefault(row["note_id"], []).append(row["tag_id"])

    # Group notes by paper (via their passage_ids)
    passage_to_paper: dict[int, int] = {p["id"]: p["paper_id"] for p in passages}
    notes_by_paper: dict[int, list[dict]] = {}
    for n in notes:
        pids = note_passage_ids.get(n["id"], [])
        paper_id = passage_to_paper.get(pids[0]) if pids else None
        if paper_id:
            notes_by_paper.setdefault(paper_id, []).append(n)
    print(f"  {len(notes)} notes")

    # -------------------------------------------------------------------------
    # Passage links
    # -------------------------------------------------------------------------
    links = query(conn, "SELECT * FROM passage_links ORDER BY id")
    print(f"  {len(links)} passage links")

    # -------------------------------------------------------------------------
    # Chunks
    # -------------------------------------------------------------------------
    chunks = query(conn, "SELECT * FROM chunks ORDER BY paper_id, id")
    chunks_by_paper: dict[int, list[dict]] = {}
    for c in chunks:
        chunks_by_paper.setdefault(c["paper_id"], []).append(c)
    print(f"  {len(chunks)} chunks")

    # -------------------------------------------------------------------------
    # Determine max ID for the _next_id counter
    # -------------------------------------------------------------------------
    all_ids = (
        [p["id"] for p in projects]
        + [t["id"] for t in tags]
        + [p["id"] for p in papers]
        + [p["id"] for p in passages]
        + [n["id"] for n in notes]
        + [l["id"] for l in links]
    )
    next_id = (max(all_ids) + 1) if all_ids else 1

    # -------------------------------------------------------------------------
    # Write workspace.json
    # -------------------------------------------------------------------------
    workspace = {
        "_next_id": next_id,
        "projects": [
            {
                "id": p["id"],
                "name": p["name"],
                "description": p.get("description"),
                "created_at": str(p["created_at"]),
            }
            for p in projects
        ],
        "tags": [
            {
                "id": t["id"],
                "name": t["name"],
                "type": t["type"],
                "project_id": t.get("project_id"),
                "created_at": str(t["created_at"]),
            }
            for t in tags
        ],
        "paper_ids": [p["id"] for p in papers],
        "passage_links": [
            {
                "id": l["id"],
                "passage_id_1": l["passage_id_1"],
                "passage_id_2": l["passage_id_2"],
                "created_at": str(l["created_at"]),
            }
            for l in links
        ],
    }
    write_json(NEW_STORAGE / "workspace.json", workspace)
    print("  ✓ workspace.json")

    # -------------------------------------------------------------------------
    # Write per-paper files
    # -------------------------------------------------------------------------
    for paper in papers:
        pid = paper["id"]
        paper_dir = NEW_STORAGE / "papers" / str(pid)
        paper_dir.mkdir(parents=True, exist_ok=True)

        # metadata.json
        meta = {
            "id": pid,
            "title": paper["title"],
            "filename": paper["filename"],
            "doi": paper.get("doi"),
            "arxiv_id": paper.get("arxiv_id"),
            "abstract": paper.get("abstract"),
            "created_at": str(paper["created_at"]),
            "project_ids": paper_project_ids.get(pid, []),
        }
        write_json(paper_dir / "metadata.json", meta)

        # Copy PDF
        old_pdf = OLD_STORAGE / str(pid) / paper["filename"]
        new_pdf = paper_dir / paper["filename"]
        if old_pdf.exists():
            shutil.copy2(old_pdf, new_pdf)
        else:
            print(f"  ⚠ PDF not found: {old_pdf}")

        # annotations.json
        paper_passages = []
        for p in passages_by_paper.get(pid, []):
            emb = json.loads(p["embedding"]) if p.get("embedding") else None
            paper_passages.append({
                "id": p["id"],
                "paper_id": pid,
                "page": p["page"],
                "text": p["text"],
                "rects": json.loads(p.get("rects") or "[]"),
                "color": p.get("color", "#FDE047"),
                "embedding": emb,
                "tag_ids": passage_tag_ids.get(p["id"], []),
                "created_at": str(p["created_at"]),
            })

        paper_notes = []
        for n in notes_by_paper.get(pid, []):
            paper_notes.append({
                "id": n["id"],
                "type": n["type"],
                "content": n["content"],
                "passage_ids": note_passage_ids.get(n["id"], []),
                "tag_ids": note_tag_ids_map.get(n["id"], []),
                "created_at": str(n["created_at"]),
                "updated_at": str(n["updated_at"]),
            })

        write_json(paper_dir / "annotations.json", {"passages": paper_passages, "notes": paper_notes})

        # chunks.npz — reconstruct from DB embeddings
        paper_chunks = chunks_by_paper.get(pid, [])
        if paper_chunks:
            # Build ordered list: map old DB ids to sequential indices for parent_id resolution
            id_to_idx = {c["id"]: i for i, c in enumerate(paper_chunks)}
            texts, embeddings, pages, granularities, parent_indices, rects_list = [], [], [], [], [], []
            for c in paper_chunks:
                texts.append(c["text"])
                emb = json.loads(c["embedding"]) if c.get("embedding") else [0.0]
                embeddings.append(emb)
                pages.append(c["page"])
                granularities.append(c.get("granularity") or "block")
                parent_db_id = c.get("parent_id")
                parent_indices.append(id_to_idx[parent_db_id] if parent_db_id and parent_db_id in id_to_idx else -1)
                rects_raw = json.loads(c.get("rects") or "[]")
                r = rects_raw[0] if rects_raw else {"x": 0, "y": 0, "width": 0, "height": 0}
                rects_list.append([r["x"], r["y"], r["width"], r["height"]])

            # Pad embeddings to uniform dim
            dim = max(len(e) for e in embeddings)
            padded = [e + [0.0] * (dim - len(e)) for e in embeddings]

            buf = io.BytesIO()
            np.savez_compressed(
                buf,
                texts=np.array(texts, dtype=object),
                embeddings=np.array(padded, dtype=np.float16),
                pages=np.array(pages, dtype=np.int32),
                granularities=np.array(granularities, dtype=object),
                parent_indices=np.array(parent_indices, dtype=np.int32),
                rects=np.array(rects_list, dtype=np.float32),
            )
            (paper_dir / "chunks.npz").write_bytes(buf.getvalue())

        print(f"  ✓ paper {pid}: {paper['title'][:50]}  ({len(paper_chunks)} chunks)")

    conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    main()
