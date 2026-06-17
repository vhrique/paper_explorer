"""
PDF processing: extract text chunks with bounding boxes per page.
Each chunk corresponds to a text block as identified by PyMuPDF.
"""

import fitz  # PyMuPDF
from typing import List, Dict, Any


MIN_CHUNK_CHARS = 40  # skip very short blocks (headers, page numbers, etc.)


def extract_chunks(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Extract text chunks from a PDF.
    Returns list of {page, text, rects} dicts.
    rects format: [{x, y, width, height}] in PDF coordinate space.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    chunks = []

    for page_num, page in enumerate(doc):
        blocks = page.get_text("blocks", sort=True)  # (x0, y0, x1, y1, text, block_no, block_type)
        pw = page.rect.width or 1
        ph = page.rect.height or 1
        for block in blocks:
            x0, y0, x1, y1, text, *_ = block
            text = text.strip()
            if len(text) < MIN_CHUNK_CHARS:
                continue
            chunks.append({
                "page": page_num,
                "text": text,
                "rects": [{
                    "x": x0 / pw,
                    "y": y0 / ph,
                    "width": (x1 - x0) / pw,
                    "height": (y1 - y0) / ph,
                }]
            })

    doc.close()
    return chunks


_BAD_TITLE_WORDS = {"microsoft", "word", "latex", "adobe", "untitled", "document"}


def extract_title_from_pdf(pdf_bytes: bytes) -> str | None:
    """
    Extract paper title from PDF.
    Tries PDF metadata first, then falls back to the block with the largest
    average font size on the first page.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # Try embedded metadata
    meta_title = (doc.metadata.get("title") or "").strip()
    if meta_title and 5 < len(meta_title) < 500:
        lower = meta_title.lower()
        if not any(w in lower for w in _BAD_TITLE_WORDS):
            doc.close()
            return meta_title

    # Heuristic: block with largest average font size on page 0
    if len(doc) > 0:
        page = doc[0]
        best_text: str | None = None
        best_size = 0.0
        for block in page.get_text("dict")["blocks"]:
            if block.get("type") != 0:
                continue
            spans = [s for line in block.get("lines", []) for s in line.get("spans", [])]
            if not spans:
                continue
            avg_size = sum(s.get("size", 0) for s in spans) / len(spans)
            text = " ".join(s.get("text", "").strip() for s in spans).strip()
            if avg_size > best_size and 5 < len(text) < 300:
                best_size = avg_size
                best_text = text
        if best_text:
            doc.close()
            return best_text

    doc.close()
    return None


def extract_doi(pdf_bytes: bytes) -> str | None:
    """Attempt to extract a DOI from the first page of the PDF only."""
    import re
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    doi_pattern = re.compile(r'\b10\.\d{4,}/\S+', re.IGNORECASE)

    if len(doc) > 0:
        text = doc[0].get_text()
        match = doi_pattern.search(text)
        if match:
            doc.close()
            return match.group(0).rstrip('.')

    doc.close()
    return None


def extract_arxiv_id(pdf_bytes: bytes) -> str | None:
    """
    Extract an arXiv identifier from the first page of the PDF.
    Returns the bare ID without version suffix (e.g. '2301.07041'), or None.
    Handles both new-style (YYMM.NNNNN) and old-style (cat/NNNNNNN) IDs.
    """
    import re
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # Matches 'arXiv:2301.07041v2', 'arxiv.org/abs/2301.07041', etc.
    pattern = re.compile(
        r'(?:arXiv:|arxiv\.org/abs/)'
        r'(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)',
        re.IGNORECASE
    )

    if len(doc) > 0:
        text = doc[0].get_text()
        match = pattern.search(text)
        if match:
            doc.close()
            arxiv_id = match.group(1)
            # Strip version suffix so lookups always get latest metadata
            arxiv_id = re.sub(r'v\d+$', '', arxiv_id)
            return arxiv_id

    doc.close()
    return None
