import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../api';

interface PDFUploaderProps {
    projectId: number;
    onUploadComplete: () => void;
}

export const PDFUploader: React.FC<PDFUploaderProps> = ({ projectId, onUploadComplete }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0 && files[0].type === 'application/pdf') {
            await uploadFile(files[0]);
        } else {
            setError('Please upload a PDF file.');
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            await uploadFile(e.target.files[0]);
        }
    };

    const uploadFile = async (file: File) => {
        setIsUploading(true);
        setError(null);
        try {
            await api.uploadPDF(projectId, file);
            onUploadComplete();
        } catch (err) {
            setError('Failed to upload file. Please try again.');
            console.error(err);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="w-full">
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                    relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                    ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'}
                    ${isUploading ? 'pointer-events-none opacity-50' : ''}
                `}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept=".pdf"
                    className="hidden"
                />

                <div className="flex flex-col items-center gap-3">
                    {isUploading ? (
                        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                    ) : (
                        <Upload className={`w-10 h-10 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                    )}

                    <div className="text-sm text-gray-600">
                        {isUploading ? (
                            <span className="font-medium text-blue-600">Processing PDF...</span>
                        ) : (
                            <>
                                <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
                                <p className="text-xs text-gray-400 mt-1">PDF files only</p>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}
        </div>
    );
};
