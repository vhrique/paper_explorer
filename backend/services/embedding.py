from sentence_transformers import SentenceTransformer
from PIL import Image
import os
from typing import List, Union, Dict

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
        Enriches nodes with embeddings using batch processing.
        """
        text_nodes = []
        image_nodes = []
        texts = []
        images = []
        valid_image_nodes = []

        # 1. Separate nodes and collect content
        for node in nodes:
            if node["type"] == "text" or node["type"] == 'note':
                text_nodes.append(node)
                texts.append(node["content"])
            elif node["type"] == "image":
                full_path = os.path.join(base_path, node["content"])
                try:
                    image = Image.open(full_path)
                    images.append(image)
                    valid_image_nodes.append(node)
                except Exception as e:
                    print(f"Error loading image for embedding {full_path}: {e}")
                    node["embedding"] = [] # Assign empty embedding for failed images
        
        # 2. Batch process text embeddings
        if texts:
            print(f"Generating embeddings for {len(texts)} text nodes...")
            text_embeddings = self.model.encode(texts, batch_size=32)
            for node, embedding in zip(text_nodes, text_embeddings):
                node["embedding"] = embedding.tolist()
        
        # 3. Batch process image embeddings
        if images:
            print(f"Generating embeddings for {len(images)} image nodes...")
            try:
                image_embeddings = self.model.encode(images, batch_size=32)
                for node, embedding in zip(valid_image_nodes, image_embeddings):
                    node["embedding"] = embedding.tolist()
            except Exception as e:
                print(f"Error generating batch image embeddings: {e}")
                # Fallback to individual processing or leave empty? 
                # Ideally batch should work, but if it fails completely, we might want to log it.
                # For now, let's assume if loading worked, encoding should work or fail together.

        return nodes