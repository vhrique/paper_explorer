from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import os
import uuid
import random
import io
import psycopg2.extras
from typing import List

from database import init_db, get_db_connection, get_chroma_collection
from models import ProjectCreate, Project, Paper, GraphData, PaperUpdate, TagCreate, Tag, NodeTag, TagSummary, ComputeEmbeddingsResponse
from services.pdf_processor import PDFProcessor
from services.embedding import EmbeddingService
from services.graph import GraphService
from services.storage import S3StorageService

app = FastAPI(title="Paper Explorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Services
storage_service = S3StorageService()
pdf_processor = PDFProcessor(storage_service)
embedding_service = EmbeddingService()
graph_service = GraphService()

@app.on_event("startup")
def startup_event():
    init_db()

@app.post("/projects/", response_model=Project)
def create_project(project: ProjectCreate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute(
        "INSERT INTO projects (name, description) VALUES (%s, %s) RETURNING id",
        (project.name, project.description)
    )
    project_id = cursor.fetchone()['id']
    conn.commit()
    
    # Fetch created project
    cursor.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
    row = cursor.fetchone()
    conn.close()
    
    return dict(row)

@app.get("/projects/", response_model=List[Project])
def list_projects():
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Delete the project (cascade will handle papers)
    cursor.execute("DELETE FROM projects WHERE id = %s", (project_id,))
    
    conn.commit()
    conn.close()
    
    return {"message": "Project deleted successfully"}

@app.get("/projects/{project_id}/papers/", response_model=List[Paper])
def list_papers(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT * FROM papers WHERE project_id = %s ORDER BY created_at DESC", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    
    papers = []
    for row in rows:
        paper = dict(row)
        # Generate proxy URL instead of presigned URL
        paper['url'] = f"/api/papers/{paper['id']}/pdf"
        papers.append(paper)
        
    return papers

@app.get("/papers/{paper_id}", response_model=Paper)
def get_paper(paper_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT * FROM papers WHERE id = %s", (paper_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    paper = dict(row)
    # Generate proxy URL instead of presigned URL
    paper['url'] = f"/api/papers/{paper_id}/pdf"
    
    return paper

@app.get("/papers/{paper_id}/pdf")
def get_paper_pdf(paper_id: int):
    """Proxy PDF file from MinIO to avoid CORS issues"""
    from fastapi.responses import StreamingResponse
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT project_id, filename FROM papers WHERE id = %s", (paper_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    pdf_key = f"pdfs/{row['project_id']}/{row['filename']}"
    
    try:
        # Download from MinIO
        response = storage_service.s3_client.get_object(Bucket=storage_service.bucket_name, Key=pdf_key)
        
        # Stream it to the client
        return StreamingResponse(
            response['Body'],
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"inline; filename={row['filename']}"
            }
        )
    except Exception as e:
        print(f"Error fetching PDF: {e}")
        raise HTTPException(status_code=404, detail="PDF file not found")
@app.patch("/papers/{paper_id}", response_model=Paper)
def update_paper(paper_id: int, paper_update: PaperUpdate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Check if paper exists
    cursor.execute("SELECT * FROM papers WHERE id = %s", (paper_id,))
    existing_paper = cursor.fetchone()
    
    if not existing_paper:
        conn.close()
        raise HTTPException(status_code=404, detail="Paper not found")
    
    # Build update query dynamically
    update_fields = []
    params = []
    
    if paper_update.title is not None:
        update_fields.append("title = %s")
        params.append(paper_update.title)
        
    if paper_update.color is not None:
        update_fields.append("color = %s")
        params.append(paper_update.color)
        
    if paper_update.description is not None:
        update_fields.append("description = %s")
        params.append(paper_update.description)
        
    if not update_fields:
        conn.close()
        return dict(existing_paper)
        
    params.append(paper_id)
    query = f"UPDATE papers SET {', '.join(update_fields)} WHERE id = %s RETURNING *"
    
    cursor.execute(query, tuple(params))
    updated_paper = cursor.fetchone()
    conn.commit()
    
    # If color changed, update ChromaDB metadata
    if paper_update.color is not None:
        try:
            collection = get_chroma_collection(existing_paper['project_id'])
            results = collection.get(where={"paper_id": paper_id})
            
            if not results["ids"]:
                results = collection.get(where={"paper_id": str(paper_id)})
                
            if results["ids"]:
                # Update metadata for all nodes
                new_metadatas = []
                for metadata in results["metadatas"]:
                    metadata["paper_color"] = paper_update.color
                    new_metadatas.append(metadata)
                    
                collection.update(
                    ids=results["ids"],
                    metadatas=new_metadatas
                )
        except Exception as e:
            print(f"Error updating ChromaDB metadata: {e}")
            
    conn.close()
    
    paper = dict(updated_paper)
    paper['url'] = f"/api/papers/{paper_id}/pdf"
    return paper


@app.delete("/papers/{paper_id}")
def delete_paper(paper_id: int):
    # Get paper info first to know which project it belongs to
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT project_id, filename FROM papers WHERE id = %s", (paper_id,))
    row = cursor.fetchone()
    
    if not row:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    project_id = row["project_id"]
    filename = row["filename"]
    
    # Delete the paper from database
    cursor.execute("DELETE FROM papers WHERE id = %s", (paper_id,))
    conn.commit()
    conn.close()
    
    # Delete PDF from S3
    pdf_key = f"pdfs/{project_id}/{filename}"
    storage_service.delete_file(pdf_key)
    
    # Remove all nodes belonging to this paper from ChromaDB
    try:
        collection = get_chroma_collection(project_id)
        
        # Get all IDs for this paper
        results = collection.get(where={"paper_id": paper_id})
        
        # Also try string if int failed (legacy support)
        if not results["ids"]:
            results = collection.get(where={"paper_id": str(paper_id)})
        
        if results["ids"]:
            # Delete images from S3 if any
            if results["metadatas"]:
                for metadata in results["metadatas"]:
                    if metadata.get("type") == "image":
                        image_key = metadata.get("content")
                        if image_key:
                            storage_service.delete_file(image_key)

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
    # Read file content first
    file_bytes = file.file.read()
    
    # Upload PDF to S3
    pdf_key = f"pdfs/{project_id}/{file.filename}"
    # Create a new BytesIO object for upload since upload_fileobj might close it
    storage_service.upload_file(io.BytesIO(file_bytes), pdf_key, content_type="application/pdf")
    
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
        "INSERT INTO papers (project_id, title, filename, color) VALUES (%s, %s, %s, %s) RETURNING id",
        (project_id, file.filename, file.filename, paper_color)
    )
    paper_id = cursor.fetchone()[0]
    conn.commit()
    conn.close()
    
    # Process PDF (pass bytes directly)
    nodes = pdf_processor.process_pdf(io.BytesIO(file_bytes), paper_id)
    
    # Generate Embeddings
    nodes = embedding_service.generate_embeddings(nodes)
    
    # Filter out nodes with empty embeddings
    valid_nodes = [node for node in nodes if node.get("embedding") is not None and len(node.get("embedding", [])) > 0]
    
    if len(valid_nodes) == 0:
        return {"message": "File uploaded but no valid embeddings generated", "paper_id": paper_id, "nodes_count": 0}
    
    # Save to ChromaDB with color in metadata
    collection = get_chroma_collection(project_id)
    
    ids = [node["id"] for node in valid_nodes]
    embeddings = [node["embedding"] for node in valid_nodes]
    metadatas = [{
        "type": node["type"],
        "content": node["content"],
        "page_number": node["page_number"],
        "paper_id": node["paper_id"],
        "paper_color": paper_color,  # Add color to metadata
        "bbox": str(node["bbox"]) # Chroma metadata must be str, int, float, bool
    } for node in valid_nodes]
    documents = [node["content"] if node["type"] == "text" else "image" for node in valid_nodes]
    
    collection.add(
        ids=ids,
        embeddings=embeddings,
        metadatas=metadatas,
        documents=documents
    )
    
    return {"message": "File uploaded and processed successfully", "paper_id": paper_id, "nodes_count": len(valid_nodes)}

@app.get("/projects/{project_id}/graph", response_model=GraphData)
def get_project_graph(project_id: int, use_new_embeddings: bool = False):
    collection = get_chroma_collection(project_id)
    
    # Fetch all nodes
    result = collection.get(include=["embeddings", "metadatas", "documents"])
    
    nodes = []
    if result["ids"]:
        for i, id in enumerate(result["ids"]):
            metadata = result["metadatas"][i]
            
            # If it's an image, generate a presigned URL
            content = metadata["content"]
            if metadata["type"] == "image":
                content = storage_service.get_presigned_url(content)
            
            node = {
                "id": id,
                "type": metadata["type"],
                "content": content,
                "page_number": metadata["page_number"],
                "paper_id": metadata["paper_id"],
                "paper_color": metadata.get("paper_color", "#3B82F6"),  # Default color if not found
                "bbox": eval(metadata["bbox"]), # Unsafe but quick for now
                "embedding": result["embeddings"][i]
            }
            
            # Check if new_embedding exists in metadata
            if use_new_embeddings and "new_embedding" in metadata:
                # Parse the new_embedding from string back to list
                import json
                node["embedding"] = json.loads(metadata["new_embedding"])
            
            nodes.append(node)
            
    graph_data = graph_service.build_graph(nodes)
    return graph_data

@app.get("/")
def read_root():
    return {"message": "Paper Explorer API is running"}

@app.post("/tags/", response_model=Tag)
def create_tag(tag: TagCreate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        cursor.execute(
            "INSERT INTO tags (name, type, project_id) VALUES (%s, %s, %s) RETURNING *",
            (tag.name, tag.type, tag.project_id)
        )
        new_tag = cursor.fetchone()
        conn.commit()
        return dict(new_tag)
    except psycopg2.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Tag already exists")
    finally:
        conn.close()

@app.get("/projects/{project_id}/tags", response_model=List[Tag])
def list_tags(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Fetch global tags AND local tags for this project
    cursor.execute(
        "SELECT * FROM tags WHERE type = 'global' OR (type = 'local' AND project_id = %s) ORDER BY name",
        (project_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.post("/nodes/{node_id}/tags")
def add_node_tag(node_id: str, tag_id: int = Form(...)):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute(
            "INSERT INTO node_tags (tag_id, node_id) VALUES (%s, %s)",
            (tag_id, node_id)
        )
        conn.commit()
        return {"message": "Tag added to node"}
    except psycopg2.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Tag already assigned to this node")
    finally:
        conn.close()

@app.delete("/nodes/{node_id}/tags/{tag_id}")
def remove_node_tag(node_id: str, tag_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute(
        "DELETE FROM node_tags WHERE node_id = %s AND tag_id = %s",
        (node_id, tag_id)
    )
    conn.commit()
    conn.close()
    
    return {"message": "Tag removed from node"}

@app.get("/nodes/{node_id}/tags", response_model=List[Tag])
def get_node_tags(node_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    cursor.execute("""
        SELECT t.* 
        FROM tags t
        JOIN node_tags nt ON t.id = nt.tag_id
        WHERE nt.node_id = %s
        ORDER BY t.name
    """, (node_id,))
    
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.get("/projects/{project_id}/tags/summary", response_model=List[TagSummary])
def get_tag_summary(project_id: int):
    """Get summary of all tags with node counts for a project"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get all tags (global + local for this project) with node counts
    cursor.execute("""
        SELECT 
            t.id as tag_id,
            t.name as tag_name,
            t.type as tag_type,
            COUNT(nt.node_id) as node_count
        FROM tags t
        LEFT JOIN node_tags nt ON t.id = nt.tag_id
        WHERE t.type = 'global' OR (t.type = 'local' AND t.project_id = %s)
        GROUP BY t.id, t.name, t.type
        ORDER BY t.name
    """, (project_id,))
    
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.post("/projects/{project_id}/embeddings/compute", response_model=ComputeEmbeddingsResponse)
def compute_new_embeddings(project_id: int):
    """Compute new embeddings for all nodes in a project"""
    import json
    
    collection = get_chroma_collection(project_id)
    
    # Fetch all nodes with embeddings
    result = collection.get(include=["embeddings", "metadatas"])
    
    if not result["ids"]:
        return ComputeEmbeddingsResponse(
            status="success",
            message="No nodes found in project",
            nodes_processed=0
        )
    
    # Fetch all tags for all nodes in one query
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get all node-tag relationships for this project's nodes
    node_ids = result["ids"]
    cursor.execute("""
        SELECT nt.node_id, t.id as tag_id, t.name as tag_name, t.type as tag_type
        FROM node_tags nt
        JOIN tags t ON nt.tag_id = t.id
        WHERE nt.node_id = ANY(%s)
        ORDER BY nt.node_id, t.name
    """, (node_ids,))
    
    tag_rows = cursor.fetchall()
    conn.close()
    
    # Build a dictionary of node_id -> list of tags
    node_tags_map = {}
    for row in tag_rows:
        node_id = row["node_id"]
        if node_id not in node_tags_map:
            node_tags_map[node_id] = []
        node_tags_map[node_id].append({
            "tag_id": row["tag_id"],
            "tag_name": row["tag_name"],
            "tag_type": row["tag_type"]
        })
    
    # Build nodes list with tags
    nodes = []
    for i, id in enumerate(result["ids"]):
        nodes.append({
            "id": id,
            "embedding": result["embeddings"][i],
            "metadata": result["metadatas"][i],
            "tags": node_tags_map.get(id, [])  # Include tags, empty list if no tags
        })
    
    # Compute new embeddings
    nodes_with_new = embedding_service.compute_new_embeddings(nodes)
    
    # Update ChromaDB metadata with new embeddings
    updated_metadatas = []
    for node in nodes_with_new:
        metadata = node["metadata"].copy()
        if "new_embedding" in node:
            # Store as JSON string in metadata
            metadata["new_embedding"] = json.dumps(node["new_embedding"])
        updated_metadatas.append(metadata)
    
    # Update the collection
    collection.update(
        ids=result["ids"],
        metadatas=updated_metadatas
    )
    
    return ComputeEmbeddingsResponse(
        status="success",
        message=f"Successfully computed new embeddings for {len(nodes_with_new)} nodes",
        nodes_processed=len(nodes_with_new)
    )
