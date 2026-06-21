import { useState } from 'react';
import { X, Settings, CheckCircle, XCircle, Loader } from 'lucide-react';
import { getSettings, saveSettings, type AppSettings } from '../services/settingsService';
import { saveStorageSettings, isStorageConnected } from '../storage/workspace';

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [embStatus, setEmbStatus] = useState<TestStatus>('idle');
  const [llmStatus, setLlmStatus] = useState<TestStatus>('idle');

  const update = (key: keyof AppSettings, value: string) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    saveSettings(settings);
    if (isStorageConnected()) await saveStorageSettings(settings);
    onClose();
  };

  const testEmbedding = async () => {
    setEmbStatus('testing');
    try {
      const base = settings.embeddingBaseUrl.replace(/\/$/, '');
      const r = await fetch(`${base}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.embeddingApiKey || 'none'}` },
        body: JSON.stringify({ model: settings.embeddingModel, input: ['test'] }),
      });
      setEmbStatus(r.ok ? 'ok' : 'error');
    } catch {
      setEmbStatus('error');
    }
  };

  const testLLM = async () => {
    setLlmStatus('testing');
    try {
      const base = settings.llmBaseUrl.replace(/\/$/, '');
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.llmApiKey || 'none'}` },
        body: JSON.stringify({ model: settings.llmModel, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      setLlmStatus(r.ok ? 'ok' : 'error');
    } catch {
      setLlmStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800">Settings</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6 max-h-[70vh] overflow-y-auto">

          {/* Embedding API */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Embedding API</h3>
              <StatusBadge status={embStatus} />
            </div>
            <Field label="Base URL" value={settings.embeddingBaseUrl} placeholder="http://localhost:1234/v1"
              onChange={v => { update('embeddingBaseUrl', v); setEmbStatus('idle'); }} />
            <Field label="API Key" value={settings.embeddingApiKey} placeholder="lm-studio"
              onChange={v => update('embeddingApiKey', v)} type="password" />
            <Field label="Model" value={settings.embeddingModel} placeholder="text-embedding-nomic-embed-text-v1.5"
              onChange={v => update('embeddingModel', v)} />
            <button onClick={testEmbedding} disabled={!settings.embeddingBaseUrl || embStatus === 'testing'}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              Test connection
            </button>
            <p className="text-xs text-gray-400">
              OpenAI-compatible endpoint. Without this, similarity search uses BM25 keyword matching instead of embeddings.
            </p>
          </div>

          {/* LLM API */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">LLM API</h3>
              <StatusBadge status={llmStatus} />
            </div>
            <Field label="Base URL" value={settings.llmBaseUrl} placeholder="http://localhost:1234/v1"
              onChange={v => { update('llmBaseUrl', v); setLlmStatus('idle'); }} />
            <Field label="API Key" value={settings.llmApiKey} placeholder="lm-studio"
              onChange={v => update('llmApiKey', v)} type="password" />
            <Field label="Model" value={settings.llmModel} placeholder="qwen3"
              onChange={v => update('llmModel', v)} />
            <button onClick={testLLM} disabled={!settings.llmBaseUrl || llmStatus === 'testing'}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              Test connection
            </button>
            <p className="text-xs text-gray-400">
              OpenAI-compatible chat completions endpoint. Used for Q&amp;A in the Search tab.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose}
            className="px-4 py-2 text-xs text-gray-600 hover:text-gray-800 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white text-xs rounded-xl hover:bg-blue-700 transition-colors">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, placeholder, onChange, type = 'text' }: {
  label: string; value: string; placeholder: string;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
    </div>
  );
}

function StatusBadge({ status }: { status: TestStatus }) {
  if (status === 'idle') return null;
  if (status === 'testing') return <Loader size={14} className="text-gray-400 animate-spin" />;
  if (status === 'ok') return <CheckCircle size={14} className="text-green-500" />;
  return <XCircle size={14} className="text-red-500" />;
}
