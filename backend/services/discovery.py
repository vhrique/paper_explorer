from typing import List, Dict, Optional
import numpy as np
from sklearn.svm import SVC
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

        # 3. Fetch Embeddings for Project Papers (specter_v2)
        print(f"Fetching Specter2 embeddings for {len(paper_ids)} project papers...")
        project_embeddings_map = self.ss_service.get_embeddings(paper_ids)
        project_vectors = list(project_embeddings_map.values())
        print(f"Got {len(project_vectors)} embeddings for project papers")

        if not project_vectors:
            print("No embeddings found for project papers. Cannot train model.")
            return []

        # 4. Get Recommendations
        print(f"Requesting recommendations for {len(paper_ids)} papers...")
        # Get more recommendations to buffer filtering
        recommendations = self.ss_service.get_recommendations(paper_ids, limit=500)
        print(f"Received {len(recommendations)} recommendations")
        
        if not recommendations:
            return []

        # 5. Fetch Embeddings for Recommendations (specter_v2)
        rec_ids = [p['paperId'] for p in recommendations if p.get('paperId')]
        print(f"Fetching Specter2 embeddings for {len(rec_ids)} recommendations...")
        rec_embeddings_map = self.ss_service.get_embeddings(rec_ids)
        
        valid_candidates = []
        candidate_vectors = []
        
        for p in recommendations:
            pid = p.get('paperId')
            if pid and pid in rec_embeddings_map:
                valid_candidates.append(p)
                candidate_vectors.append(rec_embeddings_map[pid])
        
        print(f"Have {len(candidate_vectors)} valid candidates with embeddings")

        if not candidate_vectors:
            return []

        # 6. Train SVC on Project vs Recommendations
        print(f"Training SVC with {len(project_vectors)} positives and {len(candidate_vectors)} negatives...")
        
        # Prepare training data
        # Positive class: Project vectors (1)
        # Negative class: Candidate vectors (0) - we treat recommendations as "background" to find the most "positive-like" ones
        X_train = project_vectors + candidate_vectors
        y_train = [1] * len(project_vectors) + [0] * len(candidate_vectors)
        
        scores = []
        try:
            # Linear kernel is often good for high-dimensional text embeddings
            # balanced class weight handles the likely imbalance between #project papers and #recommendations
            clf = SVC(kernel='linear', class_weight='balanced', probability=True)
            clf.fit(X_train, y_train)
            
            # Score candidates
            # We want to identify which candidates are most similar to the positive class.
            # dense_output=True? decision_function returns signed distance to hyperplane.
            # Higher value = more likely to be class 1 (Positive)
            decision_scores = clf.predict_proba(candidate_vectors)
            # decision_scores = clf.decision_function(candidate_vectors)
            print(decision_scores.shape)
            scores = decision_scores[:,1].tolist()
            print("SVC scoring complete.")
        except Exception as e:
            print(f"Error training SVM: {e}. Fallback to original order.")
            # Fallback: fake scores (could be 0)
            scores = [0] * len(valid_candidates)

        # 7. Rank and Sort
        scored_candidates = []
        for i, paper in enumerate(valid_candidates):
            paper['match_score'] = scores[i]
            scored_candidates.append(paper)
        
        scored_candidates.sort(key=lambda x: x['match_score'], reverse=True)
        
        return scored_candidates[:10]
