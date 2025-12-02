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
from models import (ProjectCreate, Project, Paper, GraphData, PaperUpdate, TagCreate, Tag, 
                    NodeTag, TagSummary, ComputeEmbeddingsResponse, TagUpdate, Note, 
                    NoteCreate, NoteUpdate, Link, LinkCreate, TrainModelRequest, TrainModelResponse)
from services.pdf_processor import PDFProcessor
from services.embedding import EmbeddingService
from services.graph import GraphService
from services.storage import S3StorageService
from services.similarity import SimilarityService
from services.tag_service import TagService


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
similarity_service = SimilarityService()
tag_service = TagService(storage_service)

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
    
    try:
        # Get all node IDs from ChromaDB for this project
        collection = get_chroma_collection(project_id)
        result = collection.get(include=[])
        
        if result["ids"]:
            # Delete all node_tags entries for nodes in this project
            cursor.execute(
                "DELETE FROM node_tags WHERE node_id = ANY(%s)",
                (result["ids"],)
            )
        
        # Delete the project (cascade will handle papers and local tags)
        cursor.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"Error deleting project: {e}")
        raise
    finally:
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
    node_ids = []
    if result["ids"]:
        node_ids = result["ids"]
        
        # Fetch tag information for all nodes in one query
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("""
            SELECT DISTINCT node_id
            FROM node_tags
            WHERE node_id = ANY(%s)
        """, (node_ids,))
        tagged_node_ids = {row["node_id"] for row in cursor.fetchall()}
        conn.close()
        
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
                "embedding": result["embeddings"][i],
                "has_tags": id in tagged_node_ids,  # Add tag indicator
                "title": metadata.get("title"),
                "note_id": metadata.get("note_id")
            }
            
            # Include tag_scores if they exist in metadata
            if "tag_scores" in metadata:
                import json
                tag_scores_dict = json.loads(metadata["tag_scores"])
                node["tag_scores"] = tag_scores_dict
                
                # If use_new_embeddings is true, use tag scores as embedding for PCA layout
                if use_new_embeddings:
                    # Convert tag_scores dict to a list of values (maintain consistent order)
                    tag_score_values = [tag_scores_dict[tag] for tag in sorted(tag_scores_dict.keys())]
                    if len(tag_score_values) > 0:
                        node["embedding"] = tag_score_values
            
            nodes.append(node)
            
    # Fetch all links for this project
    # We need links where source OR target is in the node_ids list
    links = []
    if node_ids:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("""
            SELECT * FROM links 
            WHERE source_node_id = ANY(%s) OR target_node_id = ANY(%s)
        """, (node_ids, node_ids))
        links = [dict(row) for row in cursor.fetchall()]
        conn.close()

    graph_data = graph_service.build_graph(nodes, links=links)
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
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Get the project_id for this node by querying the tag
        cursor.execute("SELECT project_id, type FROM tags WHERE id = %s", (tag_id,))
        tag_row = cursor.fetchone()
        
        if not tag_row:
            conn.close()
            raise HTTPException(status_code=404, detail="Tag not found")
        
        # Determine project_id: use tag's project_id if local, or find node's project
        if tag_row['type'] == 'local' and tag_row['project_id']:
            project_id = tag_row['project_id']
        else:
            # For global tags, we need to find which project this node belongs to
            # We'll check all projects until we find the node
            cursor.execute("SELECT id FROM projects")
            projects = cursor.fetchall()
            project_id = None
            
            for proj in projects:
                try:
                    collection = get_chroma_collection(proj['id'])
                    result = collection.get(ids=[node_id], include=[])
                    if result['ids']:
                        project_id = proj['id']
                        break
                except:
                    continue
            
            if not project_id:
                conn.close()
                raise HTTPException(status_code=404, detail="Node not found in any project")
        
        # Insert the tag assignment
        cursor.execute(
            "INSERT INTO node_tags (tag_id, node_id) VALUES (%s, %s)",
            (tag_id, node_id)
        )
        conn.commit()
        conn.close()
        
        # Train SVM and compute tag scores
        try:
            train_result = tag_service.train_and_store_model(project_id, use_global_context=False)
            nodes_scored = tag_service.compute_tag_scores(project_id)
            print(f"SVM trained with {train_result['num_training_samples']} samples, {nodes_scored} nodes scored")
        except ValueError as e:
            # If training fails (e.g., not enough samples), that's okay for the first tag assignment
            print(f"Warning: Could not train SVM: {e}")
        
        return {"message": "Tag added to node"}
    except psycopg2.IntegrityError:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail="Tag already assigned to this node")
    except Exception as e:
        conn.rollback()
        conn.close()
        raise

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

