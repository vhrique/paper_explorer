"""
Fetch paper metadata from external APIs.
Primary: Semantic Scholar. Fallback: OpenAlex.
"""

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


_HEADERS = {"User-Agent": "PaperExplorer/2.0 (mailto:contact@paper-explorer.dev)"}
_TIMEOUT = 10


def _http_get(url: str) -> Optional[dict]:
    try:
        req = urllib.request.Request(url, headers=_HEADERS)
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def _clean_doi(doi: str) -> str:
    doi = doi.strip()
    # Strip common trailing punctuation that regex capture might include
    while doi and doi[-1] in '.),;]':
        doi = doi[:-1]
    # Strip URL prefix if user pasted the full URL
    for prefix in ("https://doi.org/", "http://doi.org/", "doi.org/", "doi:"):
        if doi.lower().startswith(prefix):
            doi = doi[len(prefix):]
            break
    return doi


# ---------------------------------------------------------------------------
# Semantic Scholar
# ---------------------------------------------------------------------------

_SS_FIELDS = "title,abstract,authors,year,venue,externalIds"


def _fetch_semantic_scholar(doi: Optional[str], title: Optional[str], arxiv_id: Optional[str] = None) -> Optional[dict]:
    if doi:
        clean = _clean_doi(doi)
        data = _http_get(
            f"https://api.semanticscholar.org/graph/v1/paper/DOI:{clean}?fields={_SS_FIELDS}"
        )
        if data and data.get("title"):
            return _parse_ss(data)

    if arxiv_id:
        data = _http_get(
            f"https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}?fields={_SS_FIELDS}"
        )
        if data and data.get("title"):
            return _parse_ss(data)

    if title:
        encoded = urllib.parse.quote(title)
        data = _http_get(
            f"https://api.semanticscholar.org/graph/v1/paper/search?query={encoded}&fields={_SS_FIELDS}&limit=1"
        )
        if data and data.get("data"):
            return _parse_ss(data["data"][0])

    return None


def _parse_ss(data: dict) -> dict:
    return {
        "title": data.get("title"),
        "abstract": data.get("abstract"),
        "doi": (data.get("externalIds") or {}).get("DOI"),
        "year": data.get("year"),
        "venue": data.get("venue") or None,
        "authors": [a["name"] for a in (data.get("authors") or [])],
        "source": "semantic_scholar",
    }


# ---------------------------------------------------------------------------
# OpenAlex
# ---------------------------------------------------------------------------

_OA_FIELDS = "title,abstract_inverted_index,doi,publication_year,authorships,primary_location"


def _reconstruct_abstract(inverted: Optional[dict]) -> Optional[str]:
    if not inverted:
        return None
    max_pos = max(max(positions) for positions in inverted.values())
    words = [""] * (max_pos + 1)
    for word, positions in inverted.items():
        for pos in positions:
            words[pos] = word
    text = " ".join(w for w in words if w)
    return text or None


def _fetch_openalex(doi: Optional[str], title: Optional[str], arxiv_id: Optional[str] = None) -> Optional[dict]:
    if doi:
        clean = _clean_doi(doi)
        data = _http_get(
            f"https://api.openalex.org/works/doi:{clean}?select={_OA_FIELDS}"
        )
        if data and data.get("title"):
            return _parse_oa(data)

    if arxiv_id:
        # arXiv papers are registered with DOI 10.48550/arXiv.{id}
        arxiv_doi = f"10.48550/arXiv.{arxiv_id}"
        data = _http_get(
            f"https://api.openalex.org/works/doi:{arxiv_doi}?select={_OA_FIELDS}"
        )
        if data and data.get("title"):
            return _parse_oa(data)

    if title:
        encoded = urllib.parse.quote(title)
        data = _http_get(
            f"https://api.openalex.org/works?search={encoded}&per-page=1&select={_OA_FIELDS}"
        )
        if data and data.get("results"):
            return _parse_oa(data["results"][0])

    return None


def _parse_oa(data: dict) -> dict:
    raw_doi = data.get("doi") or ""
    if raw_doi.lower().startswith("https://doi.org/"):
        raw_doi = raw_doi[len("https://doi.org/"):]

    authors = [
        a["author"]["display_name"]
        for a in (data.get("authorships") or [])
        if (a.get("author") or {}).get("display_name")
    ]
    venue = None
    loc = data.get("primary_location") or {}
    src = loc.get("source") or {}
    venue = src.get("display_name")

    return {
        "title": data.get("title"),
        "abstract": _reconstruct_abstract(data.get("abstract_inverted_index")),
        "doi": raw_doi or None,
        "year": data.get("publication_year"),
        "venue": venue,
        "authors": authors,
        "source": "openalex",
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_paper_metadata(
    doi: Optional[str] = None,
    title: Optional[str] = None,
    arxiv_id: Optional[str] = None,
) -> Optional[dict]:
    """Try Semantic Scholar first, fall back to OpenAlex."""
    result = _fetch_semantic_scholar(doi=doi, title=title, arxiv_id=arxiv_id)
    if result:
        return result
    return _fetch_openalex(doi=doi, title=title, arxiv_id=arxiv_id)
