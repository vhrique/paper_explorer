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
            
            # Add description column if it doesn't exist (migration)
            try:
                cursor.execute("ALTER TABLE papers ADD COLUMN IF NOT EXISTS description TEXT")
                conn.commit()
            except Exception as e:
                print(f"Migration failed (description column): {e}")
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

