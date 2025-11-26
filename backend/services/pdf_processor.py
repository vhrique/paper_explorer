import fitz  # PyMuPDF
import os
import uuid
from typing import List, Dict, Any

class PDFProcessor:
    def __init__(self, upload_dir: str = "static/images"):
        self.upload_dir = upload_dir
        os.makedirs(self.upload_dir, exist_ok=True)

    def process_pdf(self, pdf_path: str, paper_id: int) -> List[Dict[str, Any]]:
        doc = fitz.open(pdf_path)
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

            # Extract Images
            image_list = page.get_images(full=True)
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                image_filename = f"{paper_id}_p{page_num+1}_{img_index}.{image_ext}"
                image_path = os.path.join(self.upload_dir, image_filename)
                
                with open(image_path, "wb") as f:
                    f.write(image_bytes)
                
                # Get image bbox (approximate, as get_images doesn't return bbox directly)
                # We can try to find the image on the page to get bbox
                rects = page.get_image_rects(xref)
                bbox = [0, 0, 0, 0]
                if rects:
                    bbox = list(rects[0])

                nodes.append({
                    "id": str(uuid.uuid4()),
                    "type": "image",
                    "content": image_filename, # Store relative path or filename
                    "page_number": page_num + 1,
                    "bbox": bbox,
                    "paper_id": paper_id
                })

        return nodes
