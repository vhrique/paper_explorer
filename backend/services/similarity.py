import numpy as np
from typing import List, Tuple, Dict, Optional
import json


class SimilarityService:
    """
    Service for computing similarity between nodes based on embeddings.
    Supports both original and tag-based (new) embeddings.
    """
    
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        """
        Initialize the similarity service with a cross-encoder for re-ranking.
        """
        try:
            from sentence_transformers import CrossEncoder
            self.cross_encoder = CrossEncoder(model_name)
            print(f"SimilarityService initialized with CrossEncoder: {model_name}")
        except Exception as e:
            print(f"Failed to initialize CrossEncoder: {e}")
            self.cross_encoder = None

    def find_similar_nodes(
        self,
        query_embeddings: List[List[float]],
        nodes: List[Dict],
        limit: int = 20,
        use_new_embeddings: bool = False
    ) -> List[Tuple[str, float, Dict]]:
        """
        Find the most similar nodes to a set of query embeddings using cosine similarity.
        Uses Max Similarity: score for a node is the max similarity to ANY of the query vectors.
        
        Args:
            query_embeddings: List of embedding vectors to compare against (OR logic)
            nodes: List of node dictionaries with 'id', 'embedding', and 'metadata'
            limit: Maximum number of results to return
            use_new_embeddings: If True, use 'new_embedding' from metadata; otherwise use 'embedding'
            
        Returns:
            List of tuples: (node_id, similarity_score, metadata)
            Sorted by similarity score in descending order
        """
        if not query_embeddings or len(query_embeddings) == 0:
            return []
            
        # Validate query vectors
        query_vectors = []
        for q in query_embeddings:
            if q is not None and len(q) > 0:
                v = np.array(q, dtype=float)
                norm = np.linalg.norm(v)
                if norm > 0:
                    query_vectors.append((v, norm))
                    
        if not query_vectors:
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
            
            # Calculate max similarity against all query vectors
            max_sim = -1.0
            
            for q_vec, q_norm in query_vectors:
                # Cosine similarity = dot product / (norm1 * norm2)
                sim = np.dot(q_vec, node_vector) / (q_norm * node_norm)
                if sim > max_sim:
                    max_sim = sim
            
            similarities.append((node_id, float(max_sim), metadata))
        
        # Sort by similarity (descending) and return top results
        similarities.sort(key=lambda x: x[1], reverse=True)
        
        return similarities[:limit]
    
    def rerank_results(
        self,
        query_texts: List[str],
        results: List[Tuple[str, float, Dict]],
        top_k: int = 20
    ) -> List[Tuple[str, float, Dict]]:
        """
        Re-rank similarity results using a cross-encoder model for improved accuracy.
        Uses Max Score aggregation: score is the max cross-encoder score against ANY query text.
        
        Args:
            query_texts: List of query text strings (e.g. [note_content, connected_node_1_content...])
            results: Initial similarity results
            top_k: Number of top results to return after re-ranking
            
        Returns:
            Re-ranked list of (node_id, score, metadata) tuples
        """
        if self.cross_encoder is None:
            print("CrossEncoder not initialized, skipping reranking")
            return results[:top_k]
            
        if not results:
            return []
            
        # Clean query texts
        queries = [q for q in query_texts if q and isinstance(q, str) and len(q.strip()) > 0]
        
        if not queries:
            return results[:top_k]
            
        # Prepare pairs for cross-encoder
        # We need to score each result against EACH query text
        # To batch efficiently, we can create all pairs at once or loop per query
        
        # Let's loop per result to keep track easily, but batching is better for performance.
        # However, cross_encoder.predict() takes a list of pairs.
        
        # Strategy: Create all (query, doc) pairs
        all_pairs = []
        result_map = [] # To map pair index back to (result_index, query_index)
        
        valid_indices = [] # Indices of results that have content to rerank
        
        for i, (node_id, score, metadata) in enumerate(results):
            text_content = metadata.get('content', '') or metadata.get('description', '') or metadata.get('title', '')
            
            if not text_content:
                continue
            
            valid_indices.append(i)
            
            for q_idx, query in enumerate(queries):
                all_pairs.append([query, text_content])
                result_map.append(i)
                
        if not all_pairs:
            return results[:top_k]
            
        try:
            # Predict scores for all pairs
            cross_scores = self.cross_encoder.predict(all_pairs)
            
            # Aggregate scores by result
            # We want max score for each result across all queries
            result_max_scores = {} # result_index -> max_score
            
            for idx, score in zip(result_map, cross_scores):
                if idx not in result_max_scores:
                    result_max_scores[idx] = float("-inf")
                
                if score > result_max_scores[idx]:
                    result_max_scores[idx] = float(score)
            
            # Combine aggregated scores with results
            reranked_results = []
            for i in valid_indices:
                if i in result_max_scores:
                    original_result = results[i]
                    max_score = result_max_scores[i]
                    reranked_results.append((original_result[0], max_score, original_result[2]))
            
            # Sort by new score (descending)
            reranked_results.sort(key=lambda x: x[1], reverse=True)
            
            # Log top 3 changes for debugging/verification
            if reranked_results:
                print(f"Reranking complete. Top 3 scores: {[r[1] for r in reranked_results[:3]]}")
            
            return reranked_results[:top_k]
            
        except Exception as e:
            print(f"Error during reranking: {e}")
            return results[:top_k]
            
        except Exception as e:
            print(f"Error during reranking: {e}")
            return results[:top_k]
