import io
import torch
import torch.nn as nn
import torch.optim as optim
from typing import List, Dict, Any, Optional
from services.storage import get_storage

class SimilarityProjectionModel(nn.Module):
    def __init__(self, dim: int = 1024):
        super().__init__()
        self.query_proj = nn.Linear(dim, dim, bias=False)
        self.key_proj = nn.Linear(dim, dim, bias=False)
        # Initialize as Identity matrices
        nn.init.eye_(self.query_proj.weight)
        nn.init.eye_(self.key_proj.weight)

    def forward(self, query: torch.Tensor, key: torch.Tensor) -> torch.Tensor:
        # Project query and key embeddings
        q_proj = self.query_proj(query)
        k_proj = self.key_proj(key)
        # Normalize vectors to unit length
        q_norm = q_proj / (q_proj.norm(dim=-1, keepdim=True) + 1e-8)
        k_norm = k_proj / (k_proj.norm(dim=-1, keepdim=True) + 1e-8)
        # Cosine similarity
        return (q_norm * k_norm).sum(dim=-1)

def train_similarity_model(
    project_id: int, 
    passages: List[Dict[str, Any]], 
    links: List[Dict[str, Any]], 
    chunks: Optional[List[Dict[str, Any]]] = None,
    epochs: int = 50, 
    lr: float = 0.001
) -> bool:
    try:
        # 1. Parse and extract embeddings, detecting dimension size dynamically
        import json
        id_to_emb = {}
        detected_dim = None
        
        for p in passages:
            emb_raw = p.get("embedding")
            if not emb_raw:
                continue
            if isinstance(emb_raw, str):
                try:
                    emb = json.loads(emb_raw)
                except Exception:
                    continue
            else:
                emb = emb_raw
                
            if isinstance(emb, list) and len(emb) > 0:
                if detected_dim is None:
                    detected_dim = len(emb)
                if len(emb) == detected_dim:
                    id_to_emb[p["id"]] = torch.tensor(emb, dtype=torch.float32)

        # Parse chunk embeddings (automatic passages)
        chunk_embs = []
        if chunks:
            for c in chunks:
                emb_raw = c.get("embedding")
                if not emb_raw:
                    continue
                if isinstance(emb_raw, str):
                    try:
                        emb = json.loads(emb_raw)
                    except Exception:
                        continue
                else:
                    emb = emb_raw
                    
                if isinstance(emb, list) and len(emb) > 0:
                    if detected_dim is None:
                        detected_dim = len(emb)
                    if len(emb) == detected_dim:
                        chunk_embs.append(torch.tensor(emb, dtype=torch.float32))

        if not id_to_emb or detected_dim is None:
            print(f"No valid embeddings found for project {project_id}")
            return False

        # 2. Extract valid links
        valid_links = []
        for l in links:
            p1, p2 = l["passage_id_1"], l["passage_id_2"]
            if p1 in id_to_emb and p2 in id_to_emb:
                valid_links.append((p1, p2))

        if not valid_links:
            # Delete any existing model if no links are present, so we fall back to standard cosine similarity
            try:
                storage = get_storage()
                storage.delete(f"models/project_{project_id}/similarity_projection.pt")
            except Exception:
                pass
            return True

        # Initialize model with detected embedding dimension
        model = SimilarityProjectionModel(dim=detected_dim)

        # 3. Build Positive Pairs (bidirectional)
        pos_queries = []
        pos_keys = []
        for p1, p2 in valid_links:
            pos_queries.append(id_to_emb[p1])
            pos_keys.append(id_to_emb[p2])
            # Bidirectional query/key pair
            pos_queries.append(id_to_emb[p2])
            pos_keys.append(id_to_emb[p1])
        
        pos_q = torch.stack(pos_queries)
        pos_k = torch.stack(pos_keys)

        # 4. Build Negative Pairs
        neg_queries = []
        neg_keys = []

        # 4a. Highlight-to-Highlight Negatives (all non-linked pairs in the project)
        linked_set = set()
        for p1, p2 in valid_links:
            linked_set.add((min(p1, p2), max(p1, p2)))

        passage_ids = list(id_to_emb.keys())
        for i in range(len(passage_ids)):
            for j in range(i + 1, len(passage_ids)):
                p1, p2 = passage_ids[i], passage_ids[j]
                if (min(p1, p2), max(p1, p2)) not in linked_set:
                    neg_queries.append(id_to_emb[p1])
                    neg_keys.append(id_to_emb[p2])
                    # Bidirectional
                    neg_queries.append(id_to_emb[p2])
                    neg_keys.append(id_to_emb[p1])

        # 4b. Highlight-to-Chunk Negatives (manually linked highlights paired with background chunks)
        linked_passages_ids = set()
        for p1, p2 in valid_links:
            linked_passages_ids.add(p1)
            linked_passages_ids.add(p2)

        for p_id in linked_passages_ids:
            p_emb = id_to_emb[p_id]
            for c_emb in chunk_embs:
                neg_queries.append(p_emb)
                neg_keys.append(c_emb)
                # Bidirectional
                neg_queries.append(c_emb)
                neg_keys.append(p_emb)

        # Sample negative pairs if they exceed a threshold to keep training fast
        import random
        max_negatives = max(1000, len(valid_links) * 20)
        max_negatives = min(max_negatives, 20000)
        
        if len(neg_queries) > max_negatives:
            indices = random.sample(range(len(neg_queries)), max_negatives)
            neg_queries = [neg_queries[idx] for idx in indices]
            neg_keys = [neg_keys[idx] for idx in indices]

        neg_q = torch.stack(neg_queries) if neg_queries else None
        neg_k = torch.stack(neg_keys) if neg_keys else None

        # 5. Optimization Loop
        optimizer = optim.Adam(model.parameters(), lr=lr)

        for epoch in range(epochs):
            model.train()
            optimizer.zero_grad()

            # Positive pairs Loss (cosine similarity -> 1.0)
            pos_sim = model(pos_q, pos_k)
            pos_loss = ((1.0 - pos_sim) ** 2).mean()

            # Negative pairs Loss (cosine similarity -> 0.0 with 0.2 margin)
            if neg_q is not None and neg_k is not None:
                neg_sim = model(neg_q, neg_k)
                neg_loss = torch.clamp(neg_sim - 0.2, min=0.0).pow(2).mean()
            else:
                neg_loss = 0.0

            loss = pos_loss + neg_loss
            loss.backward()
            optimizer.step()

        save_model(project_id, model)
        return True
    except Exception as e:
        print(f"Error training similarity model for project {project_id}: {e}")
        return False

def save_model(project_id: int, model: SimilarityProjectionModel):
    buffer = io.BytesIO()
    torch.save(model.state_dict(), buffer)
    buffer.seek(0)
    storage = get_storage()
    storage.upload(buffer, f"models/project_{project_id}/similarity_projection.pt")

def load_similarity_model(project_id: int) -> Optional[SimilarityProjectionModel]:
    try:
        storage = get_storage()
        data = storage.download(f"models/project_{project_id}/similarity_projection.pt")
        buffer = io.BytesIO(data)
        state_dict = torch.load(buffer, map_location=torch.device('cpu'), weights_only=True)
        
        # Infer dimension size from the saved model's weights
        if 'query_proj.weight' in state_dict:
            dim = state_dict['query_proj.weight'].shape[1]
        else:
            # Fallback
            dim = 1024
            
        model = SimilarityProjectionModel(dim=dim)
        model.load_state_dict(state_dict)
        model.eval()
        return model
    except Exception:
        # Silently fail (falls back to regular cosine similarity)
        return None
