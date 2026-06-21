"""
Embedding service using any OpenAI-compatible API.
Works with LM Studio, Ollama, OpenAI, or any compatible provider.

Required env vars:
  EMBEDDING_BASE_URL  — e.g. http://localhost:1234/v1
  EMBEDDING_API_KEY   — any string for local providers
  EMBEDDING_MODEL     — e.g. text-embedding-3-small
"""

import os
from typing import List
from openai import OpenAI


class EmbeddingService:
    def __init__(self):
        base_url = os.getenv("EMBEDDING_BASE_URL", "http://localhost:1234/v1")
        api_key = os.getenv("EMBEDDING_API_KEY", "lm-studio")
        self.model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def embed(self, text: str) -> List[float]:
        text = text.replace("\n", " ").strip()
        response = self.client.embeddings.create(input=[text], model=self.model)
        return response.data[0].embedding

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        texts = [t.replace("\n", " ").strip() for t in texts]
        response = self.client.embeddings.create(input=texts, model=self.model)
        return [item.embedding for item in sorted(response.data, key=lambda x: x.index)]


_service: EmbeddingService | None = None

def get_embedding_service() -> EmbeddingService:
    global _service
    if _service is None:
        _service = EmbeddingService()
    return _service
