import { useEffect, useState } from 'react';
import { LibraryView } from './components/LibraryView';
import { ReaderView } from './components/ReaderView';
import { SettingsPanel } from './components/SettingsPanel';
import type { Paper, Project } from './api';
import { LocalFolderAdapter } from './storage/LocalFolderAdapter';
import { setAdapter, getStorageSettings } from './storage/workspace';
import { getSettings, saveSettings } from './services/settingsService';
import { clearChunkCache } from './utils/similarity';
import { FolderOpen, Settings } from 'lucide-react';


type AppState = 'loading' | 'needs-folder' | 'ready';

const adapter = new LocalFolderAdapter();

function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [storedFolderName, setStoredFolderName] = useState<string | null>(null);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const openSettings = () => setShowSettings(true);

  useEffect(() => {
    adapter.getStoredFolderName().then(name => {
      setStoredFolderName(name);
      setAppState('needs-folder');
    });
  }, []);

  const applyStorageSettings = async () => {
    try {
      const stored = await getStorageSettings();
      if (stored) saveSettings({ ...getSettings(), ...stored });
    } catch { /* no settings.json yet — fine */ }
  };

  const handleReconnect = async () => {
    try {
      const restored = await adapter.tryRestoreFromIDB();
      if (restored) {
        setAdapter(adapter);
        await applyStorageSettings();
        setAppState('ready');
        return;
      }
      // Permission denied — fall back to picker
      await adapter.connect();
      setStoredFolderName(await adapter.getStoredFolderName());
      setAdapter(adapter);
      await applyStorageSettings();
      setAppState('ready');
    } catch {
      // User cancelled — stay on needs-folder
    }
  };

  const handleChooseNew = async () => {
    try {
      await adapter.connect();
      setStoredFolderName(await adapter.getStoredFolderName());
      setAdapter(adapter);
      await applyStorageSettings();
      setAppState('ready');
    } catch {
      // User cancelled — stay on needs-folder
    }
  };

  if (appState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400 animate-pulse">Loading…</div>
      </div>
    );
  }

  if (appState === 'needs-folder') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        <button onClick={openSettings} className="absolute top-3 right-3 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors" title="Settings">
          <Settings size={16} />
        </button>
        <div className="text-center space-y-4 max-w-sm px-6">
          <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto">
            <FolderOpen size={28} className="text-blue-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Paper Explorer</h1>
          {storedFolderName ? (
            <>
              <p className="text-sm text-gray-500">
                Click to reconnect to your workspace folder <strong>"{storedFolderName}"</strong>.
              </p>
              <button
                onClick={handleReconnect}
                className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Open "{storedFolderName}"
              </button>
              <button
                onClick={handleChooseNew}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Choose a different folder
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                Choose a folder on your computer to store your workspace — papers, highlights, notes, and embeddings will all live there.
              </p>
              <button
                onClick={handleChooseNew}
                className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Choose workspace folder
              </button>
            </>
          )}
          <p className="text-xs text-gray-400">Works in Chrome and Edge. Firefox is not supported.</p>
        </div>
      </div>
    );
  }

  if (selectedPaper && selectedProject) {
    return (
      <>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        <ReaderView
          paper={selectedPaper}
          project={selectedProject}
          onBack={() => {
            clearChunkCache();
            setSelectedPaper(null);
            setSelectedProject(null);
          }}
          onOpenSettings={openSettings}
        />
      </>
    );
  }

  return (
    <>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <LibraryView
        onOpenPaper={(paper, project) => {
          setSelectedPaper(paper);
          setSelectedProject(project);
        }}
        onOpenSettings={openSettings}
      />
    </>
  );
}

export default App;
