import requests
import time
from typing import List, Dict, Optional

class SemanticScholarService:
    BASE_URL = "https://api.semanticscholar.org"

    def __init__(self):
        self.session = requests.Session()

    def resolve_dois(self, dois: List[str]) -> List[str]:
        """
        Resolve DOIs to Semantic Scholar Paper IDs.
        """
        if not dois:
            return []

        # API expects "doi:10.1234/..." format
        formatted_ids = [f"doi:{doi}" if not doi.startswith("doi:") else doi for doi in dois]
        
        # Batch request
        url = f"{self.BASE_URL}/graph/v1/paper/batch"
        params = {"fields": "paperId"}
        
        try:
            response = self.session.post(url, json={"ids": formatted_ids}, params=params)
            response.raise_for_status()
            data = response.json()
            
            paper_ids = []
            for item in data:
                if item and 'paperId' in item:
                    paper_ids.append(item['paperId'])
            return paper_ids
        except requests.exceptions.RequestException as e:
            print(f"Error resolving DOIs: {e}")
            return []

    def get_recommendations(self, positive_paper_ids: List[str], limit: int = 20) -> List[Dict]:
        """
        Get recommendations based on a list of positive paper IDs.
        """
        if not positive_paper_ids:
            return []

        # We can use /recommendations/v1/papers/for-paper if we treat the "project" as a collection of papers
        # But that endpoint takes a SINGLE paper ID as source? 
        # Wait, the documentation says "Invoke recommendations for a paper".
        # There is no batch recommendation endpoint publicly documented as "for-collection".
        # However, "POST /recommendations/v1/papers" allows sending positivePaperIds
        
        url = f"{self.BASE_URL}/recommendations/v1/papers"
        
        payload = {
            "positivePaperIds": positive_paper_ids
        }
        
        params = {
            "limit": limit, 
            "fields": "title,abstract,authors,year,url,externalIds,paperId"
        }

        try:
            response = self.session.post(url, json=payload, params=params)
            response.raise_for_status()
            data = response.json()
            
            recommendations = data.get('recommendedPapers', [])
            return recommendations
        except requests.exceptions.RequestException as e:
            print(f"Error getting recommendations: {e}")
            # Fallback (maybe?): If batch fails, try getting recommendations for the most recent paper?
            # For now just return empty
    def get_embeddings(self, paper_ids: List[str]) -> Dict[str, List[float]]:
        """
        Get Specter2 embeddings for a list of paper IDs.
        Returns a dictionary mapping paperId to embedding vector.
        """
        if not paper_ids:
            return {}
            
        url = f"{self.BASE_URL}/graph/v1/paper/batch"
        params = {"fields": "embedding.specter_v2"}
        payload = {"ids": paper_ids}
        
        try:
            response = self.session.post(url, json=payload, params=params)
            response.raise_for_status()
            data = response.json()
            
            embeddings = {}
            for item in data:
                if item and 'paperId' in item:
                    # Structure: item['embedding']['specter_v2']['vector']
                    # Or None if not available
                    emb_data = item.get('embedding')
                    if emb_data and 'vector' in emb_data:
                        embeddings[item['paperId']] = emb_data['vector']
            
            return embeddings
        except requests.exceptions.RequestException as e:
            print(f"Error getting embeddings: {e}")
            return {}

