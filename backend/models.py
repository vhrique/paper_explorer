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
    url: Optional[str] = None
    color: str = "#3B82F6"  # Default blue color
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class PaperUpdate(BaseModel):
    title: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None

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

class TagBase(BaseModel):
    name: str
    type: str # 'global' or 'local'
    project_id: Optional[int] = None

class TagCreate(TagBase):
    pass

class TagUpdate(BaseModel):
    name: Optional[str] = None


class Tag(TagBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class NodeTag(BaseModel):
    tag_id: int
    node_id: str
    created_at: datetime

    class Config:
        from_attributes = True

class TagSummary(BaseModel):
    tag_id: int
    tag_name: str
    tag_type: str
    node_count: int

class ComputeEmbeddingsResponse(BaseModel):
    status: str
    message: str
    nodes_processed: int

class NoteBase(BaseModel):
    title: Optional[str] = None
    content: str
    color: Optional[str] = "#FEF3C7" # Default sticky note yellow

class NoteCreate(NoteBase):
    project_id: int

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    color: Optional[str] = None

class Note(NoteBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
