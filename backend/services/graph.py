from typing import List, Dict, Any
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

class GraphService:
    def build_graph(self, nodes: List[Dict[str, Any]], similarity_threshold: float = 0.85, max_similarity_edges: int = 50) -> Dict[str, Any]:
        if not nodes:
            return {"nodes": [], "edges": []}

        # Extract embeddings
        embeddings = [node["embedding"] for node in nodes if "embedding" in node and node["embedding"] is not None]
        node_indices = [i for i, node in enumerate(nodes) if "embedding" in node and node["embedding"] is not None]
        
        if not embeddings:
             return {"nodes": nodes, "edges": []}

        # Calculate similarity matrix
        sim_matrix = cosine_similarity(embeddings)
        
        edges = []
        
        # 1. Sequential Edges (Reading Order) - Keep ALL to maintain flow
        for i in range(len(nodes) - 1):
            edges.append({
                "source": nodes[i]["id"],
                "target": nodes[i+1]["id"],
                "type": "sequence",
                "weight": 0.1
            })

        # 2. Similarity Edges - Collect ALL above threshold, then keep only the strongest
        all_similarities = []
        for i in range(len(embeddings)):
            for j in range(i + 1, len(embeddings)):
                sim = sim_matrix[i][j]
                if sim > similarity_threshold:
                    all_similarities.append({
                        "i": i,
                        "j": j,
                        "similarity": sim
                    })
        
        # Sort by similarity (strongest first) and keep only top N
        all_similarities.sort(key=lambda x: x['similarity'], reverse=True)
        top_similarities = all_similarities[:max_similarity_edges]
        
        # Add the top similarity edges
        for sim_data in top_similarities:
            edges.append({
                "source": nodes[node_indices[sim_data['i']]]["id"],
                "target": nodes[node_indices[sim_data['j']]]["id"],
                "type": "similarity",
                "weight": float(sim_data['similarity'])
            })
        
        # Clean up nodes (remove embeddings to save bandwidth)
        graph_nodes = []
        for node in nodes:
            n = node.copy()
            if "embedding" in n:
                del n["embedding"]
            graph_nodes.append(n)

        return {"nodes": graph_nodes, "edges": edges}
