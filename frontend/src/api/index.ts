import axios from 'axios';

// Use relative path for Docker (via Vite proxy) or localhost for direct access
const API_URL = import.meta.env.VITE_API_URL || '/api';

export interface Project {
    id: number;
    name: string;
    description: string;
    created_at: string;
}

export interface Paper {
    id: number;
    project_id: number;
    title: string;
    filename: string;
    color: string;
    description?: string;
    created_at: string;
}

export interface Note {
    id: number;
    project_id: number;
    title?: string;
    content: string;
    color: string;
    created_at: string;
    updated_at: string;
}

export interface Node {
    id: string;
    type: 'text' | 'image' | 'note';
    content: string;
    page_number: number;
    bbox: number[];
    paper_id: number;
    paper_color?: string;
    position?: { x: number; y: number };  // PCA-based position from backend
    has_tags?: boolean;  // Whether this node has any tags
    note_id?: string; // ID of the note if type is 'note'
    title?: string; // Title for note
}

export interface Edge {
    source: string;
    target: string;
    type: string;
    weight: number;
}

export interface GraphData {
    nodes: Node[];
    edges: Edge[];
}

export interface Tag {
    id: number;
    name: string;
    type: 'global' | 'local';
    project_id?: number;
    created_at: string;
}

export interface TagSummary {
    tag_id: number;
    tag_name: string;
    tag_type: string;
    node_count: number;
}

export const api = {
    createProject: async (name: string, description: string): Promise<Project> => {
        const response = await axios.post(`${API_URL}/projects/`, { name, description });
        return response.data;
    },

    listProjects: async (): Promise<Project[]> => {
        const response = await axios.get(`${API_URL}/projects/`);
        return response.data;
    },

    uploadPDF: async (projectId: number, file: File): Promise<any> => {
        const formData = new FormData();
        formData.append('file', file);
        const response = await axios.post(`${API_URL}/projects/${projectId}/upload/`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return response.data;
    },

    getGraph: async (projectId: number, useNewEmbeddings: boolean = false): Promise<GraphData> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/graph`, {
            params: { use_new_embeddings: useNewEmbeddings }
        });
        return response.data;
    },

    deleteProject: async (projectId: number): Promise<void> => {
        await axios.delete(`${API_URL}/projects/${projectId}`);
    },

    listPapers: async (projectId: number): Promise<Paper[]> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/papers/`);
        return response.data;
    },

    getPaper: async (paperId: number): Promise<Paper> => {
        const response = await axios.get(`${API_URL}/papers/${paperId}`);
        return response.data;
    },

    deletePaper: async (paperId: number): Promise<void> => {
        await axios.delete(`${API_URL}/papers/${paperId}`);
    },

    updatePaper: async (paperId: number, updates: { title?: string; color?: string; description?: string }): Promise<Paper> => {
        const response = await axios.patch(`${API_URL}/papers/${paperId}`, updates);
        return response.data;
    },

    // Tag API
    createTag: async (name: string, type: 'global' | 'local', projectId?: number): Promise<Tag> => {
        const response = await axios.post(`${API_URL}/tags/`, { name, type, project_id: projectId });
        return response.data;
    },

    listTags: async (projectId: number): Promise<Tag[]> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/tags`);
        return response.data;
    },

    addNodeTag: async (nodeId: string, tagId: number): Promise<void> => {
        const formData = new FormData();
        formData.append('tag_id', tagId.toString());
        await axios.post(`${API_URL}/nodes/${nodeId}/tags`, formData);
    },

    removeNodeTag: async (nodeId: string, tagId: number): Promise<void> => {
        await axios.delete(`${API_URL}/nodes/${nodeId}/tags/${tagId}`);
    },

    getNodeTags: async (nodeId: string): Promise<Tag[]> => {
        const response = await axios.get(`${API_URL}/nodes/${nodeId}/tags`);
        return response.data;
    },

    // Advanced View API
    getTagSummary: async (projectId: number): Promise<TagSummary[]> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/tags/summary`);
        return response.data;
    },

    computeNewEmbeddings: async (projectId: number, useGlobalContext: boolean = false): Promise<{ status: string; message: string; nodes_processed: number }> => {
        const response = await axios.post(`${API_URL}/projects/${projectId}/embeddings/compute`, null, {
            params: { use_global_context: useGlobalContext }
        });
        return response.data;
    },

    deleteTag: async (tagId: number): Promise<void> => {
        await axios.delete(`${API_URL}/tags/${tagId}`);
    },

    updateTag: async (tagId: number, name: string): Promise<Tag> => {
        const response = await axios.patch(`${API_URL}/tags/${tagId}`, { name });
        return response.data;
    },

    getTagNodes: async (projectId: number, tagId: number): Promise<any[]> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/tags/${tagId}/nodes`);
        return response.data;
    },

    // Note API
    createNote: async (projectId: number, title: string, content: string, color: string): Promise<Note> => {
        const response = await axios.post(`${API_URL}/projects/${projectId}/notes/`, { project_id: projectId, title, content, color });
        return response.data;
    },

    listNotes: async (projectId: number): Promise<Note[]> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/notes/`);
        return response.data;
    },

    updateNote: async (noteId: number, updates: { title?: string; content?: string; color?: string }): Promise<Note> => {
        const response = await axios.patch(`${API_URL}/notes/${noteId}`, updates);
        return response.data;
    },

    deleteNote: async (noteId: number): Promise<void> => {
        await axios.delete(`${API_URL}/notes/${noteId}`);
    },

    // Similarity and Linking API
    getSimilarNodes: async (noteId: number): Promise<Node[]> => {
        const response = await axios.get(`${API_URL}/notes/${noteId}/similar`);
        return response.data;
    },

    createLink: async (sourceNodeId: string, targetNodeId: string, type: string = 'manual'): Promise<void> => {
        await axios.post(`${API_URL}/links/`, { source_node_id: sourceNodeId, target_node_id: targetNodeId, type });
    },

    getLinks: async (nodeId: string): Promise<any[]> => {
        const response = await axios.get(`${API_URL}/links/${nodeId}`);
        return response.data;
    },

    deleteLink: async (sourceNodeId: string, targetNodeId: string): Promise<void> => {
        await axios.delete(`${API_URL}/links/`, {
            params: { source_node_id: sourceNodeId, target_node_id: targetNodeId }
        });
    }
};
