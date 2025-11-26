from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime

class ProjectBase(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectCreate(ProjectBase):
    pass

class Project(ProjectBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class PaperBase(BaseModel):
    title: str
    filename: str

class Paper(BaseModel):
    id: int
    project_id: int
    title: str
    filename: str
    color: str = "#3B82F6"  # Default blue color
    created_at: datetime

    class Config:
        from_attributes = True

class Node(BaseModel):
    id: str
    type: str  # "text" or "image"
    content: str  # text content or image path/base64
    page_number: int
    bbox: List[float]
    paper_id: int
    embedding_id: Optional[str] = None

class GraphData(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
