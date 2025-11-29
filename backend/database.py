import psycopg2
from psycopg2.extras import RealDictCursor
import chromadb
from chromadb.config import Settings
import os
import time

# Database Setup
def get_db_connection():
    db_url = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/paper_explorer")
    conn = psycopg2.connect(db_url)
    return conn

def init_db():
    retries = 5
    while retries > 0:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
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
            
            # Commit table creation before running migrations
            conn.commit()
            
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
            
            conn.commit()
            conn.close()
            print("Database initialized successfully.")
            break
        except Exception as e:
            print(f"Database initialization failed: {e}. Retrying in 2 seconds...")
            retries -= 1
            time.sleep(2)

# ChromaDB Setup
CHROMA_PATH = "chroma_db"
chroma_client = chromadb.PersistentClient(path=CHROMA_PATH)

def get_chroma_collection(project_id: int):
    collection_name = f"project_{project_id}"
    return chroma_client.get_or_create_collection(name=collection_name)

