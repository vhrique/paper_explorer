from typing import List, Dict, Any
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import MinMaxScaler
# from sklearn.decomposition import PCA
# from sklearn.decomposition import KernelPCA
from openTSNE import TSNE
import numpy as np

class GraphService:
    def build_graph(self, nodes: List[Dict[str, Any]], links: List[Dict[str, Any]] = None, similarity_threshold: float = 0.85, max_similarity_edges: int = 50) -> Dict[str, Any]:
        if not nodes:
            return {"nodes": [], "edges": []}

        # Extract embeddings
        embeddings = [node["embedding"] for node in nodes if "embedding" in node and node["embedding"] is not None]
        node_indices = [i for i, node in enumerate(nodes) if "embedding" in node and node["embedding"] is not None]
        
        # Convert to numpy array for PCA
        embeddings_array = np.array(embeddings) if embeddings else np.empty((0, 0))
        
        # Use TSNE to project embeddings to 2D for positioning
        # This places semantically similar content close together
        if len(embeddings) >= 2:
            n_components = min(2, len(embeddings))
            perplexity = int(np.sqrt(len(embeddings)))
            perplexity = max(30, perplexity)
            tsne = TSNE(n_components=n_components, perplexity=perplexity, random_state=42, metric='cosine').fit(embeddings_array)
            positions_2d = tsne.transform(embeddings_array)
            
            # Scale positions to reasonable graph coordinates (e.g., -4000 to 4000)
            scaler = MinMaxScaler(feature_range=(-4000, 4000))
            positions_2d = scaler.fit_transform(positions_2d)
        else:
            positions_2d = np.array([[0, 0]] * len(embeddings))

        edges = []
        
        # 1. Sequential Edges (Reading Order) - Keep ALL to maintain flow
        for i in range(len(nodes) - 1):
            # Only link nodes from the same paper
            if nodes[i].get("paper_id") == nodes[i+1].get("paper_id") and nodes[i].get("paper_id") is not None:
                edges.append({
                    "source": nodes[i]["id"],
                    "target": nodes[i+1]["id"],
                    "type": "sequence",
                    "weight": 0.1
                })

        # 2. Manual Links
        if links:
            node_ids = set(n["id"] for n in nodes)
            for link in links:
                # Only add edge if both source and target are in the current graph nodes
                if link["source_node_id"] in node_ids and link["target_node_id"] in node_ids:
                    edges.append({
                        "source": link["source_node_id"],
                        "target": link["target_node_id"],
                        "type": "manual",
                        "weight": 1.0
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

        print(f"Graph built: {len(graph_nodes)} nodes, {len(edges)} edges ({len([e for e in edges if e['type']=='sequence'])} sequential, {len([e for e in edges if e['type']=='manual'])} manual)")
        return {"nodes": graph_nodes, "edges": edges}

    def build_citation_graph(self, nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Build a graph for citation context (Project Papers, References, Citations).
        Uses t-SNE to position ALL nodes in the same semantic space.
        """
        if not nodes:
            return {"nodes": [], "edges": []}

        # Extract embeddings
        embeddings = []
        node_indices = []
        
        for i, node in enumerate(nodes):
            if node.get("embedding") and len(node["embedding"]) > 0:
                embeddings.append(node["embedding"])
                node_indices.append(i)
        
        # Convert to numpy array
        embeddings_array = np.array(embeddings) if embeddings else np.empty((0, 0))
        
        # Use t-SNE for layout
        positions_2d = np.array([[0.0, 0.0]] * len(node_indices))
        
        if len(embeddings) >= 2:
            try:
                # Use fewer components/perplexity for small graphs
                n_samples = len(embeddings)
                perplexity = min(30, max(5, int(np.sqrt(n_samples))))
                
                # Use simple initialization if very few points
                init = 'random' # 'pca' is default but can fail on tiny datasets sometimes
                
                tsne = TSNE(
                    n_components=2, 
                    perplexity=perplexity, 
                    random_state=42, 
                    metric='cosine',
                    n_jobs=1,
                    initialization=init
                ).fit(embeddings_array)
                
                positions_2d = tsne.transform(embeddings_array)
                
                # Scale to reasonable view area
                scaler = MinMaxScaler(feature_range=(-2000, 2000))
                positions_2d = scaler.fit_transform(positions_2d)
            except Exception as e:
                print(f"t-SNE failed: {e}. Fallback to random positions.")
                positions_2d = np.random.rand(len(embeddings), 2) * 1000
        elif len(embeddings) == 1:
             positions_2d = np.array([[0.0, 0.0]])

        # Create output nodes with positions
        graph_nodes = []
        for i, node in enumerate(nodes):
            n = node.copy()
            
            # Position
            if i in node_indices:
                embedding_idx = node_indices.index(i)
                n["position"] = {
                    "x": float(positions_2d[embedding_idx][0]),
                    "y": float(positions_2d[embedding_idx][1])
                }
            else:
                # Fallback implementation if no embedding found
                # Place near connected node? Or random?
                # For now, 0,0
                n["position"] = {"x": 0.0, "y": 0.0}
            
            # Remove embedding to save bandwidth
            if "embedding" in n:
                del n["embedding"]
                
            graph_nodes.append(n)
            
        return {"nodes": graph_nodes, "edges": edges}
