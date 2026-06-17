"""
PDF processing: extract text chunks with bounding boxes per page.
Chunks are extracted at three granularity levels: block, paragraph, sentence.
"""

import re
import fitz  # PyMuPDF
from typing import List, Dict, Any, Optional, Tuple


MIN_CHUNK_CHARS = 40  # skip very short blocks (headers, page numbers, etc.)
MIN_PARA_CHARS = 30
MIN_SENT_CHARS = 20


def split_into_paragraphs(text: str) -> List[str]:
    """Split block text into paragraphs by blank lines."""
    parts = re.split(r'\n[ \t]*\n', text)
    return [p.strip() for p in parts if len(p.strip()) >= MIN_PARA_CHARS]


def split_into_sentences(text: str) -> List[str]:
    """Split paragraph text into sentences on punctuation boundaries."""
    text = re.sub(r'\s+', ' ', text)
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z\d("])', text)
    return [s.strip() for s in parts if len(s.strip()) >= MIN_SENT_CHARS]


def _build_word_sequence(
    words: List[Tuple],
) -> Tuple[str, List[Tuple[int, int, float, float, float, float]]]:
    """
    Build a normalized text string and per-word char offsets from a word list.
    words: list of (text, x0, y0, x1, y1)
    Returns (full_text, offsets) where offsets are (char_start, char_end, x0, y0, x1, y1).
    """
    full_text = ""
    offsets = []
    for word_text, x0, y0, x1, y1 in words:
        if full_text:
            full_text += " "
        start = len(full_text)
        full_text += word_text
        offsets.append((start, len(full_text), x0, y0, x1, y1))
    return full_text, offsets


def _find_rect_in_sequence(
    text: str,
    full_seq: str,
    offsets: List[Tuple[int, int, float, float, float, float]],
    pw: float,
    ph: float,
    start_pos: int = 0,
) -> Tuple[Optional[Dict], int]:
    """
    Find `text` in the word sequence starting at `start_pos`.
    Returns (rect_dict, end_pos) or (None, start_pos) if not found.
    """
    norm = re.sub(r'\s+', ' ', text).strip()
    idx = full_seq.find(norm, start_pos)
    if idx == -1:
        return None, start_pos

    t_end = idx + len(norm)
    matching = [
        (x0, y0, x1, y1)
        for ws, we, x0, y0, x1, y1 in offsets
        if ws < t_end and we > idx
    ]
    if not matching:
        return None, start_pos

    rx0 = min(o[0] for o in matching)
    ry0 = min(o[1] for o in matching)
    rx1 = max(o[2] for o in matching)
    ry1 = max(o[3] for o in matching)

    return {
        "x": rx0 / pw,
        "y": ry0 / ph,
        "width": (rx1 - rx0) / pw,
        "height": (ry1 - ry0) / ph,
    }, t_end


def extract_chunks(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Extract block-level text chunks (legacy, kept for compatibility).
    Returns list of {page, text, rects} dicts.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    chunks = []

    for page_num, page in enumerate(doc):
        blocks = page.get_text("blocks", sort=True)
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


def extract_chunks_hierarchical(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Extract text chunks at block, paragraph, and sentence granularity.
    Returns a list of block dicts, each with a 'paragraphs' list,
    each paragraph with a 'sentences' list.
    Each level carries its own accurate bounding rect derived from word positions.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    result_blocks = []

    for page_num, page in enumerate(doc):
        pw = page.rect.width or 1
        ph = page.rect.height or 1

        raw_blocks = page.get_text("blocks", sort=True)
        # words: (x0, y0, x1, y1, text, block_no, line_no, word_no)
        page_words = page.get_text("words", sort=True)

        for raw in raw_blocks:
            x0, y0, x1, y1, text, *_ = raw
            text = text.strip()
            if len(text) < MIN_CHUNK_CHARS:
                continue

            block_rect = {
                "x": x0 / pw,
                "y": y0 / ph,
                "width": (x1 - x0) / pw,
                "height": (y1 - y0) / ph,
            }

            # Words in this block, filtered by bbox overlap
            block_words = [
                (w[4], w[0], w[1], w[2], w[3])  # (text, x0, y0, x1, y1)
                for w in page_words
                if w[0] >= x0 - 2 and w[2] <= x1 + 2
                and w[1] >= y0 - 2 and w[3] <= y1 + 2
            ]

            block_seq, block_offsets = _build_word_sequence(block_words)

            para_texts = split_into_paragraphs(text) or [text]
            para_list = []
            para_search_pos = 0

            for para_text in para_texts:
                if len(para_text) < MIN_PARA_CHARS:
                    continue

                para_rect, para_end = _find_rect_in_sequence(
                    para_text, block_seq, block_offsets, pw, ph, para_search_pos
                )
                if para_rect is None:
                    para_rect = block_rect
                else:
                    para_search_pos = para_end

                # Narrow word list to paragraph y-range for sentence matching
                py0 = para_rect["y"] * ph - 2
                py1 = (para_rect["y"] + para_rect["height"]) * ph + 2
                para_word_list = [
                    w for w in block_words if py0 <= w[2] <= py1
                ] or block_words

                para_seq, para_offsets = _build_word_sequence(para_word_list)

                norm_para = re.sub(r'\s+', ' ', para_text).strip()
                sentences = split_into_sentences(norm_para)

                sent_list = []
                sent_search_pos = 0

                for sent_text in sentences:
                    if len(sent_text) < MIN_SENT_CHARS:
                        continue

                    sent_rect, sent_end = _find_rect_in_sequence(
                        sent_text, para_seq, para_offsets, pw, ph, sent_search_pos
                    )
                    if sent_rect is None:
                        sent_rect = para_rect
                    else:
                        sent_search_pos = sent_end

                    sent_list.append({"text": sent_text, "rects": [sent_rect]})

                para_list.append({
                    "text": para_text,
                    "rects": [para_rect],
                    "sentences": sent_list,
                })

            result_blocks.append({
                "page": page_num,
                "text": text,
                "rects": [block_rect],
                "paragraphs": para_list,
            })

    doc.close()
    return result_blocks


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
