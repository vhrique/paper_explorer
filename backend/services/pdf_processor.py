import fitz  # PyMuPDF
import os
import uuid
import io
from typing import List, Dict, Any
from .storage import S3StorageService

class PDFProcessor:
    def __init__(self, storage_service: S3StorageService):
        self.storage_service = storage_service

    def process_pdf(self, pdf_path: str, paper_id: int) -> List[Dict[str, Any]]:
        # If pdf_path is a local path (temp file), open it
        # If it's a bytes object, open it directly
        if isinstance(pdf_path, str):
            doc = fitz.open(pdf_path)
        else:
            # Assume it's a file-like object or bytes
            doc = fitz.open(stream=pdf_path, filetype="pdf")
        nodes = []

        for page_num, page in enumerate(doc):
            # Extract Text Blocks
            blocks = page.get_text("dict")["blocks"]
            for block in blocks:
                if block["type"] == 0:  # Text block
                    # Split block into paragraphs based on line spacing
                    paragraphs = self._split_block_into_paragraphs(block)
                    
                    for para_lines in paragraphs:
                        # Extract text from paragraph
                        text = ""
                        for line in para_lines:
                            for span in line["spans"]:
                                text += span["text"] + " "
                        
                        text = text.strip()
                        
                        if len(text) > 50:  # Filter out short snippets/artifacts
                            # Calculate bbox for this paragraph
                            bbox = self._calculate_paragraph_bbox(para_lines)
                            
                            nodes.append({
                                "id": str(uuid.uuid4()),
                                "type": "text",
                                "content": text,
                                "page_number": page_num + 1,
                                "bbox": bbox,
                                "paper_id": paper_id
                            })

            # Extract Images - both regular and inline images
            image_list = page.get_images(full=True)
            extracted_xrefs = set()  # Track extracted images to avoid duplicates
            
            image_list = [] # so to not process images for now (changing encoder)
            for img_index, img in enumerate(image_list):
                xref = img[0]
                
                # Skip if already extracted
                if xref in extracted_xrefs:
                    continue
                
                try:
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]
                    image_width = base_image.get("width", 0)
                    image_height = base_image.get("height", 0)
                    
                    # Skip very small images (likely artifacts, icons, or decorations)
                    if image_width < 20 or image_height < 20:
                        continue
                    
                    image_filename = f"images/{paper_id}_p{page_num+1}_{img_index}.{image_ext}"
                    
                    # Upload to S3
                    file_obj = io.BytesIO(image_bytes)
                    self.storage_service.upload_file(file_obj, image_filename, content_type=f"image/{image_ext}")
                    
                    extracted_xrefs.add(xref)
                    
                    # Get image bbox
                    rects = page.get_image_rects(xref)
                    bbox = [0, 0, 0, 0]
                    if rects:
                        bbox = list(rects[0])

                    nodes.append({
                        "id": str(uuid.uuid4()),
                        "type": "image",
                        "content": image_filename, # Store the S3 key
                        "page_number": page_num + 1,
                        "bbox": bbox,
                        "paper_id": paper_id
                    })
                    
                    print(f"Extracted image: {image_filename} ({image_width}x{image_height})")
                    
                except Exception as e:
                    print(f"Failed to extract image {xref} from page {page_num+1}: {str(e)}")
                    continue

        print(f"Processed PDF: {len([n for n in nodes if n['type'] == 'text'])} text blocks, {len([n for n in nodes if n['type'] == 'image'])} images")
        return nodes
    
    def _split_block_into_paragraphs(self, block, gap_factor=0.5, indent_threshold=8.0):
        """
        Split a block into paragraphs using both vertical spacing and indentation.

        Args:
            block: PyMuPDF text block dictionary
            gap_factor: fraction of line height that triggers paragraph via vertical gap
            indent_threshold: minimal left-indent increase (points) signifying a new paragraph

        Returns:
            List of paragraph line groups (each a list of PyMuPDF line dicts)
        """
        paragraphs = []
        current_para_lines = []

        prev_line_bottom = None
        prev_line_left = None

        for line in block["lines"]:
            bbox = line["bbox"]
            line_left = bbox[0]
            line_top = bbox[1]
            line_bottom = bbox[3]
            line_height = line_bottom - line_top

            new_para = False

            # --- 1. Vertical-gap paragraph detection ---
            if prev_line_bottom is not None:
                gap = line_top - prev_line_bottom
                if gap > line_height * gap_factor:
                    new_para = True

            # --- 2. Indentation-based paragraph detection ---
            # Detect if this line is indented further right than previous
            if prev_line_left is not None:
                indent = line_left - prev_line_left
                if indent > indent_threshold:
                    new_para = True

            # If new paragraph detected → commit current one
            if new_para and current_para_lines:
                paragraphs.append(current_para_lines)
                current_para_lines = []

            current_para_lines.append(line)
            prev_line_bottom = line_bottom
            prev_line_left = line_left

        # Add last collected paragraph
        if current_para_lines:
            paragraphs.append(current_para_lines)

        return paragraphs
    
    def _calculate_paragraph_bbox(self, lines):
        """
        Calculate bounding box from a list of lines.
        
        Args:
            lines: List of PyMuPDF line dictionaries, each with a "bbox" key
            
        Returns:
            List [x0, y0, x1, y1] representing the bounding box
        """
        if not lines:
            return [0, 0, 0, 0]
        
        # Get min/max coordinates from all lines
        x0 = min(line["bbox"][0] for line in lines)
        y0 = min(line["bbox"][1] for line in lines)
        x1 = max(line["bbox"][2] for line in lines)
        y1 = max(line["bbox"][3] for line in lines)
        
        return [x0, y0, x1, y1]
