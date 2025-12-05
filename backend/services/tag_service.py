import pickle
import io
import json
import numpy as np
from typing import List, Dict, Optional, Tuple
from sklearn.preprocessing import MultiLabelBinarizer
from sklearn.svm import SVC
from sklearn.multiclass import OneVsRestClassifier
from datetime import datetime

from database import get_db_connection, get_nodes_by_project, get_nodes_by_ids, update_nodes_by_ids
from services.storage import S3StorageService
import psycopg2.extras


class TagService:
    """Service for training, storing, and using SVM models for tag suggestions"""
    
    def __init__(self, storage_service: S3StorageService):
        self.storage_service = storage_service
    
    def train_and_store_model(self, project_id: int, use_global_context: bool = False) -> Dict:
        """
        Train an SVM model on tagged nodes and store it in S3.
        
        Args:
            project_id: The project to train the model for
            use_global_context: If True, include nodes with global tags from other projects
            
        Returns:
            Dictionary with training statistics
        """
        # Get training data
        X_train, Y_train, tag_names = self._get_training_data(project_id, use_global_context)
        
        if len(X_train) == 0:
            raise ValueError("No tagged nodes found. Please assign tags to nodes before training.")
        elif len(X_train) <= len(tag_names):
            raise ValueError("Not enough tagged nodes found. Please assign more tags to nodes before training.")
        
        print(f"Training SVM with {len(X_train)} samples and {len(tag_names)} tags.")
        
        # Train the SVM model
        mlb = MultiLabelBinarizer()
        mlb.fit([tag_names])  # Fit on all possible tags
        
        clf = OneVsRestClassifier(
            SVC(kernel="rbf", class_weight="balanced", probability=True, random_state=42)
        )
        clf.fit(X_train, Y_train)
        
        # Save model to S3
        model_data = {
            'clf': clf,
            'mlb': mlb,
            'tag_names': tag_names
        }
        model_path = self._save_model_to_storage(project_id, model_data)
        
        # Save metadata to database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Delete old model metadata for this project
        cursor.execute("DELETE FROM svm_models WHERE project_id = %s", (project_id,))
        
        # Insert new metadata
        cursor.execute("""
            INSERT INTO svm_models 
            (project_id, use_global_context, num_training_samples, num_tags, tags_list, model_path)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            project_id,
            use_global_context,
            len(X_train),
            len(tag_names),
            json.dumps(tag_names),
            model_path
        ))
        
        conn.commit()
        conn.close()
        
        return {
            'num_training_samples': len(X_train),
            'num_tags': len(tag_names),
            'model_path': model_path
        }
    
    def load_model(self, project_id: int) -> Optional[Dict]:
        """
        Load the SVM model for a project from S3.
        
        Args:
            project_id: The project to load the model for
            
        Returns:
            Dictionary with 'clf', 'mlb', and 'tag_names', or None if no model exists
        """
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        cursor.execute(
            "SELECT model_path FROM svm_models WHERE project_id = %s ORDER BY trained_at DESC LIMIT 1",
            (project_id,)
        )
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        model_path = row['model_path']
        return self._load_model_from_storage(model_path)
    
    def compute_tag_scores(self, project_id: int, node_ids: Optional[List[str]] = None) -> int:
        """
        Compute SVM decision function scores for nodes and store in ChromaDB metadata.
        
        Args:
            project_id: The project to compute scores for
            node_ids: Optional list of specific node IDs to score. If None, scores all nodes.
            
        Returns:
            Number of nodes scored
        """
        # Load the model
        model_data = self.load_model(project_id)
        if not model_data:
            raise ValueError("No trained model found for this project. Please train a model first.")
        
        clf = model_data['clf']
        mlb = model_data['mlb']
        tag_names = model_data['tag_names']
        
        # Get nodes from database
        if node_ids:
            result = get_nodes_by_ids(node_ids, include_embeddings=True)
        else:
            result = get_nodes_by_project(project_id, include_embeddings=True)
        
        if not result:
            return 0
        
        # Compute decision function scores
        embeddings = np.array([n['embedding'] for n in result if n.get('embedding') is not None], dtype=float)
        
        if len(embeddings) == 0:
            return 0
        
        decision_scores = clf.decision_function(embeddings)  # Shape: (n_nodes, n_tags)
        
        # Prepare updates for nodes
        nodes_to_update = []
        for i, node in enumerate([n for n in result if n.get('embedding') is not None]):
            # Create tag_scores dictionary
            tag_scores = {}
            for j, tag_name in enumerate(tag_names):
                tag_scores[tag_name] = float(decision_scores[i][j])
            
            nodes_to_update.append((node['id'], json.dumps(tag_scores)))
        
        # Bulk update nodes
        if nodes_to_update:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            for node_id, tag_scores_json in nodes_to_update:
                cursor.execute("UPDATE nodes SET tag_scores = %s WHERE id = %s", (tag_scores_json, node_id))
            
            conn.commit()
            conn.close()
        
        print(f"Computed and stored tag scores for {len(nodes_to_update)} nodes.")
        return len(nodes_to_update)
    
    def _get_training_data(self, project_id: int, use_global_context: bool) -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """
        Collect training data from tagged nodes.
        
        Args:
            project_id: The project to get training data for
            use_global_context: If True, include nodes with global tags from other projects
            
        Returns:
            Tuple of (X_train, Y_train, tag_names)
        """
        X_train = []
        tag_list = []  # List of tag name lists for each sample
        all_tag_names = set()
        
        # Helper function to process nodes
        def process_nodes(nodes_list, node_tag_map):
            for node_id, tags in node_tag_map.items():
                # Find the node in the list
                node = next((n for n in nodes_list if n['id'] == node_id), None)
                if not node:
                    continue
                
                try:
                    embedding = node.get('embedding')
                    # Check if embedding is not None and has elements
                    if embedding is not None and len(embedding) > 0:
                        X_train.append(embedding)
                        tag_names_for_node = [t["tag_name"] for t in tags]
                        tag_list.append(tag_names_for_node)
                        all_tag_names.update(tag_names_for_node)
                except Exception as e:
                    print(f"Error processing node {node_id}: {e}")
                    continue
        
        # Get current project's tagged nodes
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        collection = get_nodes_by_project(project_id, include_embeddings=True)
        current_project_node_ids = [n['id'] for n in collection]
        
        if current_project_node_ids:
            cursor.execute("""
                SELECT nt.node_id, t.id as tag_id, t.name as tag_name, t.type as tag_type
                FROM node_tags nt
                JOIN tags t ON nt.tag_id = t.id
                WHERE nt.node_id = ANY(%s)
                ORDER BY nt.node_id, t.name
            """, (current_project_node_ids,))
            
            tag_rows = cursor.fetchall()
            
            # Build map of node_id -> tags
            node_tag_map = {}
            for row in tag_rows:
                node_id = row["node_id"]
                if node_id not in node_tag_map:
                    node_tag_map[node_id] = []
                node_tag_map[node_id].append({
                    "tag_id": row["tag_id"],
                    "tag_name": row["tag_name"],
                    "tag_type": row["tag_type"]
                })
            
            process_nodes(collection, node_tag_map)
        
        # Get external nodes with global tags if use_global_context is enabled
        if use_global_context:
            cursor.execute("SELECT id FROM projects WHERE id != %s", (project_id,))
            other_project_rows = cursor.fetchall()
            
            for proj_row in other_project_rows:
                other_project_id = proj_row["id"]
                try:
                    other_collection = get_nodes_by_project(other_project_id, include_embeddings=True)
                    other_node_ids = [n['id'] for n in other_collection]
                    
                    if not other_node_ids:
                        continue
                    
                    # Get only global tags for these nodes
                    cursor.execute("""
                        SELECT nt.node_id, t.id as tag_id, t.name as tag_name, t.type as tag_type
                        FROM node_tags nt
                        JOIN tags t ON nt.tag_id = t.id
                        WHERE nt.node_id = ANY(%s) AND t.type = 'global'
                        ORDER BY nt.node_id, t.name
                    """, (other_node_ids,))
                    
                    external_tag_rows = cursor.fetchall()
                    
                    external_node_tag_map = {}
                    for row in external_tag_rows:
                        node_id = row["node_id"]
                        if node_id not in external_node_tag_map:
                            external_node_tag_map[node_id] = []
                        external_node_tag_map[node_id].append({
                            "tag_id": row["tag_id"],
                            "tag_name": row["tag_name"],
                            "tag_type": row["tag_type"]
                        })
                    
                    process_nodes(other_collection, external_node_tag_map)
                    
                except Exception as e:
                    print(f"Error processing external project {other_project_id}: {e}")
                    continue
        
        conn.close()
        
        if len(X_train) == 0:
            return np.array([]), np.array([]), []
        
        # Convert to numpy arrays
        X_train = np.array(X_train, dtype=float)
        
        # Encode tags using MultiLabelBinarizer
        tag_names_list = sorted(list(all_tag_names))
        mlb = MultiLabelBinarizer()
        mlb.fit([tag_names_list])
        Y_train = mlb.transform(tag_list)
        
        return X_train, Y_train, tag_names_list
    
    def _save_model_to_storage(self, project_id: int, model_data: Dict) -> str:
        """
        Pickle and save model to S3 storage.
        
        Args:
            project_id: The project ID
            model_data: Dictionary with 'clf', 'mlb', and 'tag_names'
            
        Returns:
            The S3 object key where the model was saved
        """
        # Serialize the model
        model_bytes = pickle.dumps(model_data)
        model_file = io.BytesIO(model_bytes)
        
        # Upload to S3
        model_path = f"models/project_{project_id}/svm_model.pkl"
        self.storage_service.upload_file(model_file, model_path, content_type="application/octet-stream")
        
        print(f"Model saved to S3 at {model_path}")
        return model_path
    
    def _load_model_from_storage(self, model_path: str) -> Dict:
        """
        Load and unpickle model from S3 storage.
        
        Args:
            model_path: The S3 object key
            
        Returns:
            Dictionary with 'clf', 'mlb', and 'tag_names'
        """
        try:
            # Download from S3
            response = self.storage_service.s3_client.get_object(
                Bucket=self.storage_service.bucket_name,
                Key=model_path
            )
            model_bytes = response['Body'].read()
            
            # Deserialize
            model_data = pickle.loads(model_bytes)
            
            print(f"Model loaded from S3 at {model_path}")
            return model_data
            
        except Exception as e:
            print(f"Error loading model from S3: {e}")
            raise
