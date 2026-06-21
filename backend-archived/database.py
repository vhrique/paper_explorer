import psycopg2
from psycopg2.extras import RealDictCursor
import os
import time
import json
import numpy as np
from typing import List, Dict, Any, Optional


def get_db_connection():
    db_url = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/paper_explorer")
    return psycopg2.connect(db_url)


def init_db():
    retries = 5
    while retries > 0:
        try:
            conn = get_db_connection()
            cur = conn.cursor()

            cur.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS papers (
                    id SERIAL PRIMARY KEY,
                    title TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    doi TEXT,
                    abstract TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS paper_projects (
                    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    PRIMARY KEY (paper_id, project_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS tags (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL CHECK (type IN ('content', 'paper')),
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (name, type, project_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS paper_tags (
                    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
                    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (paper_id, tag_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS passages (
                    id SERIAL PRIMARY KEY,
                    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
                    page INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    rects TEXT NOT NULL DEFAULT '[]',
                    color TEXT DEFAULT '#FDE047',
                    embedding TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS passage_tags (
                    passage_id INTEGER REFERENCES passages(id) ON DELETE CASCADE,
                    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (passage_id, tag_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS notes (
                    id SERIAL PRIMARY KEY,
                    type TEXT NOT NULL CHECK (type IN ('passage', 'tag')),
                    content TEXT NOT NULL,
                    embedding TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS note_passages (
                    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
                    passage_id INTEGER REFERENCES passages(id) ON DELETE CASCADE,
                    PRIMARY KEY (note_id, passage_id)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS note_tags (
                    note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
                    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (note_id, tag_id)
                )
            """)

            # Full-text chunks extracted from PDFs, used for Q&A search
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chunks (
                    id SERIAL PRIMARY KEY,
                    paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
                    page INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    rects TEXT DEFAULT '[]',
                    embedding TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS granularity TEXT DEFAULT 'block'")
            cur.execute("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES chunks(id) ON DELETE CASCADE")

            cur.execute("""
                CREATE TABLE IF NOT EXISTS passage_links (
                    id SERIAL PRIMARY KEY,
                    passage_id_1 INTEGER REFERENCES passages(id) ON DELETE CASCADE,
                    passage_id_2 INTEGER REFERENCES passages(id) ON DELETE CASCADE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(passage_id_1, passage_id_2)
                )
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS svm_models (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
                    model_data BYTEA NOT NULL,
                    tags_list TEXT NOT NULL,
                    trained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Migrations: add columns that may not exist in older DB instances
            cur.execute("""
                ALTER TABLE papers ADD COLUMN IF NOT EXISTS arxiv_id TEXT
            """)

            conn.commit()
            conn.close()
            print("Database initialized.")
            break
        except Exception as e:
            print(f"DB init failed: {e}. Retrying...")
            retries -= 1
            time.sleep(2)


# --- Embedding helpers ---

def embedding_to_json(embedding: List[float]) -> str:
    return json.dumps(embedding)

def json_to_embedding(s: str) -> Optional[List[float]]:
    if not s:
        return None
    return json.loads(s)


# --- Generic fetch helpers ---

def fetchall(query: str, params=()) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def fetchone(query: str, params=()) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(query, params)
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None

def execute(query: str, params=()) -> None:
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(query, params)
    conn.commit()
    conn.close()

def execute_returning(query: str, params=()) -> Dict[str, Any]:
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(query, params)
    row = dict(cur.fetchone())
    conn.commit()
    conn.close()
    return row
