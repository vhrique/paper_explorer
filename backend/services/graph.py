from typing import List, Dict, Any
from sklearn.metrics.pairwise import cosine_similarity
# from sklearn.decomposition import KernelPCA
from openTSNE import TSNE
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

        # Convert to numpy array for PCA
        embeddings_array = np.array(embeddings)
        
        # Use PCA to project embeddings to 2D for positioning
        # This places semantically similar content close together
        if len(embeddings) >= 2:
            n_components = min(2, len(embeddings))
            # pca = KernelPCA(n_components=n_components, kernel='cosine')
            # positions_2d = pca.fit_transform(embeddings_array)
            tsne = TSNE(n_components=n_components).fit(embeddings_array)
            positions_2d = tsne.transform(embeddings_array)
            
            # Scale positions to reasonable graph coordinates (e.g., -2000 to 2000)
            # positions_2d = positions_2d * 1500  # Scale factor (PCA)
            # positions_2d = positions_2d * 15_000  # Scale factor (KernelPCA)
            positions_2d = positions_2d * 200  # Scale factor (TSNE)
            
            # print(f"PCA explained variance: {pca.explained_variance_ratio_}")
        else:
            positions_2d = np.array([[0, 0]] * len(embeddings))

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
        
        # Clean up nodes and add 2D positions
        graph_nodes = []
        for i, node in enumerate(nodes):
            n = node.copy()
            
            # Add 2D position if available
            if i in node_indices:
                embedding_idx = node_indices.index(i)
                n["position"] = {
                    "x": float(positions_2d[embedding_idx][0]),
                    "y": float(positions_2d[embedding_idx][1]) if positions_2d.shape[1] > 1 else 0
                }
            else:
                # No embedding, place at origin
                n["position"] = {"x": 0, "y": 0}
            
            # Remove embedding to save bandwidth
            if "embedding" in n:
                del n["embedding"]
            graph_nodes.append(n)

        print(f"Graph built: {len(graph_nodes)} nodes, {len(edges)} edges ({len([e for e in edges if e['type']=='sequence'])} sequential, {len([e for e in edges if e['type']=='similarity'])} similarity)")
        return {"nodes": graph_nodes, "edges": edges}
