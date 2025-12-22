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

from database import (init_db, get_db_connection, insert_nodes, get_nodes_by_project, 
                     get_nodes_by_ids, get_nodes_by_paper, update_node_metadata, 
                     update_nodes_by_ids, delete_nodes_by_paper, delete_nodes_by_project, similarity_search)
from models import (ProjectCreate, Project, ProjectUpdate, Paper, GraphData, PaperUpdate, TagCreate, Tag, 
                    NodeTag, TagSummary, ComputeEmbeddingsResponse, TagUpdate, Note, 
                    NoteCreate, NoteUpdate, Link, LinkCreate, TrainModelRequest, TrainModelResponse)
from services.pdf_processor import PDFProcessor
from services.embedding import EmbeddingService
from services.graph import GraphService
from services.storage import S3StorageService
from services.similarity import SimilarityService
from services.tag_service import TagService
from services.semantic_scholar import SemanticScholarService
from services.discovery import DiscoveryService
from services.crossref_service import CrossRefService
from services.llm_service import get_llm_service


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
llm_service = get_llm_service()
similarity_service = SimilarityService(llm_service=llm_service)
tag_service = TagService(storage_service)
semantic_scholar_service = SemanticScholarService()
discovery_service = DiscoveryService(semantic_scholar_service, embedding_service, graph_service)
crossref_service = CrossRefService()

@app.on_event("startup")
def startup_event():
    init_db()

@app.get("/projects/{project_id}/discovery/context")
def get_discovery_context_endpoint(project_id: int):
    return discovery_service.get_discovery_context(project_id)

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

@app.patch("/projects/{project_id}", response_model=Project)
def update_project(project_id: int, project_update: ProjectUpdate):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Check if project exists
    cursor.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
    existing_project = cursor.fetchone()
    
    if not existing_project:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Build update query dynamically
    update_fields = []
    params = []
    
    if project_update.name is not None:
        update_fields.append("name = %s")
        params.append(project_update.name)
        
    if project_update.description is not None:
        update_fields.append("description = %s")
        params.append(project_update.description)
        
    if not update_fields:
        conn.close()
        return dict(existing_project)
        
    params.append(project_id)
    query = f"UPDATE projects SET {', '.join(update_fields)} WHERE id = %s RETURNING *"
    
    cursor.execute(query, tuple(params))
    updated_project = cursor.fetchone()
    conn.commit()
    conn.close()
    
    return dict(updated_project)

