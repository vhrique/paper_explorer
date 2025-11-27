from sentence_transformers import SentenceTransformer
from PIL import Image
import os
from typing import List, Union
import numpy as np

class EmbeddingService:
    # def __init__(self, model_name: str = "sentence-transformers/clip-ViT-B-32"):
    def __init__(self, model_name: str = "intfloat/e5-large-v2"): # Trying different embedding model
        self.model = SentenceTransformer(model_name)

    def generate_text_embedding(self, text: str) -> List[float]:
        embedding = self.model.encode(text)
        return embedding.tolist()

    def generate_image_embedding(self, image_path: str) -> List[float]:
        try:
            image = Image.open(image_path)
            embedding = self.model.encode(image)
            return embedding.tolist()
        except Exception as e:
            print(f"Error generating image embedding for {image_path}: {e}")
            return []

    def generate_embeddings(self, nodes: List[dict], base_path: str = "static/images") -> List[dict]:
        """
        Enriches nodes with embeddings.
        """
        for node in nodes:
            if node["type"] == "text":
                node["embedding"] = self.generate_text_embedding(node["content"])
            elif node["type"] == "image":
                full_path = os.path.join(base_path, node["content"])
                node["embedding"] = self.generate_image_embedding(full_path)
        
        return nodes
