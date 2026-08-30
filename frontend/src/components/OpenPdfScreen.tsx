import { FileText, Settings } from 'lucide-react';
import { isFilePickerSupported } from '../services/pdfFile';

interface Props {
  onOpen: () => void;
  onOpenSettings: () => void;
  busy?: boolean;
  stage?: string;
  error?: string | null;
}

export function OpenPdfScreen({ onOpen, onOpenSettings, busy, stage, error }: Props) {
  const supported = isFilePickerSupported();

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <button
        onClick={onOpenSettings}
        className="absolute top-3 right-3 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
        title="Settings"
      >
        <Settings size={16} />
      </button>

      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto">
          <FileText size={28} className="text-blue-600" />
        </div>
        <h1 className="text-lg font-bold text-gray-900">Assisted Reader</h1>
        <p className="text-sm text-gray-500">
          Open a PDF to read it with an assistant that answers questions and points you to where
          the answer lives. Highlights and comments are saved straight into the PDF file.
        </p>

        {busy ? (
          <p className="text-sm text-blue-600 animate-pulse">{stage || 'Working…'}</p>
        ) : (
          <button
            onClick={onOpen}
            disabled={!supported}
            className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-40"
          >
            Open a PDF
          </button>
        )}

        {error && <p className="text-xs text-red-500">{error}</p>}

        <p className="text-xs text-gray-400">
          {supported
            ? 'Works in Chrome and Edge. Firefox and Safari are not supported.'
            : 'This browser cannot open local files for editing. Use Chrome or Edge.'}
        </p>
      </div>
    </div>
  );
}
