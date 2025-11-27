from sentence_transformers import SentenceTransformer
from PIL import Image
import os
from typing import List, Union, Dict
import numpy as np
from sklearn.preprocessing import MultiLabelBinarizer
from sklearn.svm import SVC
from sklearn.multiclass import OneVsRestClassifier

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

    def compute_new_embeddings(self, nodes: List[dict]) -> List[dict]:
        """
        Train a probabilistic SVM on nodes that have tags.
        Inputs: original embeddings
        Outputs: probability vector over tags (new_embedding)
        """

        # -----------------------------
        # 1. Collect training samples
        # -----------------------------
        X_train = []
        tag_list = []  # list of tag-name lists

        for node in nodes:
            emb = node.get("embedding")
            tags = node.get("tags", [])

            if emb is not None and len(emb) > 0 and len(tags) > 0:
                X_train.append(emb)
                # collect tag names
                tag_list.append([t["tag_name"] for t in tags])

        if len(X_train) == 0:
            raise ValueError("No nodes have tags; cannot train SVM.")

        X_train = np.array(X_train, dtype=float)

        # -----------------------------
        # 2. Encode tags (multi-label)
        # -----------------------------
        mlb = MultiLabelBinarizer()
        Y_train = mlb.fit_transform(tag_list)  # shape: (num_samples, num_tags)

        # -----------------------------
        # 3. Train probabilistic SVM
        # -----------------------------
        clf = OneVsRestClassifier(
            SVC(kernel="linear", probability=True)
        )
        clf.fit(X_train, Y_train)

        # -----------------------------
        # 4. Predict probabilities for ALL nodes
        # -----------------------------
        for node in nodes:
            emb = node.get("embedding")

            if emb is None or len(emb) == 0:
                node["new_embedding"] = None
                continue

            emb_np = np.array(emb, dtype=float).reshape(1, -1)

            # predict_proba returns shape (1, num_tags)
            probs = clf.predict_proba(emb_np)[0].tolist()
            node["new_embedding"] = probs

        return nodes