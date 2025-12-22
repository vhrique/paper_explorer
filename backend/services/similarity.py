import numpy as np
from typing import List, Tuple, Dict, Optional
import json


class SimilarityService:
    """
    Service for computing similarity between nodes based on embeddings.
    Supports both original and tag-based (new) embeddings.
    Includes LLM-based excerpt extraction for improved similarity search.
    """
    
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2", llm_service=None):
        """
        Initialize the similarity service with a cross-encoder for re-ranking.
        
        Args:
            model_name: Cross-encoder model name
            llm_service: Optional LLM service for excerpt extraction
        """
        try:
            # from sentence_transformers import CrossEncoder
            # self.cross_encoder = CrossEncoder(model_name)
            self.cross_encoder = None
            print(f"SimilarityService initialized with CrossEncoder: {model_name}")
        except Exception as e:
            print(f"Failed to initialize CrossEncoder: {e}")
            self.cross_encoder = None
        
        self.llm_service = llm_service
        self._excerpt_cache = {}  # Cache for extracted excerpts: (query_hash, paper_id) -> excerpt

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
    
    def extract_paper_excerpts(
        self,
        query_text: str,
        papers_data: List[Tuple[int, str, str]],  # (paper_id, full_content, title)
        num_excerpts: int = 3,
        max_excerpt_length: int = 500
    ) -> Dict[int, List[str]]:
        """
        Extract multiple relevant excerpts from papers using LLM based on query context.
        
        Args:
            query_text: The query context (e.g., note content)
            papers_data: List of (paper_id, full_content, title) tuples
            num_excerpts: Number of distinct excerpts to extract per paper
            max_excerpt_length: Maximum length of each excerpt
            
        Returns:
            Dictionary mapping paper_id to list of extracted excerpts
        """
        if not self.llm_service:
            print("LLM service not available, skipping excerpt extraction")
            return {}
        
        if not papers_data:
            return {}
        
        # Create a simple hash of query text for caching
        import hashlib
        query_hash = hashlib.md5(query_text.encode()).hexdigest()[:8]
        
        excerpts = {}
        
        for paper_id, full_content, paper_title in papers_data:
            # Check cache first
            cache_key = (query_hash, paper_id, num_excerpts)
            if cache_key in self._excerpt_cache:
                excerpts[paper_id] = self._excerpt_cache[cache_key]
                continue
            
            # Skip if content is too short
            if not full_content or len(full_content.strip()) < 50:
                excerpts[paper_id] = [full_content] if full_content else []
                continue
            
            # Truncate very long content to avoid token limits
            max_content_length = 4000  # Leave room for prompt
            truncated_content = full_content[:max_content_length]
            if len(full_content) > max_content_length:
                truncated_content += "... [truncated]"
            
            # Construct prompt for LLM
            system_message = """You are an expert at identifying relevant excerpts from academic papers. 
Your task is to extract multiple distinct relevant excerpts from a paper that relate to a given query.
Return ONLY the extracted excerpts, separated by '---', without any preamble, explanation, or metadata."""
            
            user_prompt = f"""Query Context:
{query_text}

Paper Title: {paper_title or 'Untitled'}

Paper Content:
{truncated_content}

Extract {num_excerpts} distinct relevant excerpts (each up to {max_excerpt_length} characters) from this paper that relate to the query context. Focus on:
- Key concepts and terminology from the query
- Relevant methodologies or approaches  
- Related findings or conclusions

Each excerpt should cover a different aspect or section of the paper. Separate each excerpt with '---' on a new line.

Return only the excerpts separated by '---'."""
            
            try:
                response = self.llm_service.simple_prompt(
                    prompt=user_prompt,
                    system_message=system_message
                )
                
                # Parse excerpts separated by ---
                raw_excerpts = [e.strip() for e in response.split('---') if e.strip()]
                
                # Truncate each excerpt if needed and take up to num_excerpts
                parsed_excerpts = []
                for excerpt in raw_excerpts[:num_excerpts]:
                    if len(excerpt) > max_excerpt_length:
                        excerpt = excerpt[:max_excerpt_length] + "..."
                    parsed_excerpts.append(excerpt)
                
                # Ensure we have at least one excerpt
                if not parsed_excerpts:
                    parsed_excerpts = [full_content[:max_excerpt_length]]
                
                excerpts[paper_id] = parsed_excerpts
                self._excerpt_cache[cache_key] = parsed_excerpts
                
                # Log the extracted excerpts with preview
                print(f"Extracted {len(parsed_excerpts)} excerpts for paper {paper_id} ('{paper_title}'):")
                for i, excerpt in enumerate(parsed_excerpts, 1):
                    preview = excerpt[:150] + "..." if len(excerpt) > 150 else excerpt
                    print(f"  Excerpt {i} ({len(excerpt)} chars): {preview}")
                
            except Exception as e:
                print(f"Failed to extract excerpts for paper {paper_id}: {e}")
                # Fallback to truncated original content
                excerpts[paper_id] = [full_content[:max_excerpt_length]]
        
        return excerpts
    
    def rerank_results(
        self,
        query_texts: List[str],
        results: List[Tuple[str, float, Dict]],
        top_k: int = 20,
        paper_excerpts: Optional[Dict[int, List[str]]] = None
    ) -> List[Tuple[str, float, Dict]]:
        """
        Re-rank similarity results using a cross-encoder model for improved accuracy.
        Uses Max Score aggregation: score is the max cross-encoder score against ANY query text.
        
        Args:
            query_texts: List of query text strings (e.g. [note_content, connected_node_1_content...])
            results: Initial similarity results
            top_k: Number of top results to return after re-ranking
            paper_excerpts: Optional dict mapping paper_id to list of extracted excerpts (takes precedence over node content)
            
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
            # Check if we have paper excerpts for this node's paper
            paper_id = metadata.get('paper_id')
            
            text_contents = []
            if paper_excerpts and paper_id and paper_id in paper_excerpts:
                # Use all excerpts from the paper
                excerpts_list = paper_excerpts[paper_id]
                if isinstance(excerpts_list, list):
                    text_contents = excerpts_list
                else:
                    text_contents = [excerpts_list]  # Handle legacy single excerpt
            else:
                # Use node's own content
                node_content = metadata.get('content', '') or metadata.get('description', '') or metadata.get('title', '')
                if node_content:
                    text_contents = [node_content]
            
            if not text_contents:
                continue
            
            valid_indices.append(i)
            
            # Create pairs for each query with each excerpt
            for q_idx, query in enumerate(queries):
                for text_content in text_contents:
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
