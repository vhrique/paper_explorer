from typing import List, Dict, Optional, Any
import numpy as np
from sklearn.svm import SVC
from database import get_nodes_by_project, get_db_connection
from services.semantic_scholar import SemanticScholarService
from services.embedding import EmbeddingService
import psycopg2.extras

from services.graph import GraphService

class DiscoveryService:
    def __init__(self, semantic_scholar_service: SemanticScholarService, embedding_service: EmbeddingService, graph_service: GraphService):
        self.ss_service = semantic_scholar_service
        self.embedding_service = embedding_service
        self.graph_service = graph_service

    def get_discovery_context(self, project_id: int) -> Dict[str, Any]:
        """
        Build a context graph for the project including papers, references, and citations.
        Fetches embeddings for ALL nodes to provide a semantic layout.
        """
        print(f"Building context graph for project {project_id}")
        
        # 1. Fetch Project Papers
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute("SELECT id, title, doi, color, filename FROM papers WHERE project_id = %s", (project_id,))
        project_papers = cursor.fetchall()
        
        if not project_papers:
            conn.close()
            return {"nodes": [], "edges": []}

        project_paper_ids_map = {p['id']: p for p in project_papers}
        # We need S2 IDs for project papers. resolve DOIs.
        project_dois = [p['doi'] for p in project_papers if p['doi']]
        
        # 2. Fetch References and Citations from DB
        # Get all references (outgoing)
        cursor.execute("""
            SELECT pr.paper_id, pr.referenced_doi, pr.referenced_title 
            FROM paper_references pr
            JOIN papers p ON pr.paper_id = p.id
            WHERE p.project_id = %s AND pr.referenced_doi IS NOT NULL
        """, (project_id,))
        db_references = cursor.fetchall()
        
        # Get all citations (incoming)
        cursor.execute("""
            SELECT pc.paper_id, pc.citing_paper_id, pc.citing_doi, pc.citing_title
            FROM paper_citations pc
            JOIN papers p ON pc.paper_id = p.id
            WHERE p.project_id = %s
        """, (project_id,))
        db_citations = cursor.fetchall()
        conn.close()
        
        # 3. Resolve IDs and Collect DOIs
        papers_to_fetch = set()
        
        # Project papers (need to resolve DOIs to S2 IDs)
        papers_to_fetch.update(project_dois)
        
        # References (DOIs)
        for r in db_references:
            if r['referenced_doi']:
                papers_to_fetch.add(r['referenced_doi'])
                
        # Citations (S2 ID or DOI)
        for c in db_citations:
            if c['citing_paper_id']:
                papers_to_fetch.add(c['citing_paper_id'])
            elif c['citing_doi']:
                papers_to_fetch.add(c['citing_doi'])

        # Prepare list of IDs for S2 (S2 IDs and DOIs prefixed)
        final_ids_to_fetch = list(papers_to_fetch)
                 
        if not final_ids_to_fetch:
            print("No external papers to fetch.")
            return {"nodes": [], "edges": []} # Should at least return project papers if we can't find others?

        # 4. Fetch Details & Embeddings
        print(f"Fetching details/embeddings for {len(final_ids_to_fetch)} papers/DOIs...")
        s2_data = self.ss_service.get_papers(final_ids_to_fetch)
        
        # Map S2 ID (and DOI) to data
        # We need to robustly map back. The result objects have 'paperId' and 'externalIds.DOI'
        paper_lookup = {}
        for p in s2_data:
            if p.get('paperId'):
                paper_lookup[p['paperId']] = p
            if p.get('externalIds') and p.get('externalIds').get('DOI'):
                doi = p['externalIds']['DOI'].lower()
                paper_lookup[doi] = p

        # 5. Build Graph Nodes & Edges
        graph_nodes = []
        graph_edges = []
        added_node_ids = set()
        
        def add_node(s2_paper, role, project_paper_color=None, db_id=None):
            if not s2_paper: return
            pid = s2_paper['paperId']
            if pid in added_node_ids: return pid
            
            node = {
                "id": pid,
                "type": role, # 'project', 'reference', 'citation'
                "title": s2_paper.get('title', 'Untitled'),
                "abstract": s2_paper.get('abstract'),
                "year": s2_paper.get('year'),
                "authors": [a['name'] for a in s2_paper.get('authors', [])],
                "url": s2_paper.get('url'),
                "paper_color": project_paper_color or ("#22c55e" if role == 'reference' else "#f97316"), # Green/Orange
                "embedding": s2_paper.get('embedding'),
                "db_id": db_id 
            }
            if role == 'project':
                node['paper_color'] = "#3b82f6" # Force blue for project papers
            
            graph_nodes.append(node)
            added_node_ids.add(pid)
            return pid

        # Add Project Papers
        # We iterate our DB papers and find their S2 data
        project_s2_ids = {} # db_id -> s2_id
        
        for pp in project_papers:
            s2_p = None
            if pp['doi']:
                s2_p = paper_lookup.get(pp['doi'].lower())
            
            # If we couldn't resolve via DOI, we might be out of luck for embeddings unless we search by title (too slow)
            # But let's proceed with what we have.
            if s2_p:
                pid = add_node(s2_p, 'project', project_paper_color=pp.get('color'), db_id=pp['id'])
                if pid:
                    project_s2_ids[pp['id']] = pid
            else:
                print(f"Warning: Could not resolve S2 ID for project paper {pp['id']} ({pp['doi']})")
        
        # Add References
        for ref in db_references:
            source_db_id = ref['paper_id']
            if source_db_id not in project_s2_ids: continue
            
            source_s2_id = project_s2_ids[source_db_id]
            
            target_s2_p = None
            if ref['referenced_doi']:
                target_s2_p = paper_lookup.get(ref['referenced_doi'].lower())
            
            if target_s2_p:
                target_pid = add_node(target_s2_p, 'reference')
                if target_pid:
                    graph_edges.append({
                        "source": source_s2_id,
                        "target": target_pid,
                        "type": "reference",
                        "weight": 1
                    })

        # Add Citations
        for cit in db_citations:
            target_db_id = cit['paper_id']
            if target_db_id not in project_s2_ids: continue
            
            target_s2_id = project_s2_ids[target_db_id]
            
            source_s2_p = None
            if cit['citing_paper_id']:
                 source_s2_p = paper_lookup.get(cit['citing_paper_id'])
            elif cit['citing_doi']:
                 source_s2_p = paper_lookup.get(cit['citing_doi'].lower())
            
            if source_s2_p:
                source_pid = add_node(source_s2_p, 'citation')
                if source_pid:
                    # Citation: Source -> Project Paper
                    graph_edges.append({
                        "source": source_pid,
                        "target": target_s2_id,
                        "type": "citation",
                        "weight": 1
                    })

        print(f"Constructed context nodes: {len(graph_nodes)}, edges: {len(graph_edges)}")
        
        # 6. Apply Layout
        return self.graph_service.build_citation_graph(graph_nodes, graph_edges)

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
            # We still want to check references/citations even if no recommendations
            recommendations = []

        # 5. Load Project References & Citations from DB
        print("Fetching references and citations from database...")
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        # Get all references (outgoing) for project papers
        cursor.execute("""
            SELECT pr.referenced_doi, pr.referenced_title 
            FROM paper_references pr
            JOIN papers p ON pr.paper_id = p.id
            WHERE p.project_id = %s AND pr.referenced_doi IS NOT NULL
        """, (project_id,))
        db_references = cursor.fetchall()
        
        # Get all citations (incoming) for project papers
        cursor.execute("""
            SELECT pc.citing_paper_id, pc.citing_doi, pc.citing_title
            FROM paper_citations pc
            JOIN papers p ON pc.paper_id = p.id
            WHERE p.project_id = %s
        """, (project_id,))
        db_citations = cursor.fetchall()
        
        conn.close()
        
        print(f"Found {len(db_references)} references and {len(db_citations)} citations in DB")
        
        # 6. Consolidate Candidates
        candidate_ids = set()
        
        # Add Recommendations
        for p in recommendations:
            if p.get('paperId'):
                candidate_ids.add(p['paperId'])
                
        # Add Citations (we prefer paperId if available)
        citation_dois = []
        for c in db_citations:
            if c['citing_paper_id']:
                candidate_ids.add(c['citing_paper_id'])
            elif c['citing_doi']:
                citation_dois.append(c['citing_doi'])
                
        # Add References (mostly DOIs)
        reference_dois = [r['referenced_doi'] for r in db_references if r['referenced_doi']]
        
        # Resolve any DOIs (from refs or citations that lacked paperId)
        dois_to_resolve = list(set(citation_dois + reference_dois))
        if dois_to_resolve:
            print(f"Resolving {len(dois_to_resolve)} DOIs for refs/citations...")
            resolved_ids = self.ss_service.resolve_dois(dois_to_resolve)
            candidate_ids.update(resolved_ids)
            
        # Exclude papers already in the project
        project_ids_set = set(paper_ids)
        candidate_ids.difference_update(project_ids_set) # Remove existing
        
        if not candidate_ids:
            print("No candidates found after filtering.")
            return []

        print(f"Fetching details for {len(candidate_ids)} candidates...")
        # Fetch details + embeddings for ALL candidates in batch
        # Convert set to list
        all_candidates_data = self.ss_service.get_papers(list(candidate_ids))
        
        valid_candidates = []
        candidate_vectors = []
        
        for p in all_candidates_data:
            # Must have embedding to be ranked
            if p.get('embedding'):
                valid_candidates.append(p)
                candidate_vectors.append(p['embedding'])
        
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
