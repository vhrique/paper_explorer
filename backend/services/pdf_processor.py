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
                    text = ""
                    for line in block["lines"]:
                        for span in line["spans"]:
                            text += span["text"] + " "
                    
                    text = text.strip()
                    if len(text) > 50:  # Filter out short snippets/artifacts
                        nodes.append({
                            "id": str(uuid.uuid4()),
                            "type": "text",
                            "content": text,
                            "page_number": page_num + 1,
                            "bbox": block["bbox"],
                            "paper_id": paper_id
                        })

            # Extract Images - both regular and inline images
            image_list = page.get_images(full=True)
            extracted_xrefs = set()  # Track extracted images to avoid duplicates
            
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
