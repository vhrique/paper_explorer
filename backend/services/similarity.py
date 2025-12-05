import numpy as np
from typing import List, Tuple, Dict, Optional
import json


class SimilarityService:
    """
    Service for computing similarity between nodes based on embeddings.
    Supports both original and tag-based (new) embeddings.
    """

    def find_similar_nodes(
        self,
        query_embedding: List[float],
        nodes: List[Dict],
        limit: int = 20,
        use_new_embeddings: bool = False
    ) -> List[Tuple[str, float, Dict]]:
        """
        Find the most similar nodes to a query embedding using cosine similarity.
        
        Args:
            query_embedding: The embedding vector to compare against
            nodes: List of node dictionaries with 'id', 'embedding', and 'metadata'
            limit: Maximum number of results to return
            use_new_embeddings: If True, use 'new_embedding' from metadata; otherwise use 'embedding'
            
        Returns:
            List of tuples: (node_id, similarity_score, metadata)
            Sorted by similarity score in descending order
        """
        if query_embedding is None or len(query_embedding) == 0:
            return []
        
        query_vector = np.array(query_embedding, dtype=float)
        query_norm = np.linalg.norm(query_vector)
        
        if query_norm == 0:
            return []
        
        similarities = []
        
        for node in nodes:
            node_id = node.get('id')
            metadata = node.get('metadata', {})
            
            # Get the appropriate embedding
            if use_new_embeddings:
                # New embeddings are stored as JSON strings in metadata
                new_emb_str = metadata.get('new_embedding')
                if not new_emb_str:
                    continue  # Skip nodes without new embeddings
                try:
                    tag_scores_dict = json.loads(new_emb_str)
                    embedding = [tag_scores_dict[tag] for tag in sorted(tag_scores_dict.keys())]
                except (json.JSONDecodeError, TypeError):
                    continue
            else:
                # Use original embedding
                embedding = node.get('embedding')
                if embedding is None or len(embedding) == 0:
                    continue
            
            # Compute cosine similarity
            node_vector = np.array(embedding, dtype=float)
            node_norm = np.linalg.norm(node_vector)
            
            if node_norm == 0:
                continue
            
            # Cosine similarity = dot product / (norm1 * norm2)
            similarity = np.dot(query_vector, node_vector) / (query_norm * node_norm)
            
            similarities.append((node_id, float(similarity), metadata))
        
        # Sort by similarity (descending) and return top results
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        return similarities[:limit]
    
    def rerank_results(
        self,
        query_text: str,
        results: List[Tuple[str, float, Dict]],
        top_k: int = 20
    ) -> List[Tuple[str, float, Dict]]:
        """
        Re-rank similarity results using a cross-encoder model for improved accuracy.
        
        This is a placeholder for future implementation.
        To implement:
        1. Import a cross-encoder model from sentence-transformers
        2. Score each (query, document) pair
        3. Re-sort results by cross-encoder scores
        
        Args:
            query_text: The original query text
            results: Initial similarity results
            top_k: Number of top results to return after re-ranking
            
        Returns:
            Re-ranked list of (node_id, score, metadata) tuples
        """
        # TODO: Implement cross-encoder re-ranking
        # For now, just return the original results
        return results[:top_k]