@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: int):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Delete the tag (cascade should handle node_tags if configured, but let's be safe)
        # First delete from node_tags
        cursor.execute("DELETE FROM node_tags WHERE tag_id = %s", (tag_id,))
        # Then delete the tag
        cursor.execute("DELETE FROM tags WHERE id = %s", (tag_id,))
        conn.commit()
        return {"message": "Tag deleted successfully"}
    except Exception as e:
        conn.rollback()
        print(f"Error deleting tag: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete tag")
    finally:
        conn.close()

@app.patch("/tags/{tag_id}", response_model=Tag)
def update_tag(tag_id: int, tag_update: TagUpdate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Check if tag exists
        cursor.execute("SELECT * FROM tags WHERE id = %s", (tag_id,))
        existing_tag = cursor.fetchone()
        
        if not existing_tag:
            raise HTTPException(status_code=404, detail="Tag not found")
            
        if tag_update.name:
            # Check if a tag with the new name already exists in the same scope
            # Scope is defined by (name, type, project_id)
            cursor.execute("""
                SELECT * FROM tags 
                WHERE name = %s 
                AND type = %s 
                AND project_id IS NOT DISTINCT FROM %s
                AND id != %s
            """, (
                tag_update.name, 
                existing_tag['type'], 
                existing_tag['project_id'], 
                tag_id
            ))
            target_tag = cursor.fetchone()
            
            if target_tag:
                # MERGE LOGIC
                target_tag_id = target_tag['id']
                
                # 1. Move nodes from old tag to new tag, ignoring duplicates
                # We select all nodes from the old tag and try to insert them for the new tag
                # ON CONFLICT DO NOTHING handles cases where the node already has the new tag
                cursor.execute("""
                    INSERT INTO node_tags (tag_id, node_id)
                    SELECT %s, node_id FROM node_tags WHERE tag_id = %s
                    ON CONFLICT (tag_id, node_id) DO NOTHING
                """, (target_tag_id, tag_id))
                
                # 2. Delete old tag (cascade will remove remaining node_tags entries for old tag)
                cursor.execute("DELETE FROM tags WHERE id = %s", (tag_id,))
                
                conn.commit()
                return dict(target_tag)
            
            else:
                # NORMAL RENAME
                cursor.execute(
                    "UPDATE tags SET name = %s WHERE id = %s RETURNING *",
                    (tag_update.name, tag_id)
                )
                updated_tag = cursor.fetchone()
                conn.commit()
                return dict(updated_tag)
            
        return dict(existing_tag)
    except psycopg2.IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=400, detail="Tag name already exists")
    finally:
        conn.close()

@app.get("/projects/{project_id}/tags/{tag_id}/nodes")
def get_tag_nodes(project_id: int, tag_id: int):
    """Get all nodes in a project that have a specific tag"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get nodes from this project that have the tag
    # We need to join with papers to filter by project_id
    cursor.execute("""
        SELECT 
            nt.node_id,
            nt.created_at as tagged_at
        FROM node_tags nt
        JOIN tags t ON nt.tag_id = t.id
        -- We need to check if the node belongs to the project
        -- Since node_id is a string from ChromaDB/PDF processing, we can't directly join with papers table easily 
        -- unless we parse the node_id or look up in ChromaDB.
        -- However, our node_id format usually implies paper_id or we can fetch metadata.
        -- BUT, for now let's rely on the fact that we can fetch node metadata from ChromaDB.
        WHERE nt.tag_id = %s
    """, (tag_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return []
        
    # Now we need to fetch the actual node content from ChromaDB to display snippets
    # This is a bit heavy but necessary for the UI
    collection = get_chroma_collection(project_id)
    
    node_ids = [row['node_id'] for row in rows]
    
    try:
        results = collection.get(
            ids=node_ids,
            include=["metadatas", "documents"]
        )
        
        # Create a map for quick lookup
        chroma_nodes = {}
        if results['ids']:
            for i, nid in enumerate(results['ids']):
                chroma_nodes[nid] = {
                    "content": results['documents'][i],
                    "metadata": results['metadatas'][i]
                }
        
        # Merge data
        tagged_nodes = []
        for row in rows:
            nid = row['node_id']
            if nid in chroma_nodes:
                node_data = chroma_nodes[nid]
                metadata = node_data['metadata']
                
                # Only include if it belongs to the requested project (double check)
                if int(metadata.get('paper_id', 0)) in [p['id'] for p in _get_project_papers(project_id)]:
                     tagged_nodes.append({
                        "node_id": nid,
                        "content": node_data['content'],
                        "page_number": metadata.get('page_number'),
                        "paper_id": metadata.get('paper_id'),
                        "paper_color": metadata.get('paper_color'),
                        "bbox": eval(metadata.get('bbox', '[]')),
                        "tagged_at": row['tagged_at']
                    })
                else:
                    # If we can't verify project ownership easily via helper, 
                    # we can rely on the fact that get_chroma_collection(project_id) 
                    # only returns nodes for that project (if using separate collections per project).
                    # Our get_chroma_collection uses "project_{project_id}" so it IS scoped to project.
                    # So if it's in the collection, it's in the project.
                    tagged_nodes.append({
                        "node_id": nid,
                        "content": node_data['content'],
                        "page_number": metadata.get('page_number'),
                        "paper_id": metadata.get('paper_id'),
                        "paper_color": metadata.get('paper_color'),
                        "bbox": eval(metadata.get('bbox', '[]')),
                        "tagged_at": row['tagged_at']
                    })
                    
        return tagged_nodes
        
    except Exception as e:
        print(f"Error fetching node details from ChromaDB: {e}")
        return []

def _get_project_papers(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT id FROM papers WHERE project_id = %s", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    return rows



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

def get_global_tagged_nodes_from_all_projects(exclude_project_id: int) -> List[dict]:
    """
    Fetch all nodes from all projects (except the specified one) that have at least one global tag.
    Returns a list of node dictionaries with embeddings and tags.
    """
    from database import chroma_client
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get all project IDs except the current one
    cursor.execute("SELECT id FROM projects WHERE id != %s", (exclude_project_id,))
    project_rows = cursor.fetchall()
    project_ids = [row["id"] for row in project_rows]
    
    all_external_nodes = []
    
    for project_id in project_ids:
        try:
            # Get the ChromaDB collection for this project
            collection = chroma_client.get_collection(name=f"project_{project_id}")
            
            # Fetch all nodes from this project
            result = collection.get(include=["embeddings", "metadatas"])
            
            if not result["ids"]:
                continue
            
            # Get all node IDs for this project
            node_ids = result["ids"]
            
            # Fetch tags for these nodes - only keep nodes with global tags
            cursor.execute("""
                SELECT nt.node_id, t.id as tag_id, t.name as tag_name, t.type as tag_type
                FROM node_tags nt
                JOIN tags t ON nt.tag_id = t.id
                WHERE nt.node_id = ANY(%s) AND t.type = 'global'
                ORDER BY nt.node_id, t.name
            """, (node_ids,))
            
            tag_rows = cursor.fetchall()
            
            # Build a map of node_id -> list of global tags
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
            
            # Build node list - only include nodes that have global tags
            for i, node_id in enumerate(result["ids"]):
                if node_id in node_tags_map:  # Only include if has global tags
                    all_external_nodes.append({
                        "id": node_id,
                        "embedding": result["embeddings"][i],
                        "tags": node_tags_map[node_id]
                    })
                    
        except Exception as e:
            print(f"Error fetching nodes from project {project_id}: {e}")
            continue
    
    conn.close()
    return all_external_nodes

@app.post("/projects/{project_id}/tags/train", response_model=TrainModelResponse)
def train_tag_model(project_id: int, request: TrainModelRequest):
    """Train SVM model for tag suggestions"""
    try:
        # Train and store the model
        train_result = tag_service.train_and_store_model(project_id, request.use_global_context)
        
        # Compute and store tag scores for all nodes
        nodes_scored = tag_service.compute_tag_scores(project_id)
        
        return TrainModelResponse(
            status="success",
            message=f"Successfully trained model and computed tag scores for {nodes_scored} nodes",
            num_training_samples=train_result['num_training_samples'],
            num_tags=train_result['num_tags'],
            nodes_scored=nodes_scored
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Error training model: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to train model: {str(e)}")

@app.post("/projects/{project_id}/notes/", response_model=Note)
def create_note(project_id: int, note: NoteCreate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # 1. Create Note in DB
    cursor.execute(
        "INSERT INTO notes (project_id, title, content, color) VALUES (%s, %s, %s, %s) RETURNING *",
        (project_id, note.title, note.content, note.color)
    )
    new_note = cursor.fetchone()
    conn.commit()
    conn.close()
    
    # 2. Generate Embedding
    embedding = embedding_service.generate_text_embedding(note.content)
    
    # 3. Save to ChromaDB
    collection = get_chroma_collection(project_id)
    
    note_id = str(new_note['id'])
    # Prefix with 'note_' to avoid collision with other IDs if necessary, 
    # but since other IDs are UUIDs or hashes, simple int ID might collide if not careful.
    # Actually paper nodes use UUIDs generated in pdf_processor.
    # Let's use "note_{id}" as the ID in ChromaDB to be safe and distinct.
    chroma_id = f"note_{note_id}"
    
    collection.add(
        ids=[chroma_id],
        embeddings=[embedding],
        metadatas=[{
            "type": "note",
            "title": note.title or "",
            "content": note.content,
            "paper_id": -1, # Notes don't belong to a paper
            "paper_color": note.color,
            "note_id": note_id,
            "bbox": "[]",
            "page_number": 0
        }],
        documents=[note.content]
    )
    
    return dict(new_note)

@app.get("/projects/{project_id}/notes/", response_model=List[Note])
def list_notes(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT * FROM notes WHERE project_id = %s ORDER BY created_at DESC", (project_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.patch("/notes/{note_id}", response_model=Note)
def update_note(note_id: int, note_update: NoteUpdate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Check if note exists
    cursor.execute("SELECT * FROM notes WHERE id = %s", (note_id,))
    existing_note = cursor.fetchone()
    
    if not existing_note:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Build update query
    update_fields = []
    params = []
    
    if note_update.title is not None:
        update_fields.append("title = %s")
        params.append(note_update.title)
        
    if note_update.content is not None:
        update_fields.append("content = %s")
        params.append(note_update.content)
        
    if note_update.color is not None:
        update_fields.append("color = %s")
        params.append(note_update.color)
        
    update_fields.append("updated_at = CURRENT_TIMESTAMP")
        
    if not update_fields:
        conn.close()
        return dict(existing_note)
        
    params.append(note_id)
    query = f"UPDATE notes SET {', '.join(update_fields)} WHERE id = %s RETURNING *"
    
    cursor.execute(query, tuple(params))
    updated_note = cursor.fetchone()
    conn.commit()
    conn.close()
    
    # Update ChromaDB if content or color changed
    if note_update.content is not None or note_update.color is not None or note_update.title is not None:
        try:
            collection = get_chroma_collection(existing_note['project_id'])
            chroma_id = f"note_{note_id}"
            
            # Fetch existing metadata
            result = collection.get(ids=[chroma_id])
            if result['ids']:
                metadata = result['metadatas'][0]
                
                # Update metadata
                if note_update.color is not None:
                    metadata['paper_color'] = note_update.color
                if note_update.title is not None:
                    metadata['title'] = note_update.title
                if note_update.content is not None:
                    metadata['content'] = note_update.content
                    
                # Update embedding if content changed
                embeddings = None
                documents = None
                if note_update.content is not None:
                    embeddings = [embedding_service.generate_text_embedding(note_update.content)]
                    documents = [note_update.content]
                
                collection.update(
                    ids=[chroma_id],
                    embeddings=embeddings,
                    metadatas=[metadata],
                    documents=documents
                )
        except Exception as e:
            print(f"Error updating ChromaDB for note: {e}")
            
    return dict(updated_note)

@app.delete("/notes/{note_id}")
def delete_note(note_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    cursor.execute("SELECT project_id FROM notes WHERE id = %s", (note_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found")
        
    project_id = row['project_id']
    
    cursor.execute("DELETE FROM notes WHERE id = %s", (note_id,))
    conn.commit()
    conn.close()
    
    # Delete from ChromaDB
    try:
        collection = get_chroma_collection(project_id)
        chroma_id = f"note_{note_id}"
        collection.delete(ids=[chroma_id])
    except Exception as e:
        print(f"Error deleting note from ChromaDB: {e}")
        
    return {"message": "Note deleted successfully"}

@app.get("/notes/{note_id}/similar", response_model=List[dict])
def get_similar_nodes(note_id: int, limit: int = 20, use_new_embeddings: bool = False):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get note content and project_id
    cursor.execute("SELECT content, project_id FROM notes WHERE id = %s", (note_id,))
    note = cursor.fetchone()
    conn.close()
    
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
        
    project_id = note['project_id']
    
    # Get the query embedding
    collection = get_chroma_collection(project_id)
    chroma_note_id = f"note_{note_id}"
    
    # Fetch the note's embedding from ChromaDB
    note_result = collection.get(ids=[chroma_note_id], include=["embeddings", "metadatas"])
    
    if not note_result['ids']:
        raise HTTPException(status_code=404, detail="Note embedding not found")
    
    # Get query embedding based on mode
    if use_new_embeddings:
        # Try to get new_embedding from metadata
        metadata = note_result['metadatas'][0]
        new_emb_str = metadata.get('new_embedding')
        
        if not new_emb_str:
            # Fall back to generating one on the fly or return error
            raise HTTPException(
                status_code=400, 
                detail="New embeddings not computed. Please compute embeddings first in Advanced View."
            )
        
        try:
            import json
            query_embedding = json.loads(new_emb_str)
        except (json.JSONDecodeError, TypeError):
            raise HTTPException(status_code=500, detail="Failed to parse new embedding")
    else:
        # Use original embedding
        query_embedding = note_result['embeddings'][0]
    
    # Fetch all nodes from the collection
    all_nodes_result = collection.get(include=["embeddings", "metadatas", "documents"])
    
    if not all_nodes_result['ids']:
        return []
    
    # Prepare nodes for similarity service
    nodes = []
    for i, node_id in enumerate(all_nodes_result['ids']):
        nodes.append({
            'id': node_id,
            'embedding': all_nodes_result['embeddings'][i],
            'metadata': all_nodes_result['metadatas'][i],
            'document': all_nodes_result['documents'][i]
        })
    
    # Use similarity service to find similar nodes
    similar_results = similarity_service.find_similar_nodes(
        query_embedding=query_embedding,
        nodes=nodes,
        limit=limit + 1,  # +1 to account for the note itself
        use_new_embeddings=use_new_embeddings
    )
    
    # Build response
    similar_nodes = []
    for node_id, similarity, metadata in similar_results:
        # Skip the note itself
        if node_id == chroma_note_id:
            continue
        
        # Construct node object
        node = {
            "id": node_id,
            "type": metadata.get("type", "text"),
            "content": metadata.get("content", ""),
            "page_number": metadata.get("page_number"),
            "paper_id": metadata.get("paper_id"),
            "paper_color": metadata.get("paper_color"),
            "bbox": eval(metadata.get("bbox", "[]")),
            "similarity": similarity,
            "title": metadata.get("title")
        }
        
        # If image, generate presigned URL
        if node["type"] == "image":
            node["content"] = storage_service.get_presigned_url(metadata.get("content"))
            
        similar_nodes.append(node)
        
        # Stop once we have enough results (excluding the note itself)
        if len(similar_nodes) >= limit:
            break
    
    return similar_nodes


@app.post("/links/", response_model=Link)
def create_link(link: LinkCreate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        cursor.execute(
            "INSERT INTO links (source_node_id, target_node_id, type) VALUES (%s, %s, %s) RETURNING *",
            (link.source_node_id, link.target_node_id, link.type)
        )
        new_link = cursor.fetchone()
        conn.commit()
        return dict(new_link)
    except psycopg2.IntegrityError:
        conn.rollback()
        # If link already exists, just return it
        cursor.execute(
            "SELECT * FROM links WHERE source_node_id = %s AND target_node_id = %s",
            (link.source_node_id, link.target_node_id)
        )
        existing_link = cursor.fetchone()
        return dict(existing_link)
    finally:
        conn.close()

@app.get("/links/{node_id}", response_model=List[Link])
def get_node_links(node_id: str):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get links where node is source OR target
    cursor.execute("""
        SELECT * FROM links 
        WHERE source_node_id = %s OR target_node_id = %s
        ORDER BY created_at DESC
    """, (node_id, node_id))
    
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.delete("/links/")
def delete_link(source_node_id: str, target_node_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Delete link regardless of direction (or check both directions)
        # Since our unique constraint is (source, target), we should be careful.
        # But usually we want to remove the connection.
        # Let's try to delete both directions just in case, or specific one.
        # For now, let's delete the specific direction requested.
        cursor.execute(
            "DELETE FROM links WHERE source_node_id = %s AND target_node_id = %s",
            (source_node_id, target_node_id)
        )
        
        # Also try the reverse direction if we want bidirectional deletion?
        # For now let's stick to explicit deletion.
        
        conn.commit()
        return {"message": "Link deleted successfully"}
    except Exception as e:
        conn.rollback()
        print(f"Error deleting link: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete link")
    finally:
        conn.close()
