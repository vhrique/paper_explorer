"""
File-based data store. Replaces PostgreSQL for the stateless architecture.
All state lives in JSON + npz files via the storage backend.

Layout:
  workspace.json                     — projects, tags, paper index, passage links
  papers/{id}/metadata.json          — title, filename, doi, abstract, project_ids
  papers/{id}/annotations.json       — passages (with embeddings), notes
  papers/{id}/chunks.npz             — chunk texts + float16 embeddings
  papers/{id}/{filename}.pdf         — the PDF
"""

import io
import json
import numpy as np
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty_workspace() -> dict:
    return {"_next_id": 1, "projects": [], "tags": [], "paper_ids": [], "passage_links": []}


class FileStore:
    def __init__(self, storage):
        self._s = storage

    # -------------------------------------------------------------------------
    # Internal helpers
    # -------------------------------------------------------------------------

    def _get_json(self, key: str, default=None):
        try:
            return json.loads(self._s.download(key))
        except Exception:
            return default() if callable(default) else default

    def _put_json(self, key: str, data) -> None:
        buf = io.BytesIO(json.dumps(data, indent=2, default=str).encode())
        self._s.upload(buf, key, "application/json")

    # -------------------------------------------------------------------------
    # Workspace
    # -------------------------------------------------------------------------

    def read_workspace(self) -> dict:
        return self._get_json("workspace.json", _empty_workspace)

    def _write_workspace(self, ws: dict) -> None:
        self._put_json("workspace.json", ws)

    def _alloc_id(self, ws: dict) -> int:
        nid = ws.get("_next_id", 1)
        ws["_next_id"] = nid + 1
        return nid

    # -------------------------------------------------------------------------
    # Projects
    # -------------------------------------------------------------------------

    def list_projects(self) -> List[dict]:
        return self.read_workspace().get("projects", [])

    def get_project(self, project_id: int) -> Optional[dict]:
        return next((p for p in self.list_projects() if p["id"] == project_id), None)

    def create_project(self, name: str, description: Optional[str]) -> dict:
        ws = self.read_workspace()
        project = {"id": self._alloc_id(ws), "name": name, "description": description, "created_at": _now()}
        ws.setdefault("projects", []).append(project)
        self._write_workspace(ws)
        return project

    def update_project(self, project_id: int, fields: dict) -> Optional[dict]:
        ws = self.read_workspace()
        for p in ws.get("projects", []):
            if p["id"] == project_id:
                p.update({k: v for k, v in fields.items() if v is not None})
                self._write_workspace(ws)
                return p
        return None

    def delete_project(self, project_id: int) -> None:
        ws = self.read_workspace()
        ws["projects"] = [p for p in ws.get("projects", []) if p["id"] != project_id]
        self._write_workspace(ws)
        for pid in ws.get("paper_ids", []):
            meta = self.read_metadata(pid)
            if meta and project_id in meta.get("project_ids", []):
                meta["project_ids"] = [i for i in meta["project_ids"] if i != project_id]
                self.write_metadata(pid, meta)

    # -------------------------------------------------------------------------
    # Tags
    # -------------------------------------------------------------------------

    def list_tags(self, project_id: Optional[int] = None) -> List[dict]:
        tags = self.read_workspace().get("tags", [])
        if project_id is not None:
            return [t for t in tags if t.get("project_id") == project_id or t.get("project_id") is None]
        return tags

    def get_tag(self, tag_id: int) -> Optional[dict]:
        return next((t for t in self.read_workspace().get("tags", []) if t["id"] == tag_id), None)

    def create_tag(self, name: str, type_: str, project_id: Optional[int]) -> Optional[dict]:
        ws = self.read_workspace()
        # Enforce unique (name, type, project_id)
        existing = [t for t in ws.get("tags", [])
                    if t["name"] == name and t["type"] == type_ and t.get("project_id") == project_id]
        if existing:
            return None
        tag = {"id": self._alloc_id(ws), "name": name, "type": type_, "project_id": project_id, "created_at": _now()}
        ws.setdefault("tags", []).append(tag)
        self._write_workspace(ws)
        return tag

    def update_tag(self, tag_id: int, name: str) -> Optional[dict]:
        ws = self.read_workspace()
        for t in ws.get("tags", []):
            if t["id"] == tag_id:
                t["name"] = name
                self._write_workspace(ws)
                return t
        return None

    def delete_tag(self, tag_id: int) -> None:
        ws = self.read_workspace()
        ws["tags"] = [t for t in ws.get("tags", []) if t["id"] != tag_id]
        self._write_workspace(ws)

    # -------------------------------------------------------------------------
    # Paper index
    # -------------------------------------------------------------------------

    def list_paper_ids(self) -> List[int]:
        return self.read_workspace().get("paper_ids", [])

    def _register_paper(self, paper_id: int) -> None:
        ws = self.read_workspace()
        ids = ws.setdefault("paper_ids", [])
        if paper_id not in ids:
            ids.append(paper_id)
            self._write_workspace(ws)

    def _unregister_paper(self, paper_id: int) -> None:
        ws = self.read_workspace()
        ws["paper_ids"] = [i for i in ws.get("paper_ids", []) if i != paper_id]
        # Remove any passage links involving this paper's passages
        ann = self.read_annotations(paper_id)
        passage_ids = {p["id"] for p in ann.get("passages", [])}
        ws["passage_links"] = [
            l for l in ws.get("passage_links", [])
            if l["passage_id_1"] not in passage_ids and l["passage_id_2"] not in passage_ids
        ]
        self._write_workspace(ws)

    # -------------------------------------------------------------------------
    # Passage links (global, stored in workspace)
    # -------------------------------------------------------------------------

    def get_passage_links(self, passage_id: int) -> List[dict]:
        return [l for l in self.read_workspace().get("passage_links", [])
                if l["passage_id_1"] == passage_id or l["passage_id_2"] == passage_id]

    def get_paper_passage_links(self, paper_id: int) -> List[dict]:
        """Return all links where either passage belongs to paper_id."""
        ann = self.read_annotations(paper_id)
        passage_ids = {p["id"] for p in ann.get("passages", [])}
        return [l for l in self.read_workspace().get("passage_links", [])
                if l["passage_id_1"] in passage_ids or l["passage_id_2"] in passage_ids]

    def create_passage_link(self, passage_id_1: int, passage_id_2: int) -> dict:
        p1, p2 = min(passage_id_1, passage_id_2), max(passage_id_1, passage_id_2)
        ws = self.read_workspace()
        existing = next(
            (l for l in ws.get("passage_links", []) if l["passage_id_1"] == p1 and l["passage_id_2"] == p2),
            None,
        )
        if existing:
            return existing
        link = {"id": self._alloc_id(ws), "passage_id_1": p1, "passage_id_2": p2, "created_at": _now()}
        ws.setdefault("passage_links", []).append(link)
        self._write_workspace(ws)
        return link

    def delete_passage_link(self, passage_id_1: int, passage_id_2: int) -> None:
        p1, p2 = min(passage_id_1, passage_id_2), max(passage_id_1, passage_id_2)
        ws = self.read_workspace()
        ws["passage_links"] = [
            l for l in ws.get("passage_links", [])
            if not (l["passage_id_1"] == p1 and l["passage_id_2"] == p2)
        ]
        self._write_workspace(ws)

    # -------------------------------------------------------------------------
    # Paper metadata
    # -------------------------------------------------------------------------

    def read_metadata(self, paper_id: int) -> Optional[dict]:
        return self._get_json(f"papers/{paper_id}/metadata.json")

    def write_metadata(self, paper_id: int, meta: dict) -> None:
        self._put_json(f"papers/{paper_id}/metadata.json", meta)

    def create_metadata(self, title: str, filename: str, doi: Optional[str], arxiv_id: Optional[str]) -> dict:
        ws = self.read_workspace()
        paper_id = self._alloc_id(ws)
        self._write_workspace(ws)
        meta = {
            "id": paper_id, "title": title, "filename": filename,
            "doi": doi, "arxiv_id": arxiv_id, "abstract": None,
            "created_at": _now(), "project_ids": [],
        }
        self.write_metadata(paper_id, meta)
        self._register_paper(paper_id)
        return meta

    def delete_paper_files(self, paper_id: int, filename: str) -> None:
        self._unregister_paper(paper_id)
        for key in [f"papers/{paper_id}/{filename}", f"papers/{paper_id}/metadata.json",
                    f"papers/{paper_id}/annotations.json", f"papers/{paper_id}/chunks.npz"]:
            try:
                self._s.delete(key)
            except Exception:
                pass

    # -------------------------------------------------------------------------
    # Annotations (passages + notes per paper)
    # -------------------------------------------------------------------------

    def read_annotations(self, paper_id: int) -> dict:
        return self._get_json(f"papers/{paper_id}/annotations.json", lambda: {"passages": [], "notes": []})

    def write_annotations(self, paper_id: int, ann: dict) -> None:
        self._put_json(f"papers/{paper_id}/annotations.json", ann)

    def find_passage(self, passage_id: int) -> Tuple[Optional[int], Optional[dict]]:
        """Scan all papers for a passage by ID. Returns (paper_id, passage)."""
        for pid in self.list_paper_ids():
            ann = self.read_annotations(pid)
            for p in ann.get("passages", []):
                if p["id"] == passage_id:
                    return pid, p
        return None, None

    def find_note(self, note_id: int) -> Tuple[Optional[int], Optional[dict]]:
        """Scan all papers for a note by ID. Returns (paper_id, note)."""
        for pid in self.list_paper_ids():
            ann = self.read_annotations(pid)
            for n in ann.get("notes", []):
                if n["id"] == note_id:
                    return pid, n
        return None, None

    def alloc_annotation_id(self) -> int:
        """Allocate a new ID from the workspace counter (shared with all entity types)."""
        ws = self.read_workspace()
        nid = self._alloc_id(ws)
        self._write_workspace(ws)
        return nid

    # -------------------------------------------------------------------------
    # Chunks (npz storage + serving)
    # -------------------------------------------------------------------------

    def write_chunks(
        self,
        paper_id: int,
        texts: List[str],
        embeddings: List[List[float]],
        pages: List[int],
        granularities: List[str],
        parent_indices: List[int],
        rects: List[List[float]],
    ) -> None:
        buf = io.BytesIO()
        np.savez_compressed(
            buf,
            texts=np.array(texts, dtype=object),
            embeddings=np.array(embeddings, dtype=np.float16),
            pages=np.array(pages, dtype=np.int32),
            granularities=np.array(granularities, dtype=object),
            parent_indices=np.array(parent_indices, dtype=np.int32),
            rects=np.array(rects, dtype=np.float32),
        )
        buf.seek(0)
        self._s.upload(buf, f"papers/{paper_id}/chunks.npz", "application/octet-stream")

    def delete_chunks(self, paper_id: int) -> None:
        try:
            self._s.delete(f"papers/{paper_id}/chunks.npz")
        except Exception:
            pass

    def load_chunks_npz(self, paper_id: int):
        """Returns an NpzFile (lazy-loaded arrays) or None."""
        try:
            data = self._s.download(f"papers/{paper_id}/chunks.npz")
            return np.load(io.BytesIO(data), allow_pickle=True)
        except Exception:
            return None
