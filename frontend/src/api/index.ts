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

export interface Node {
    id: string;
    type: 'text' | 'image';
    content: string;
    page_number: number;
    bbox: number[];
    paper_id: number;
    paper_color?: string;
    position?: { x: number; y: number };  // PCA-based position from backend
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

    getGraph: async (projectId: number): Promise<GraphData> => {
        const response = await axios.get(`${API_URL}/projects/${projectId}/graph`);
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
    }
};
