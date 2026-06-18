from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class Project(BaseModel):
    id: int
    name: str
    description: Optional[str]
    created_at: datetime


class PaperUpdate(BaseModel):
    title: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    abstract: Optional[str] = None

class Paper(BaseModel):
    id: int
    title: str
    filename: str
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    abstract: Optional[str] = None
    created_at: datetime
    url: Optional[str] = None
    project_ids: Optional[List[int]] = []


class TagCreate(BaseModel):
    name: str
    type: str  # 'content' | 'paper'
    project_id: Optional[int] = None

class TagUpdate(BaseModel):
    name: Optional[str] = None

class Tag(BaseModel):
    id: int
    name: str
    type: str
    project_id: Optional[int] = None
    created_at: datetime


class PassageCreate(BaseModel):
    page: int
    text: str
    rects: List[dict]
    color: Optional[str] = '#FDE047'

class PassageUpdate(BaseModel):
    color: Optional[str] = None

class Passage(BaseModel):
    id: int
    paper_id: int
    page: int
    text: str
    rects: List[dict]
    color: str
    created_at: datetime
    tags: Optional[List[Tag]] = []


class NoteCreate(BaseModel):
    type: str  # 'passage' | 'tag'
    content: str
    passage_ids: Optional[List[int]] = []
    tag_ids: Optional[List[int]] = []

class NoteUpdate(BaseModel):
    content: Optional[str] = None

class Note(BaseModel):
    id: int
    type: str
    content: str
    created_at: datetime
    updated_at: datetime
    passage_ids: Optional[List[int]] = []
    tag_ids: Optional[List[int]] = []


class SearchQuery(BaseModel):
    query: str
    limit: Optional[int] = 10

class ChunkResult(BaseModel):
    chunk_id: int
    page: int
    text: str
    similarity: float
    rects: Optional[List[dict]] = []

class SearchResponse(BaseModel):
    answer: Optional[str] = None
    chunks: List[ChunkResult]


class PassageLink(BaseModel):
    id: int
    passage_id_1: int
    passage_id_2: int
    created_at: datetime

class PassageLinkDetail(BaseModel):
    id: int
    local_passage_id: int
    local_passage_text: str
    local_page: int
    remote_passage_id: int
    remote_passage_text: str
    remote_page: int
    remote_rects: List[dict]
    remote_paper_id: int
    remote_paper_title: str
    created_at: datetime


class FetchMetadataRequest(BaseModel):
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    title: Optional[str] = None

class PaperMetadataResult(BaseModel):
    title: Optional[str] = None
    doi: Optional[str] = None
    abstract: Optional[str] = None
    authors: Optional[List[str]] = []
    year: Optional[int] = None
    venue: Optional[str] = None
    source: str


class SimilarPassage(BaseModel):
    passage_id: int
    paper_id: int
    paper_title: str
    page: int
    text: str
    similarity: float
    rects: Optional[List[dict]] = []
    tags: Optional[List[Tag]] = []
    source: str = 'chunk'


# ---------------------------------------------------------------------------
# New: chunk serving + embedding endpoint models
# ---------------------------------------------------------------------------

class ChunkMeta(BaseModel):
    idx: int
    text: str
    page: int
    granularity: str
    parent_idx: int
    rects: List[dict]

class ChunkMetaResponse(BaseModel):
    embedding_dim: int
    chunks: List[ChunkMeta]

class EmbedRequest(BaseModel):
    text: str

class EmbedResponse(BaseModel):
    embedding: List[float]
