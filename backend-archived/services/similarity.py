import numpy as np
from typing import List, Tuple, Dict, Any


def cosine_similarity(a: List[float], b: List[float]) -> float:
    va, vb = np.array(a), np.array(b)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def find_similar(
    query_embedding: List[float],
    candidates: List[Dict[str, Any]],  # each must have 'embedding' (List[float]) and 'id'
    limit: int = 10,
    min_similarity: float = 0.0,
    model: Any = None
) -> List[Tuple[Any, float]]:
    """
    Returns (id, similarity) pairs sorted by similarity descending.
    Candidates without a valid embedding are skipped.
    """
    if model is not None:
        try:
            import torch
            q_tensor = torch.tensor(query_embedding, dtype=torch.float32).unsqueeze(0)
            
            valid_candidates = []
            candidate_embs = []
            for c in candidates:
                emb = c.get("embedding")
                if emb:
                    valid_candidates.append(c)
                    candidate_embs.append(emb)
            
            if not valid_candidates:
                return []
                
            k_tensor = torch.tensor(candidate_embs, dtype=torch.float32)
            
            with torch.no_grad():
                q_tensor_expanded = q_tensor.expand(k_tensor.shape[0], -1)
                similarities = model(q_tensor_expanded, k_tensor).tolist()
                
            scored = []
            for c, sim in zip(valid_candidates, similarities):
                if sim >= min_similarity:
                    scored.append((c["id"], sim))
            
            scored.sort(key=lambda x: x[1], reverse=True)
            return scored[:limit]
        except Exception as e:
            print(f"Error executing similarity model: {e}. Falling back...")

    q = np.array(query_embedding)
    qn = np.linalg.norm(q)
    if qn == 0:
        return []

    scored = []
    for c in candidates:
        emb = c.get("embedding")
        if not emb:
            continue
        v = np.array(emb)
        vn = np.linalg.norm(v)
        if vn == 0:
            continue
        sim = float(np.dot(q, v) / (qn * vn))
        if sim >= min_similarity:
            scored.append((c["id"], sim))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]
