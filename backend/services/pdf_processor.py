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
        for block in blocks:
            x0, y0, x1, y1, text, *_ = block
            text = text.strip()
            if len(text) < MIN_CHUNK_CHARS:
                continue
            chunks.append({
                "page": page_num,
                "text": text,
                "rects": [{"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}]
            })

    doc.close()
    return chunks


def extract_doi(pdf_bytes: bytes) -> str | None:
    """Attempt to extract a DOI from the first two pages of the PDF."""
    import re
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    doi_pattern = re.compile(r'\b10\.\d{4,}/\S+', re.IGNORECASE)

    for page_num in range(min(2, len(doc))):
        text = doc[page_num].get_text()
        match = doi_pattern.search(text)
        if match:
            doc.close()
            return match.group(0).rstrip('.')

    doc.close()
    return None
