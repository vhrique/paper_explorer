from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import os
import uuid
import random
from typing import List

from database import init_db, get_db_connection, get_chroma_collection
from models import ProjectCreate, Project, Paper, GraphData
from services.pdf_processor import PDFProcessor
from services.embedding import EmbeddingService
from services.graph import GraphService

app = FastAPI(title="Paper Explorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for images
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize Services
pdf_processor = PDFProcessor()
embedding_service = EmbeddingService()
graph_service = GraphService()

@app.on_event("startup")
def startup_event():
    init_db()

@app.post("/projects/", response_model=Project)
def create_project(project: ProjectCreate):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO projects (name, description) VALUES (?, ?)",
        (project.name, project.description)
    )
    project_id = cursor.lastrowid
    conn.commit()
    
    # Fetch created project
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    row = cursor.fetchone()
    conn.close()
    
    return dict(row)

@app.get("/projects/", response_model=List[Project])
def list_projects():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Delete the project
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    
    # Also delete associated papers
    cursor.execute("DELETE FROM papers WHERE project_id = ?", (project_id,))
    
    conn.commit()
    conn.close()
    
    return {"message": "Project deleted successfully"}

@app.get("/projects/{project_id}/papers/", response_model=List[Paper])
def list_papers(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM papers WHERE project_id = ? ORDER BY created_at DESC", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.get("/papers/{paper_id}", response_model=Paper)
def get_paper(paper_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    return dict(row)


@app.delete("/papers/{paper_id}")
def delete_paper(paper_id: int):
    # Get paper info first to know which project it belongs to
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT project_id FROM papers WHERE id = ?", (paper_id,))
    row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    project_id = row["project_id"]
    
    # Delete the paper from database
    cursor.execute("DELETE FROM papers WHERE id = ?", (paper_id,))
    conn.commit()
    conn.close()
    
    # Remove all nodes belonging to this paper from ChromaDB
    try:
        collection = get_chroma_collection(project_id)
        
        # Debug: Check what's in the collection
        all_results = collection.get()
        print(f"Total items in collection: {len(all_results['ids']) if all_results['ids'] else 0}")
        
        # Get all IDs for this paper - try with integer first
        results = collection.get(where={"paper_id": paper_id})
        print(f"Found {len(results['ids']) if results['ids'] else 0} nodes with paper_id={paper_id} (int)")
        
        # If nothing found, try string
        if not results["ids"]:
            results = collection.get(where={"paper_id": str(paper_id)})
            print(f"Found {len(results['ids']) if results['ids'] else 0} nodes with paper_id={str(paper_id)} (str)")
        
        if results["ids"]:
            collection.delete(ids=results["ids"])
            print(f"Successfully deleted {len(results['ids'])} nodes from ChromaDB for paper {paper_id}")
        else:
            print(f"No nodes found to delete for paper {paper_id}")
    except Exception as e:
        print(f"Error removing nodes from ChromaDB: {e}")
        import traceback
        traceback.print_exc()
    
    return {"message": "Paper and associated nodes deleted successfully"}

@app.post("/projects/{project_id}/upload/")
def upload_pdf(project_id: int, file: UploadFile = File(...)):
    # Save PDF
    upload_dir = f"static/pdfs/{project_id}"
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, file.filename)
    
    with open(file_path, "wb") as buffer:
        buffer.write(file.file.read())
    
    # Generate a random color for this paper
    def generate_color():
        colors = [
            "#EF4444", "#F59E0B", "#10B981", "#3B82F6", "#8B5CF6",
            "#EC4899", "#14B8A6", "#F97316", "#06B6D4", "#6366F1"
        ]
        return random.choice(colors)
    
    paper_color = generate_color()
    
    # Save Paper Metadata with color
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO papers (project_id, title, filename, color) VALUES (?, ?, ?, ?)",
        (project_id, file.filename, file.filename, paper_color)
    )
    paper_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    # Process PDF
    nodes = pdf_processor.process_pdf(file_path, paper_id)
    
    # Generate Embeddings
    nodes = embedding_service.generate_embeddings(nodes)
    
    # Save to ChromaDB with color in metadata
    collection = get_chroma_collection(project_id)
    
    ids = [node["id"] for node in nodes]
    embeddings = [node["embedding"] for node in nodes]
    metadatas = [{
        "type": node["type"],
        "content": node["content"],
        "page_number": node["page_number"],
        "paper_id": node["paper_id"],
        "paper_color": paper_color,  # Add color to metadata
        "bbox": str(node["bbox"]) # Chroma metadata must be str, int, float, bool
    } for node in nodes]
    documents = [node["content"] if node["type"] == "text" else "image" for node in nodes]
    
    collection.add(
        ids=ids,
        embeddings=embeddings,
        metadatas=metadatas,
        documents=documents
    )
    
    return {"message": "File uploaded and processed successfully", "paper_id": paper_id, "nodes_count": len(nodes)}

@app.get("/projects/{project_id}/graph", response_model=GraphData)
def get_project_graph(project_id: int):
    collection = get_chroma_collection(project_id)
    
    # Fetch all nodes
    result = collection.get(include=["embeddings", "metadatas", "documents"])
    
    nodes = []
    if result["ids"]:
        for i, id in enumerate(result["ids"]):
            metadata = result["metadatas"][i]
            # Convert bbox back to list if needed, or keep as string for frontend to parse
            # For graph service, we need embeddings
            nodes.append({
                "id": id,
                "type": metadata["type"],
                "content": metadata["content"],
                "page_number": metadata["page_number"],
                "paper_id": metadata["paper_id"],
                "paper_color": metadata.get("paper_color", "#3B82F6"),  # Default color if not found
                "bbox": eval(metadata["bbox"]), # Unsafe but quick for now
                "embedding": result["embeddings"][i]
            })
            
    graph_data = graph_service.build_graph(nodes)
    return graph_data

@app.get("/")
def read_root():
    return {"message": "Paper Explorer API is running"}
