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
    min_similarity: float = 0.0
) -> List[Tuple[Any, float]]:
    """
    Returns (id, similarity) pairs sorted by similarity descending.
    Candidates without a valid embedding are skipped.
    """
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