@app.delete("/projects/{project_id}")
def delete_project(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    try:
        # Get all papers for this project to delete PDFs
        cursor.execute("SELECT id, filename FROM papers WHERE project_id = %s", (project_id,))
        papers = cursor.fetchall()
        
        # Get all node IDs for this project
        nodes = get_nodes_by_project(project_id, include_embeddings=False)
        node_ids = [n['id'] for n in nodes]
        
        # Delete image files from storage
        if nodes:
            for node in nodes:
                if node.get("type") == "image":
                    image_key = node.get("content")
                    if image_key:
                        try:
                            storage_service.delete_file(image_key)
                            print(f"Deleted image: {image_key}")
                        except Exception as e:
                            print(f"Error deleting image {image_key}: {e}")
        
        if node_ids:
            # Delete all node_tags entries for nodes in this project
            cursor.execute(
                "DELETE FROM node_tags WHERE node_id = ANY(%s)",
                (node_ids,)
            )

            # Delete all links involving nodes in this project
            cursor.execute(
                "DELETE FROM links WHERE source_node_id = ANY(%s) OR target_node_id = ANY(%s)",
                (node_ids, node_ids)
            )
        
        # Delete the project (cascade will handle papers, nodes, notes, local tags, and svm_models)
        cursor.execute("DELETE FROM projects WHERE id = %s", (project_id,))
        
        conn.commit()
        
        # Delete PDF files from storage after database commit
        for paper in papers:
            pdf_key = f"pdfs/{project_id}/{paper['filename']}"
            try:
                storage_service.delete_file(pdf_key)
                print(f"Deleted PDF: {pdf_key}")
            except Exception as e:
                print(f"Error deleting PDF {pdf_key}: {e}")
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
        
    if paper_update.doi is not None:
        update_fields.append("doi = %s")
        params.append(paper_update.doi)
        
    if not update_fields:
        conn.close()
        return dict(existing_paper)
        
    params.append(paper_id)
    query = f"UPDATE papers SET {', '.join(update_fields)} WHERE id = %s RETURNING *"
    
    cursor.execute(query, tuple(params))
    updated_paper = cursor.fetchone()
    conn.commit()
    
    # If color changed, update node metadata
    if paper_update.color is not None:
        try:
            nodes = get_nodes_by_paper(paper_id)
            if nodes:
                node_ids = [n['id'] for n in nodes]
                update_nodes_by_ids(node_ids, {'paper_color': paper_update.color})
        except Exception as e:
            print(f"Error updating node metadata: {e}")
            
    # If DOI changed/added, fetch metadata
    if paper_update.doi is not None:
        doi = paper_update.doi
        # Run in background or directly? Directly for now as it's a user action
        # Re-use logic similar to upload (should refactor, but inline for now)
        try:
            # Connect specifically for this metadata update
            meta_conn = get_db_connection()
            meta_cursor = meta_conn.cursor()
            
            # CrossRef
            metadata = crossref_service.fetch_metadata(doi)
            if metadata:
                if metadata.get("abstract"):
                    meta_cursor.execute("UPDATE papers SET abstract = %s WHERE id = %s", (metadata["abstract"], paper_id))
                
                references = metadata.get("references", [])
                for ref in references:
                    meta_cursor.execute("""
                        INSERT INTO paper_references 
                        (paper_id, referenced_doi, referenced_title, referenced_authors, referenced_year, source)
                        VALUES (%s, %s, %s, %s, %s, 'crossref')
                    """, (paper_id, ref.get("doi"), ref.get("title"), str(ref.get("authors")), int(ref["year"]) if ref.get("year") and str(ref["year"]).isdigit() else None))
            
            # Semantic Scholar Citations
            ss_paper_ids = semantic_scholar_service.resolve_dois([doi])
            if ss_paper_ids:
                citations = semantic_scholar_service.get_citations(ss_paper_ids[0], limit=50)
                for cit in citations:
                     meta_cursor.execute("""
                        INSERT INTO paper_citations
                        (paper_id, citing_paper_id, citing_doi, citing_title, citing_authors, citing_year, source)
                        VALUES (%s, %s, %s, %s, %s, %s, 'semanticscholar')
                    """, (paper_id, cit.get("paperId"), cit.get("doi"), cit.get("title"), str(cit.get("authors")), cit.get("year")))
            
            meta_conn.commit()
            meta_conn.close()
        except Exception as e:
            print(f"Error updating metadata updates: {e}")
            
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
    
    # Remove all nodes belonging to this paper
    try:
        nodes = get_nodes_by_paper(paper_id)
        
        if nodes:
            # Delete images from S3 if any
            for node in nodes:
                # Get full node data to check type and content
                full_nodes = get_nodes_by_ids([node['id']], include_embeddings=False)
                if full_nodes:
                    full_node = full_nodes[0]
                    if full_node.get("type") == "image":
                        image_key = full_node.get("content")
                        if image_key:
                            storage_service.delete_file(image_key)

            count = delete_nodes_by_paper(paper_id)
            print(f"Successfully deleted {count} nodes for paper {paper_id}")
        else:
            print(f"No nodes found to delete for paper {paper_id}")
    except Exception as e:
        print(f"Error removing nodes: {e}")
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
    nodes, extracted_doi = pdf_processor.process_pdf(io.BytesIO(file_bytes), paper_id)
    
    # If DOI found, update the paper record and fetch additional metadata
    if extracted_doi:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Update DOI
        cursor.execute("UPDATE papers SET doi = %s WHERE id = %s", (extracted_doi, paper_id))
        
        # 2. Fetch Metadata & References from CrossRef
        print(f"Fetching CrossRef metadata for {extracted_doi}...")
        try:
            metadata = crossref_service.fetch_metadata(extracted_doi)
            if metadata:
                # Update Paper Title/Abstract
                update_fields = []
                params = []
                
                # Optionally update title if it looks better? keeping original filename-based title might be safer initially,
                # but let's update abstract for sure.
                if metadata.get("title"):
                     # We can update title if we want, but user might have set a custom one?
                     # Let's simple update title if it is the default filename one?
                     pass

                if metadata.get("abstract"):
                    update_fields.append("abstract = %s")
                    params.append(metadata["abstract"])
                
                if update_fields:
                    params.append(paper_id)
                    query = f"UPDATE papers SET {', '.join(update_fields)} WHERE id = %s"
                    cursor.execute(query, tuple(params))
                    print(f"Updated metadata for paper {paper_id}")

                # Store References (Outgoing)
                references = metadata.get("references", [])
                if references:
                    print(f"Found {len(references)} references")
                    for ref in references:
                        cursor.execute("""
                            INSERT INTO paper_references 
                            (paper_id, referenced_doi, referenced_title, referenced_authors, referenced_year, source)
                            VALUES (%s, %s, %s, %s, %s, 'crossref')
                        """, (
                            paper_id,
                            ref.get("doi"),
                            ref.get("title"),
                            str(ref.get("authors")) if ref.get("authors") else None,
                            int(ref["year"]) if ref.get("year") and str(ref["year"]).isdigit() else None
                        ))

        except Exception as e:
            print(f"Error fetching CrossRef data: {e}")

        # 3. Fetch Citations (Incoming) from Semantic Scholar
        print(f"Fetching citations for {extracted_doi}...")
        try:
            # First resolve DOI to PaperID
            ss_paper_ids = semantic_scholar_service.resolve_dois([extracted_doi])
            if ss_paper_ids:
                ss_paper_id = ss_paper_ids[0]
                citations = semantic_scholar_service.get_citations(ss_paper_id, limit=50) # limit to avoid overwhelming
                
                if citations:
                    print(f"Found {len(citations)} citations")
                    for cit in citations:
                         cursor.execute("""
                            INSERT INTO paper_citations
                            (paper_id, citing_paper_id, citing_doi, citing_title, citing_authors, citing_year, source)
                            VALUES (%s, %s, %s, %s, %s, %s, 'semanticscholar')
                        """, (
                            paper_id,
                            cit.get("paperId"),
                            cit.get("doi"),
                            cit.get("title"),
                            str(cit.get("authors")),
                            cit.get("year")
                        ))
        except Exception as e:
            print(f"Error fetching citations: {e}")

        conn.commit()
        conn.close()
        print(f"Stored DOI and metadata for paper {paper_id}: {extracted_doi}")
    
    # Generate Embeddings
    nodes = embedding_service.generate_embeddings(nodes)
    
    # Filter out nodes with empty embeddings
    valid_nodes = [node for node in nodes if node.get("embedding") is not None and len(node.get("embedding", [])) > 0]
    
    if len(valid_nodes) == 0:
        return {"message": "File uploaded but no valid embeddings generated", "paper_id": paper_id, "nodes_count": 0}
    
    
    # Save to database with pgvector
    nodes_to_insert = []
    for node in valid_nodes:
        nodes_to_insert.append({
            'id': node['id'],
            'project_id': project_id,
            'paper_id': node['paper_id'],
            'note_id': None,
            'type': node['type'],
            'content': node['content'],
            'page_number': node['page_number'],
            'bbox': str(node['bbox']),
            'paper_color': paper_color,
            'title': None,
            'embedding': node['embedding']
        })
    
    count = insert_nodes(nodes_to_insert)
    
    return {"message": "File uploaded and processed successfully", "paper_id": paper_id, "nodes_count": count}

@app.get("/projects/{project_id}/graph", response_model=GraphData)
def get_project_graph(project_id: int, use_new_embeddings: bool = False):
    # Fetch all nodes for the project
    db_nodes = get_nodes_by_project(project_id, include_embeddings=True)
    
    nodes = []
    node_ids = []
    if db_nodes:
        node_ids = [n['id'] for n in db_nodes]
        
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
        
        for db_node in db_nodes:
            # If it's an image, generate a presigned URL
            content = db_node["content"]
            if db_node["type"] == "image":
                content = storage_service.get_presigned_url(content)
            
            node = {
                "id": db_node["id"],
                "type": db_node["type"],
                "content": content,
                "page_number": db_node["page_number"],
                "paper_id": db_node["paper_id"],
                "paper_color": db_node.get("paper_color", "#3B82F6"),
                "bbox": eval(db_node["bbox"]) if db_node.get("bbox") else [],
                "embedding": db_node.get("embedding"),
                "has_tags": db_node["id"] in tagged_node_ids,
                "title": db_node.get("title"),
                "note_id": db_node.get("note_id")
            }
            
            # Include tag_scores if they exist
            if db_node.get("tag_scores"):
                import json
                tag_scores_dict = json.loads(db_node["tag_scores"])
                node["tag_scores"] = tag_scores_dict
                
                # If use_new_embeddings is true, use tag scores as embedding for PCA layout
                if use_new_embeddings:
                    # Convert tag_scores dict to a list of values (maintain consistent order)
                    tag_score_values = [tag_scores_dict[tag] for tag in sorted(tag_scores_dict.keys())]
                    if len(tag_score_values) > 0:
                        node["embedding"] = tag_score_values
            
            nodes.append(node)
            
    # Fetch all links for this project
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
            cursor.execute("SELECT project_id FROM nodes WHERE id = %s", (node_id,))
            node_row = cursor.fetchone()
            
            if not node_row:
                conn.close()
                raise HTTPException(status_code=404, detail="Node not found in any project")
            
            project_id = node_row['project_id']
        
        # Insert the tag assignment
        cursor.execute(
            "INSERT INTO node_tags (tag_id, node_id) VALUES (%s, %s)",
            (tag_id, node_id)
        )
        conn.commit()
        # conn.close()
        
        # # Train SVM and compute tag scores
        # try:
        #     train_result = tag_service.train_and_store_model(project_id, use_global_context=False)
        #     nodes_scored = tag_service.compute_tag_scores(project_id)
        #     print(f"SVM trained with {train_result['num_training_samples']} samples, {nodes_scored} nodes scored")
        # except ValueError as e:
        #     # If training fails (e.g., not enough samples), that's okay for the first tag assignment
        #     print(f"Warning: Could not train SVM: {e}")
        
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
        
    # Fetch the actual node content from database
    node_ids = [row['node_id'] for row in rows]
    
    try:
        db_nodes = get_nodes_by_ids(node_ids, include_embeddings=False)
        
        # Create a map for quick lookup
        nodes_map = {n['id']: n for n in db_nodes}
        
        # Merge data
        tagged_nodes = []
        for row in rows:
            nid = row['node_id']
            if nid in nodes_map:
                node_data = nodes_map[nid]
                
                # Only include if it belongs to the requested project
                if node_data.get('project_id') == project_id:
                    tagged_nodes.append({
                        "node_id": nid,
                        "content": node_data.get('content', ''),
                        "page_number": node_data.get('page_number'),
                        "paper_id": node_data.get('paper_id'),
                        "paper_color": node_data.get('paper_color'),
                        "bbox": eval(node_data.get('bbox', '[]')) if node_data.get('bbox') else [],
                        "tagged_at": row['tagged_at']
                    })
                    
        return tagged_nodes
        
    except Exception as e:
        print(f"Error fetching node details: {e}")
        return []

def _get_project_papers(project_id: int):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT id FROM papers WHERE project_id = %s", (project_id,))
    rows = cursor.fetchall()
    conn.close()

@app.post("/projects/{project_id}/discover")
def discover_papers(project_id: int):
    try:
        recommendations = discovery_service.discover_papers(project_id)
        return recommendations
    except Exception as e:
        print(f"Error discovering papers: {e}")
        raise HTTPException(status_code=500, detail=str(e))




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
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get all project IDs except the current one
    cursor.execute("SELECT id FROM projects WHERE id != %s", (exclude_project_id,))
    project_rows = cursor.fetchall()
    project_ids = [row["id"] for row in project_rows]
    
    all_external_nodes = []
    
    for project_id in project_ids:
        try:
            # Get all nodes from this project
            db_nodes = get_nodes_by_project(project_id, include_embeddings=True)
            
            if not db_nodes:
                continue
            
            # Get all node IDs for this project
            node_ids = [n['id'] for n in db_nodes]
            
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
            for db_node in db_nodes:
                node_id = db_node['id']
                if node_id in node_tags_map:  # Only include if has global tags
                    all_external_nodes.append({
                        "id": node_id,
                        "embedding": db_node.get('embedding'),
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
    
    # 3. Save to database as a node
    chroma_id = f"note_{new_note['id']}"
    
    node_to_insert = {
        'id': chroma_id,
        'project_id': project_id,
        'paper_id': None,
        'note_id': new_note['id'],
        'type': 'note',
        'content': note.content,
        'page_number': None,
        'bbox': '[]',
        'paper_color': note.color,
        'title': note.title or '',
        'embedding': embedding
    }
    
    insert_nodes([node_to_insert])
    
    # 4. Compute tag scores for the new note (if models exist)
    try:
        tag_service.compute_tag_scores(project_id, node_ids=[chroma_id])
    except Exception as e:
        # It's okay if this fails (e.g. no models trained yet)
        print(f"Could not compute tag scores for new note: {e}")
    
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
    
    # Update node in database if content or color changed
    if note_update.content is not None or note_update.color is not None or note_update.title is not None:
        try:
            chroma_id = f"note_{note_id}"
            
            updates = {}
            if note_update.color is not None:
                updates['paper_color'] = note_update.color
            if note_update.title is not None:
                updates['title'] = note_update.title
            if note_update.content is not None:
                updates['content'] = note_update.content
                # Update embedding if content changed
                new_embedding = embedding_service.generate_text_embedding(note_update.content)
                updates['embedding'] = new_embedding
            
            update_node_metadata(chroma_id, updates)
            
            # Compute tag scores for the updated note (if models exist)
            try:
                tag_service.compute_tag_scores(existing_note['project_id'], node_ids=[chroma_id])
            except Exception as e:
                print(f"Could not compute tag scores for updated note: {e}")

        except Exception as e:
            print(f"Error updating node for note: {e}")
            
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
    
    # Delete node from database (CASCADE will handle it via note_id FK)
    # But we need to explicitly delete it since we're deleting the note first
    try:
        chroma_id = f"note_{note_id}"
        conn_del = get_db_connection()
        cursor_del = conn_del.cursor()
        cursor_del.execute("DELETE FROM nodes WHERE id = %s", (chroma_id,))
        conn_del.commit()
        conn_del.close()
    except Exception as e:
        print(f"Error deleting node for note: {e}")
        
    return {"message": "Note deleted successfully"}

@app.get("/notes/{note_id}/similar", response_model=List[dict])
def get_similar_nodes(note_id: int, limit: int = 50, use_new_embeddings: bool = False):
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    
    # Get note content and project_id
    cursor.execute("SELECT content, project_id FROM notes WHERE id = %s", (note_id,))
    note = cursor.fetchone()
    conn.close()
    
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
        
    project_id = note['project_id']
    
    # Get the note's node from database
    chroma_note_id = f"note_{note_id}"
    note_nodes = get_nodes_by_ids([chroma_note_id], include_embeddings=True)
    
    if not note_nodes:
        raise HTTPException(status_code=404, detail="Note embedding not found")
    
    note_node = note_nodes[0]
    
    # Get query embedding based on mode
    if use_new_embeddings:
        # Try to get tag_scores from node
        tag_scores_str = note_node.get('tag_scores')
        
        if not tag_scores_str:
            raise HTTPException(
                status_code=400, 
                detail="New embeddings not computed. Please compute embeddings first in Advanced View."
            )
        
        try:
            import json
            tag_scores_dict = json.loads(tag_scores_str)
            # Convert to list maintaining consistent order
            query_embedding = [tag_scores_dict[tag] for tag in sorted(tag_scores_dict.keys())]
        except (json.JSONDecodeError, TypeError, KeyError) as e:
            raise HTTPException(status_code=500, detail=f"Failed to parse tag scores: {e}")
    else:
        # Use original embedding
        query_embedding = note_node.get('embedding')
        if query_embedding is None:
            raise HTTPException(status_code=404, detail="Note embedding not found")
    
    
    # NEW: Fetch connected nodes for context
    connected_nodes = []
    try:
        # Get links where note is source or target
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("""
            SELECT source_node_id, target_node_id
            FROM links 
            WHERE source_node_id = %s OR target_node_id = %s
        """, (chroma_note_id, chroma_note_id))
        link_rows = cursor.fetchall()
        
        # Extract connected node IDs (excluding the note itself)
        connected_ids = set()
        for row in link_rows:
            if row['source_node_id'] != chroma_note_id:
                connected_ids.add(row['source_node_id'])
            if row['target_node_id'] != chroma_note_id:
                connected_ids.add(row['target_node_id'])
        
        if connected_ids:
            # Fetch connected nodes with embeddings
            connected_nodes = get_nodes_by_ids(list(connected_ids), include_embeddings=True)
            print(f"Found {len(connected_nodes)} connected nodes for context")
            
    except Exception as e:
        print(f"Error fetching connected nodes: {e}")
        # Continue without context if fails
    
    # Prepare query embeddings list
    query_embeddings = []
    
    # Add note embedding (primary query)
    if use_new_embeddings:
        query_embeddings.append(query_embedding) # already processed above
    else:
        query_embeddings.append(query_embedding)
        
    # Add connected nodes embeddings
    for c_node in connected_nodes:
        if use_new_embeddings:
             # Try to get tag_scores from node
            tag_scores_str = c_node.get('tag_scores')
            if tag_scores_str:
                try:
                    import json
                    tag_scores_dict = json.loads(tag_scores_str)
                    # Convert to list maintaining consistent order
                    c_emb = [tag_scores_dict[tag] for tag in sorted(tag_scores_dict.keys())]
                    query_embeddings.append(c_emb)
                except Exception:
                    pass
        else:
            c_emb = c_node.get('embedding')
            if c_emb and len(c_emb) > 0:
                query_embeddings.append(c_emb)

    # Fetch all nodes from the project
    all_nodes = get_nodes_by_project(project_id, include_embeddings=True)
    
    if not all_nodes:
        return []

    # Fetch papers for title mapping
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute("SELECT id, title FROM papers WHERE project_id = %s", (project_id,))
    paper_map = {row['id']: row['title'] for row in cursor.fetchall()}
    conn.close()
    
    # Group nodes by paper
    nodes_by_paper = {}
    for db_node in all_nodes:
        paper_id = db_node.get('paper_id')
        if not paper_id:
            continue  # Skip nodes without paper (e.g., notes)
        
        if paper_id not in nodes_by_paper:
            nodes_by_paper[paper_id] = []
        
        # Build metadata dict from node fields
        metadata = {
            "type": db_node.get("type"),
            "content": db_node.get("content"),
            "page_number": db_node.get("page_number"),
            "paper_id": db_node.get("paper_id"),
            "paper_color": db_node.get("paper_color"),
            "bbox": db_node.get("bbox"),
            "title": db_node.get("title")
        }
        
        # Add tag_scores if using new embeddings
        if use_new_embeddings and db_node.get("tag_scores"):
            metadata["new_embedding"] = db_node.get("tag_scores")
        
        nodes_by_paper[paper_id].append({
            'id': db_node['id'],
            'embedding': db_node.get('embedding'),
            'metadata': metadata,
            'document': db_node.get('content', '')
        })
    
    print(f"Grouped nodes into {len(nodes_by_paper)} papers")
    
    # Per-paper similarity search
    all_paper_results = []
    papers_data_for_excerpts = []
    
    # Define how many top nodes to get per paper
    nodes_per_paper = max(5, limit // max(len(nodes_by_paper), 1))
    
    for paper_id, paper_nodes in nodes_by_paper.items():
        # Find similar nodes within this paper
        paper_results = similarity_service.find_similar_nodes(
            query_embeddings=query_embeddings,
            nodes=paper_nodes,
            limit=nodes_per_paper,
            use_new_embeddings=use_new_embeddings
        )
        
        if paper_results:
            all_paper_results.append((paper_id, paper_results))
            
            # Collect paper content for excerpt extraction
            sorted_nodes = sorted(
                [(r[2].get('page_number', 0), r[2].get('content', '')) for r in paper_results],
                key=lambda x: x[0]
            )
            full_content = ' '.join([content for _, content in sorted_nodes if content])
            paper_title = paper_map.get(paper_id, 'Untitled')
            
            if full_content.strip():
                papers_data_for_excerpts.append((paper_id, full_content, paper_title))
    
    print(f"Found results in {len(all_paper_results)} papers")
    
    # Construct query texts for reranking and excerpt extraction
    query_texts = []
    if note.get('content'):
        query_texts.append(note['content'])
        
    for c_node in connected_nodes:
        c_text = c_node.get('content')
        if c_text and isinstance(c_text, str) and len(c_text.strip()) > 0:
            query_texts.append(c_text)
    
    # Extract paper excerpts using LLM
    paper_excerpts = {}
    try:
        if query_texts and note.get('content') and papers_data_for_excerpts:
            # Limit to top 10 papers to avoid too many LLM calls
            top_papers = papers_data_for_excerpts[:10]
            paper_excerpts = similarity_service.extract_paper_excerpts(
                query_text=note['content'],
                papers_data=top_papers,
                num_excerpts=3,
                max_excerpt_length=500
            )
            print(f"Extracted excerpts for {len(paper_excerpts)} papers")
    
    except Exception as e:
        print(f"Excerpt extraction failed: {e}")
        import traceback
        traceback.print_exc()
    
    # Rerank results per paper using excerpts
    all_reranked_results = []
    
    for paper_id, paper_results in all_paper_results:
        try:
            if query_texts:
                # Get excerpts for this paper if available
                current_paper_excerpts = {paper_id: paper_excerpts[paper_id]} if paper_id in paper_excerpts else {}
                
                reranked = similarity_service.rerank_results(
                    query_texts=query_texts,
                    results=paper_results,
                    top_k=nodes_per_paper,
                    paper_excerpts=current_paper_excerpts
                )
                all_reranked_results.extend(reranked)
            else:
                all_reranked_results.extend(paper_results)
        except Exception as e:
            print(f"Reranking failed for paper {paper_id}: {e}")
            all_reranked_results.extend(paper_results)
    
    # Sort all results by score and limit
    all_reranked_results.sort(key=lambda x: x[1], reverse=True)
    similar_results = all_reranked_results[:limit + 1]
    
    # Build response
    similar_nodes = []
    for node_id, similarity, metadata in similar_results:
        # Skip the note itself
        if node_id == chroma_note_id:
            continue
        
        # Resolve paper title
        paper_title = None
        if metadata.get("paper_id") and metadata.get("paper_id") in paper_map:
            paper_title = paper_map[metadata.get("paper_id")]
        
        # Construct node object
        node = {
            "id": node_id,
            "type": metadata.get("type", "text"),
            "content": metadata.get("content", ""),
            "page_number": metadata.get("page_number"),
            "paper_id": metadata.get("paper_id"),
            "paper_title": paper_title,
            "paper_color": metadata.get("paper_color"),
            "bbox": eval(metadata.get("bbox", "[]")) if metadata.get("bbox") else [],
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
