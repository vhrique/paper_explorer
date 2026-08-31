import { useState } from 'react';
import { X, Settings, CheckCircle, XCircle, Loader } from 'lucide-react';
import { getSettings, saveSettings, type AppSettings } from '../services/settingsService';

type TestStatus = 'idle' | 'testing' | 'ok' | 'error';

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [embStatus, setEmbStatus] = useState<TestStatus>('idle');
  const [llmStatus, setLlmStatus] = useState<TestStatus>('idle');
  const [embError, setEmbError] = useState('');
  const [llmError, setLlmError] = useState('');

  const update = (key: keyof AppSettings, value: string) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    saveSettings(settings);
    onClose();
  };

  // Normalize the base URL the same way the real service calls do.
  const normBase = (u: string) => u.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');

  const describe = async (r: Response): Promise<string> => {
    const raw = await r.text().catch(() => '');
    try {
      const msg = JSON.parse(raw)?.error?.message;
      if (msg) return `${r.status}: ${msg}`;
    } catch {
      /* not JSON */
    }
    return `${r.status}: ${raw.slice(0, 300) || r.statusText}`;
  };

  const testEmbedding = async () => {
    setEmbStatus('testing');
    setEmbError('');
    try {
      const r = await fetch(`${normBase(settings.embeddingBaseUrl)}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.embeddingApiKey || 'none'}` },
        body: JSON.stringify({ model: settings.embeddingModel, input: ['test'] }),
      });
      setEmbStatus(r.ok ? 'ok' : 'error');
      if (!r.ok) setEmbError(await describe(r));
    } catch (e) {
      setEmbStatus('error');
      setEmbError(`${(e as Error).message} — likely CORS or the host is unreachable.`);
    }
  };

  const testLLM = async () => {
    setLlmStatus('testing');
    setLlmError('');
    try {
      const url = `${normBase(settings.llmBaseUrl)}/v1/chat/completions`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.llmApiKey || 'none'}` };
      const body: Record<string, unknown> = {
        model: settings.llmModel,
        temperature: 0.2,
        messages: [{ role: 'user', content: 'reply with the single word ok' }],
      };
      // Same fallback the app uses: drop params the model rejects, then retry.
      let r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      let note = '';
      if (!r.ok && (r.status === 400 || r.status === 422)) {
        const txt = await r.text().catch(() => '');
        if (/temperature/i.test(txt) && 'temperature' in body) {
          delete body.temperature;
          note = ' (this model ignores temperature — the app handles that automatically)';
          r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        }
      }
      setLlmStatus(r.ok ? 'ok' : 'error');
      if (!r.ok) setLlmError(await describe(r));
      else if (note) setLlmError(note.trim());
    } catch (e) {
      setLlmStatus('error');
      setLlmError(`${(e as Error).message} — likely CORS or the host is unreachable.`);
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
              onChange={v => { update('embeddingBaseUrl', v); setEmbStatus('idle'); setEmbError(''); }} />
            <Field label="API Key" value={settings.embeddingApiKey} placeholder="lm-studio"
              onChange={v => { update('embeddingApiKey', v); setEmbStatus('idle'); setEmbError(''); }} type="password" />
            <Field label="Model" value={settings.embeddingModel} placeholder="text-embedding-3-small"
              onChange={v => { update('embeddingModel', v); setEmbStatus('idle'); setEmbError(''); }} />
            <button onClick={testEmbedding} disabled={!settings.embeddingBaseUrl || embStatus === 'testing'}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              Test connection
            </button>
            {embError && (
              <p className="text-xs text-red-500 break-words whitespace-pre-wrap bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
                {embError}
              </p>
            )}
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
            <Field label="Base URL" value={settings.llmBaseUrl} placeholder="https://api.openai.com/v1"
              onChange={v => { update('llmBaseUrl', v); setLlmStatus('idle'); setLlmError(''); }} />
            <Field label="API Key" value={settings.llmApiKey} placeholder="sk-…"
              onChange={v => { update('llmApiKey', v); setLlmStatus('idle'); setLlmError(''); }} type="password" />
            <Field label="Model" value={settings.llmModel} placeholder="gpt-4o-mini"
              onChange={v => { update('llmModel', v); setLlmStatus('idle'); setLlmError(''); }} />
            <button onClick={testLLM} disabled={!settings.llmBaseUrl || llmStatus === 'testing'}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors">
              Test connection
            </button>
            {llmError && (
              <p
                className={`text-xs break-words whitespace-pre-wrap rounded-lg px-2 py-1.5 ${
                  llmStatus === 'ok'
                    ? 'text-gray-500 bg-gray-50 border border-gray-100'
                    : 'text-red-500 bg-red-50 border border-red-100'
                }`}
              >
                {llmError}
              </p>
            )}
            <Field label="Context window (tokens)" value={settings.llmContextTokens} placeholder="32000"
              onChange={v => update('llmContextTokens', v.replace(/[^0-9]/g, ''))} />
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.qaRequireSources !== 'no'}
                onChange={e => update('qaRequireSources', e.target.checked ? 'yes' : 'no')}
                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
              />
              Require the model to cite its sources
            </label>
            <p className="text-xs text-gray-400">
              OpenAI-compatible chat completions endpoint. The paper is sent as numbered passages on
              every question. With citing on, the model must return <code>{'{answer, sources}'}</code> (retried
              once if it doesn't) and you get clickable source cards; off is faster and more reliable on
              small models but gives the answer only. Set the context window to your model's real size.
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
