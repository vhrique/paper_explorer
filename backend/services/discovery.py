from typing import List, Dict, Optional
import numpy as np
from sklearn.svm import OneClassSVM
from database import get_nodes_by_project, get_db_connection
from services.semantic_scholar import SemanticScholarService
from services.embedding import EmbeddingService
import psycopg2.extras

class DiscoveryService:
    def __init__(self, semantic_scholar_service: SemanticScholarService, embedding_service: EmbeddingService):
        self.ss_service = semantic_scholar_service
        self.embedding_service = embedding_service

    def discover_papers(self, project_id: int) -> List[Dict]:
        """
        Discover and rank new papers for a project.
        """
        # 1. Fetch project papers to get DOIs
        print(f"Starting discovery for project {project_id}")
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT doi FROM papers WHERE project_id = %s AND doi IS NOT NULL", (project_id,))
        rows = cursor.fetchall()
        conn.close()
        
        dois = [row['doi'] for row in rows if row['doi']]
        print(f"Found {len(dois)} DOIs for project {project_id}")
        
        if not dois:
            print(f"No DOIs found for project {project_id}")
            return []

        # 2. Resolve DOIs to S2 IDs
        paper_ids = self.ss_service.resolve_dois(dois)
        if not paper_ids:
            print("Could not resolve any DOIs to S2 Paper IDs")
            return []

        # 3. Get Recommendations
        # Ask for more than 10 to allow for re-ranking
        print(f"Requesting recommendations for {len(paper_ids)} papers...")
        recommendations = self.ss_service.get_recommendations(paper_ids, limit=20)
        print(f"Received {len(recommendations)} recommendations")
        
        if not recommendations:
            return []

        # 4. Generate Embeddings for Recommendations
        # We process them to generate embeddings (Title + Abstract)
        print("Generating embeddings for recommendations...")
        candidate_embeddings = []
        valid_candidates = []

        for paper in recommendations:
            title = paper.get('title', '')
            abstract = paper.get('abstract', '')
            if not title:
                continue
            
            # Combine title and abstract
            text = f"{title}. {abstract}" if abstract else title
            embedding = self.embedding_service.generate_text_embedding(text)
            
            if embedding:
                candidate_embeddings.append(embedding)
                valid_candidates.append(paper)

        if not candidate_embeddings:
            return []

        # 5. Train One-Class SVM on Project Nodes
        # Fetch all text nodes from the project that have embeddings
        project_nodes = get_nodes_by_project(project_id, include_embeddings=True)
        
        # Filter for text nodes with valid embeddings
        X_train = []
        for node in project_nodes:
            embedding = node.get('embedding')
            if embedding is not None and len(embedding) > 0:
                 # Ideally we should mostly use "paper abstract" nodes or similar, 
                 # but our nodes are just chunks of the PDF. Using all of them is a good proxy for "content of interest".
                X_train.append(embedding)

        print(f"Training SVM with {len(X_train)} samples...")
        scores = []
        if len(X_train) > 0:
            try:
                # Nu is an upper bound on the fraction of training errors and a lower bound of the fraction of support vectors.
                # Default is 0.5. We might want it lower if we trust our data is consistent.
                # Gamma 'scale' uses 1 / (n_features * X.var())
                clf = OneClassSVM(kernel='rbf', gamma='scale', nu=0.1)
                clf.fit(X_train)
                
                # Score candidates
                # decision_function returns signed distance to the separating hyperplane.
                # Positive -> in-class (similar). Negative -> out-class (dissimilar).
                # Higher is better.
                decision_scores = clf.decision_function(candidate_embeddings)
                scores = decision_scores.tolist()
                print("SVM scoring complete.")
            except Exception as e:
                print(f"Error training SVM: {e}. Fallback to original order.")
                # Fallback: fake scores (could be 0)
                scores = [0] * len(valid_candidates)
        else:
            print("No training samples found. Skipping SVM.")
            # No training data, just return valid candidates in original order
            scores = [0] * len(valid_candidates)

        # 6. Rank and Sort
        scored_candidates = []
        for i, paper in enumerate(valid_candidates):
            paper['match_score'] = scores[i]
            scored_candidates.append(paper)
        
        # Sort by score descending
        scored_candidates.sort(key=lambda x: x['match_score'], reverse=True)
        
        # Return top 10
        return scored_candidates[:10]
