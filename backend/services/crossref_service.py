
import requests
import re
from typing import Dict, Any, List

class CrossRefService:
    BASE_URL = "https://api.crossref.org/works"

    def __init__(self):
        self.session = requests.Session()
        # Good practice to identify script to CrossRef
        self.session.headers.update({
            "User-Agent": "PaperExplorer/1.0 (mailto:admin@example.com)" 
        })

    def fetch_metadata(self, doi: str) -> Dict[str, Any]:
        """
        Fetch metadata for a given DOI from CrossRef.
        Returns a dictionary containing:
        - title
        - abstract
        - references (list of dicts)
        """
        if not doi:
            return {}

        clean_doi = doi.strip()
        url = f"{self.BASE_URL}/{clean_doi}"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            data = response.json()
            message = data.get("message", {})

            # Extract Title
            title_list = message.get("title", [])
            title = title_list[0] if title_list else ""

            # Extract Abstract
            # CrossRef abstracts are often XML-escaped or contain JATS tags like <jats:p>
            raw_abstract = message.get("abstract", "")
            clean_abstract = self._clean_abstract(raw_abstract)

            # Extract References
            # CrossRef references usually come in 'reference' key as a list
            raw_references = message.get("reference", [])
            references = []
            for ref in raw_references:
                # We try to extract structured data. 
                # Keys often used: DOI, article-title, author, year
                ref_item = {
                    "doi": ref.get("DOI"),
                    "title": ref.get("article-title"),
                    "authors": ref.get("author"), # might be raw string or missing
                    "year": ref.get("year"),
                }
                # Filter out empty references if needed, but keeping partials is fine
                references.append(ref_item)

            return {
                "title": title,
                "abstract": clean_abstract,
                "references": references
            }

        except Exception as e:
            print(f"Error fetching CrossRef metadata for {doi}: {e}")
            return {}

    def _clean_abstract(self, abstract_text: str) -> str:
        if not abstract_text:
            return ""
        
        # Remove JATS/XML tags like <jats:p>, </jats:p>, <p>, </p>, <jats:title> etc.
        # Simple regex to remove likely tags
        clean_text = re.sub(r'<[^>]+>', '', abstract_text)
        
        # Unescape HTML entities if needed (standard requests .json() might handle basic ones, but XML entities might remain)
        # For now, just basic tag stripping
        return clean_text.strip()
