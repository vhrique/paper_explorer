import psycopg2
from psycopg2.extras import RealDictCursor
from pgvector.psycopg2 import register_vector
import os
import time
from typing import List, Dict, Optional, Any

# Database Setup
def get_db_connection(register_vectors=True):
    db_url = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/paper_explorer")
    conn = psycopg2.connect(db_url)
    if register_vectors:
        try:
            register_vector(conn)  # Register pgvector type
        except Exception:
            pass  # Extension may not be created yet
    return conn

def init_db():
    retries = 5
    while retries > 0:
        try:
            # First connection without vector registration (extension may not exist yet)
            conn = get_db_connection(register_vectors=False)
            cursor = conn.cursor()
            
            # Enable pgvector extension
            cursor.execute('CREATE EXTENSION IF NOT EXISTS vector')
            conn.commit()
            
            # Now register the vector type after extension is created
            register_vector(conn)
            
            # Create tables
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
            
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS papers (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                filename TEXT NOT NULL,
                color TEXT DEFAULT '#3B82F6',
                description TEXT,
                doi TEXT,
                abstract TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS tags (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('global', 'local')),
                project_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (name, type, project_id),
                FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS node_tags (
                tag_id INTEGER NOT NULL,
                node_id TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (tag_id, node_id),
                FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS links (
                id SERIAL PRIMARY KEY,
                source_node_id TEXT NOT NULL,
                target_node_id TEXT NOT NULL,
                type TEXT DEFAULT 'manual',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (source_node_id, target_node_id)
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS paper_references (
                id SERIAL PRIMARY KEY,
                paper_id INTEGER NOT NULL,
                referenced_doi TEXT,
                referenced_title TEXT,
                referenced_authors TEXT,
                referenced_year INTEGER,
                source TEXT DEFAULT 'crossref',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (paper_id) REFERENCES papers (id) ON DELETE CASCADE
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS paper_citations (
                id SERIAL PRIMARY KEY,
                paper_id INTEGER NOT NULL,
                citing_paper_id TEXT,
                citing_doi TEXT,
                citing_title TEXT,
                citing_authors TEXT,
                citing_year INTEGER,
                source TEXT DEFAULT 'semanticscholar',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (paper_id) REFERENCES papers (id) ON DELETE CASCADE
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS notes (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                color TEXT DEFAULT '#FEF3C7',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
            )
            ''')

            cursor.execute('''
            CREATE TABLE IF NOT EXISTS svm_models (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                use_global_context BOOLEAN DEFAULT FALSE,
                num_training_samples INTEGER,
                num_tags INTEGER,
                tags_list TEXT,
                trained_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                model_path TEXT,
                FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
            )
            ''')
            
            # Create nodes table with vector column
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                project_id INTEGER NOT NULL,
                paper_id INTEGER,
                note_id INTEGER,
                type TEXT NOT NULL CHECK (type IN ('text', 'image', 'note')),
                content TEXT NOT NULL,
                page_number INTEGER,
                bbox TEXT,
                paper_color TEXT,
                title TEXT,
                tag_scores TEXT,
                embedding vector(1024),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
                FOREIGN KEY (paper_id) REFERENCES papers (id) ON DELETE CASCADE,
                FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE
            )
            ''')
            
            # Commit table creation before running migrations
            conn.commit()
            
            # Create indexes for vector similarity search and project queries
            try:
                cursor.execute("CREATE INDEX IF NOT EXISTS nodes_embedding_idx ON nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)")
                conn.commit()
            except Exception as e:
                print(f"Note: Could not create IVFFlat index (will be created after enough data): {e}")
                conn.rollback()
            
            try:
                cursor.execute("CREATE INDEX IF NOT EXISTS nodes_project_id_idx ON nodes (project_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS nodes_paper_id_idx ON nodes (paper_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS nodes_note_id_idx ON nodes (note_id)")
                conn.commit()
            except Exception as e:
                print(f"Note: Some indexes may already exist: {e}")
                conn.rollback()
            
            # Add description column if it doesn't exist (migration)
            try:
                cursor.execute("ALTER TABLE papers ADD COLUMN description TEXT")
                conn.commit()
            except psycopg2.errors.DuplicateColumn:
                conn.rollback()

            # Add updated_at column to notes if it doesn't exist (migration)
            try:
                cursor.execute("ALTER TABLE notes ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                conn.commit()
            except psycopg2.errors.DuplicateColumn:
                conn.rollback()

            # Add doi column to papers if it doesn't exist (migration)
            try:
                cursor.execute("ALTER TABLE papers ADD COLUMN doi TEXT")
                conn.commit()
            except psycopg2.errors.DuplicateColumn:
                conn.rollback()

            # Add abstract column to papers if it doesn't exist (migration)
            try:
                cursor.execute("ALTER TABLE papers ADD COLUMN abstract TEXT")
                conn.commit()
            except psycopg2.errors.DuplicateColumn:
                conn.rollback()
            
            conn.commit()
            conn.close()
            print("Database initialized successfully with pgvector extension.")
            break
        except Exception as e:
            print(f"Database initialization failed: {e}. Retrying in 2 seconds...")
            retries -= 1
            time.sleep(2)


# PGVector Helper Functions

def insert_nodes(nodes: List[Dict[str, Any]]) -> int:
    """
    Insert nodes with embeddings into the nodes table.
    
    Args:
        nodes: List of node dictionaries with id, project_id, paper_id, type, content, embedding, etc.
    
    Returns:
        Number of nodes inserted
    """
    if not nodes:
        return 0
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    insert_query = """
        INSERT INTO nodes (id, project_id, paper_id, note_id, type, content, page_number, bbox, paper_color, title, embedding)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    
    for node in nodes:
        cursor.execute(insert_query, (
            node['id'],
            node['project_id'],
            node.get('paper_id'),
            node.get('note_id'),
            node['type'],
            node['content'],
            node.get('page_number'),
            node.get('bbox'),
            node.get('paper_color'),
            node.get('title'),
            node.get('embedding')
        ))
    
    conn.commit()
    count = len(nodes)
    conn.close()
    return count


def get_nodes_by_project(project_id: int, include_embeddings: bool = False) -> List[Dict[str, Any]]:
    """
    Retrieve all nodes for a project.
    
    Args:
        project_id: The project ID
        include_embeddings: Whether to include embedding vectors in results
    
    Returns:
        List of node dictionaries
    """
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    if include_embeddings:
        cursor.execute("SELECT * FROM nodes WHERE project_id = %s ORDER BY created_at", (project_id,))
    else:
        cursor.execute("""
            SELECT id, project_id, paper_id, note_id, type, content, page_number, 
                   bbox, paper_color, title, tag_scores, created_at 
            FROM nodes WHERE project_id = %s ORDER BY created_at
        """, (project_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def get_nodes_by_ids(node_ids: List[str], include_embeddings: bool = False) -> List[Dict[str, Any]]:
    """
    Retrieve specific nodes by their IDs.
    
    Args:
        node_ids: List of node IDs
        include_embeddings: Whether to include embedding vectors in results
    
    Returns:
        List of node dictionaries
    """
    if not node_ids:
        return []
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    if include_embeddings:
        cursor.execute("SELECT * FROM nodes WHERE id = ANY(%s)", (node_ids,))
    else:
        cursor.execute("""
            SELECT id, project_id, paper_id, note_id, type, content, page_number, 
                   bbox, paper_color, title, tag_scores, created_at 
            FROM nodes WHERE id = ANY(%s)
        """, (node_ids,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def get_nodes_by_paper(paper_id: int) -> List[Dict[str, Any]]:
    """
    Retrieve all nodes for a paper.
    
    Args:
        paper_id: The paper ID
    
    Returns:
        List of node dictionaries
    """
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    cursor.execute("SELECT id FROM nodes WHERE paper_id = %s", (paper_id,))
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def update_node_metadata(node_id: str, updates: Dict[str, Any]) -> bool:
    """
    Update node metadata (e.g., color, tag_scores).
    
    Args:
        node_id: The node ID
        updates: Dictionary of fields to update
    
    Returns:
        True if successful
    """
    if not updates:
        return True
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Build dynamic UPDATE query
    set_clauses = []
    values = []
    
    for key, value in updates.items():
        set_clauses.append(f"{key} = %s")
        values.append(value)
    
    values.append(node_id)
    query = f"UPDATE nodes SET {', '.join(set_clauses)} WHERE id = %s"
    
    cursor.execute(query, values)
    conn.commit()
    conn.close()
    
    return True


def update_nodes_by_ids(node_ids: List[str], updates: Dict[str, Any]) -> int:
    """
    Update multiple nodes with the same metadata.
    
    Args:
        node_ids: List of node IDs
        updates: Dictionary of fields to update
    
    Returns:
        Number of nodes updated
    """
    if not updates or not node_ids:
        return 0
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Build dynamic UPDATE query
    set_clauses = []
    values = []
    
    for key, value in updates.items():
        set_clauses.append(f"{key} = %s")
        values.append(value)
    
    values.append(node_ids)
    query = f"UPDATE nodes SET {', '.join(set_clauses)} WHERE id = ANY(%s)"
    
    cursor.execute(query, values)
    count = cursor.rowcount
    conn.commit()
    conn.close()
    
    return count


def delete_nodes_by_paper(paper_id: int) -> int:
    """
    Delete all nodes belonging to a paper.
    
    Args:
        paper_id: The paper ID
    
    Returns:
        Number of nodes deleted
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM nodes WHERE paper_id = %s", (paper_id,))
    count = cursor.rowcount
    conn.commit()
    conn.close()
    
    return count


def delete_nodes_by_project(project_id: int) -> int:
    """
    Delete all nodes in a project.
    
    Args:
        project_id: The project ID
    
    Returns:
        Number of nodes deleted
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM nodes WHERE project_id = %s", (project_id,))
    count = cursor.rowcount
    conn.commit()
    conn.close()
    
    return count


def similarity_search(project_id: int, query_embedding: List[float], limit: int = 20) -> List[Dict[str, Any]]:
    """
    Perform vector similarity search using pgvector.
    
    Args:
        project_id: The project ID to search within
        query_embedding: The query embedding vector
        limit: Maximum number of results to return
    
    Returns:
        List of node dictionaries with similarity scores
    """
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Use cosine distance for similarity search
    cursor.execute("""
        SELECT id, project_id, paper_id, note_id, type, content, page_number, 
               bbox, paper_color, title, tag_scores, created_at,
               1 - (embedding <=> %s) AS similarity
        FROM nodes 
        WHERE project_id = %s AND embedding IS NOT NULL
        ORDER BY embedding <=> %s
        LIMIT %s
    """, (query_embedding, project_id, query_embedding, limit))
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]
