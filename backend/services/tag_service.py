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
        Train two separate SVM models (global and local tags) and store them in S3.
        
        Args:
            project_id: The project to train the model for
            use_global_context: If True, include nodes with global tags from other projects
            
        Returns:
            Dictionary with training statistics
        """
        # Get training data for both global and local tags
        global_data = self._get_training_data(project_id, use_global_context, tag_type='global')
        local_data = self._get_training_data(project_id, use_global_context, tag_type='local')
        
        X_train_global, Y_train_global, global_tag_names = global_data
        X_train_local, Y_train_local, local_tag_names = local_data
        
        # Check if we have enough data
        has_global = len(X_train_global) > 0 and len(X_train_global) > len(global_tag_names)
        has_local = len(X_train_local) > 0 and len(X_train_local) > len(local_tag_names)
        
        if not has_global and not has_local:
            raise ValueError("No tagged nodes found. Please assign tags to nodes before training.")
        
        # Train global model if we have global tags
        global_model_data = None
        if has_global:
            print(f"Training Global SVM with {len(X_train_global)} samples and {len(global_tag_names)} tags.")
            
            mlb_global = MultiLabelBinarizer()
            mlb_global.fit([global_tag_names])
            
            clf_global = OneVsRestClassifier(
                SVC(kernel="rbf", class_weight="balanced", probability=True, random_state=42)
            )
            clf_global.fit(X_train_global, Y_train_global)
            
            global_model_data = {
                'clf': clf_global,
                'mlb': mlb_global,
                'tag_names': global_tag_names
            }
        else:
            print("No global tags found, skipping global model training.")
        
        # Train local model if we have local tags
        local_model_data = None
        if has_local:
            print(f"Training Local SVM with {len(X_train_local)} samples and {len(local_tag_names)} tags.")
            
            mlb_local = MultiLabelBinarizer()
            mlb_local.fit([local_tag_names])
            
            clf_local = OneVsRestClassifier(
                SVC(kernel="rbf", class_weight="balanced", probability=True, random_state=42)
            )
            clf_local.fit(X_train_local, Y_train_local)
            
            local_model_data = {
                'clf': clf_local,
                'mlb': mlb_local,
                'tag_names': local_tag_names
            }
        else:
            print("No local tags found, skipping local model training.")
        
        # Save models to S3
        model_paths = self._save_models_to_storage(project_id, global_model_data, local_model_data)
        
        # Save metadata to database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Delete old model metadata for this project
        cursor.execute("DELETE FROM svm_models WHERE project_id = %s", (project_id,))
        
        # Prepare combined tag list
        all_tags = global_tag_names + local_tag_names
        total_samples = len(X_train_global) + len(X_train_local)
        
        # Insert new metadata
        cursor.execute("""
            INSERT INTO svm_models 
            (project_id, use_global_context, num_training_samples, num_tags, tags_list, model_path)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            project_id,
            use_global_context,
            total_samples,
            len(all_tags),
            json.dumps(all_tags),
            json.dumps(model_paths)  # Store both paths as JSON
        ))
        
        conn.commit()
        conn.close()
        
        return {
            'num_training_samples': total_samples,
            'num_global_samples': len(X_train_global),
            'num_local_samples': len(X_train_local),
            'num_tags': len(all_tags),
            'num_global_tags': len(global_tag_names),
            'num_local_tags': len(local_tag_names),
            'model_paths': model_paths
        }
    
    def load_model(self, project_id: int) -> Optional[Dict]:
        """
        Load both SVM models (global and local) for a project from S3.
        
        Args:
            project_id: The project to load the models for
            
        Returns:
            Dictionary with 'global_model' and 'local_model', each containing 'clf', 'mlb', and 'tag_names'
            Returns None if no models exist
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
        
        model_paths = row['model_path']
        
        # Handle both old format (string) and new format (JSON with global/local paths)
        if isinstance(model_paths, str):
            try:
                model_paths = json.loads(model_paths)
            except json.JSONDecodeError:
                # Old format - single model path
                # Load as global model for backward compatibility
                old_model = self._load_model_from_storage(model_paths)
                return {'global_model': old_model, 'local_model': None}
        
        return self._load_models_from_storage(model_paths)
    
    def compute_tag_scores(self, project_id: int, node_ids: Optional[List[str]] = None) -> int:
        """
        Compute SVM decision function scores for nodes using both global and local models.
        
        Args:
            project_id: The project to compute scores for
            node_ids: Optional list of specific node IDs to score. If None, scores all nodes.
            
        Returns:
            Number of nodes scored
        """
        # Load the models
        models = self.load_model(project_id)
        if not models:
            raise ValueError("No trained model found for this project. Please train a model first.")
        
        global_model = models.get('global_model')
        local_model = models.get('local_model')
        
        if not global_model and not local_model:
            raise ValueError("No valid models found.")
        
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
        
        # Prepare updates for nodes
        nodes_to_update = []
        for i, node in enumerate([n for n in result if n.get('embedding') is not None]):
            # Create tag_scores dictionary by combining both models
            tag_scores = {}
            
            # Add global tag scores
            if global_model:
                clf_global = global_model['clf']
                tag_names_global = global_model['tag_names']
                decision_scores_global = clf_global.decision_function(embeddings[i:i+1])  # Single node
                
                for j, tag_name in enumerate(tag_names_global):
                    tag_scores[tag_name] = float(decision_scores_global[0][j])
            
            # Add local tag scores
            if local_model:
                clf_local = local_model['clf']
                tag_names_local = local_model['tag_names']
                decision_scores_local = clf_local.decision_function(embeddings[i:i+1])  # Single node
                
                for j, tag_name in enumerate(tag_names_local):
                    tag_scores[tag_name] = float(decision_scores_local[0][j])
            
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
    
    def _get_training_data(self, project_id: int, use_global_context: bool, tag_type: str = 'all') -> Tuple[np.ndarray, np.ndarray, List[str]]:
        """
        Collect training data from tagged nodes.
        
        Args:
            project_id: The project to get training data for
            use_global_context: If True, include nodes with global tags from other projects
            tag_type: 'global', 'local', or 'all' - which type of tags to collect
            
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
                        # Filter tags based on tag_type
                        filtered_tags = tags
                        if tag_type == 'global':
                            filtered_tags = [t for t in tags if t["tag_type"] == 'global']
                        elif tag_type == 'local':
                            filtered_tags = [t for t in tags if t["tag_type"] == 'local']
                        
                        # Skip if no tags of the desired type
                        if not filtered_tags:
                            continue
                        
                        X_train.append(embedding)
                        tag_names_for_node = [t["tag_name"] for t in filtered_tags]
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
    
    def _save_models_to_storage(self, project_id: int, global_model_data: Optional[Dict], local_model_data: Optional[Dict]) -> Dict[str, str]:
        """
        Pickle and save both global and local models to S3 storage.
        
        Args:
            project_id: The project ID
            global_model_data: Dictionary with global model data (or None)
            local_model_data: Dictionary with local model data (or None)
            
        Returns:
            Dictionary with 'global' and 'local' S3 object keys
        """
        paths = {}
        
        if global_model_data:
            # Serialize the global model
            model_bytes = pickle.dumps(global_model_data)
            model_file = io.BytesIO(model_bytes)
            
            # Upload to S3
            model_path = f"models/project_{project_id}/svm_model_global.pkl"
            self.storage_service.upload_file(model_file, model_path, content_type="application/octet-stream")
            paths['global'] = model_path
            print(f"Global model saved to S3 at {model_path}")
        
        if local_model_data:
            # Serialize the local model
            model_bytes = pickle.dumps(local_model_data)
            model_file = io.BytesIO(model_bytes)
            
            # Upload to S3
            model_path = f"models/project_{project_id}/svm_model_local.pkl"
            self.storage_service.upload_file(model_file, model_path, content_type="application/octet-stream")
            paths['local'] = model_path
            print(f"Local model saved to S3 at {model_path}")
        
        return paths
    
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
    
    def _load_models_from_storage(self, model_paths: Dict[str, str]) -> Dict:
        """
        Load and unpickle both global and local models from S3 storage.
        
        Args:
            model_paths: Dictionary with 'global' and 'local' S3 object keys
            
        Returns:
            Dictionary with 'global_model' and 'local_model', each containing model data
        """
        result = {'global_model': None, 'local_model': None}
        
        # Load global model if it exists
        if 'global' in model_paths:
            try:
                result['global_model'] = self._load_model_from_storage(model_paths['global'])
            except Exception as e:
                print(f"Error loading global model: {e}")
        
        # Load local model if it exists
        if 'local' in model_paths:
            try:
                result['local_model'] = self._load_model_from_storage(model_paths['local'])
            except Exception as e:
                print(f"Error loading local model: {e}")
        
        return result
