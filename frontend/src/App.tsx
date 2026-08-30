import { useRef, useState } from 'react';
import { OpenPdfScreen } from './components/OpenPdfScreen';
import { ReaderView } from './components/ReaderView';
import { SettingsPanel } from './components/SettingsPanel';
import { api } from './api';
import type { ProcessResponse } from './api';
import { pickPdf, flushWrites, type OpenedPdf } from './services/pdfFile';
import { getCachedPaper, putCachedPaper, type PaperCacheEntry } from './services/paperCache';
import { getEmbeddingModelId, hasEmbeddingConfig } from './services/settingsService';

export interface EmbedProgress {
  done: number;
  total: number;
}

function toEntry(hash: string, name: string, r: ProcessResponse): PaperCacheEntry {
  return {
    hash,
    title: r.metadata.title,
    filename: name,
    doi: r.metadata.doi,
    arxivId: r.metadata.arxiv_id,
    chunkMeta: r.chunk_meta,
    embeddingsB64: r.embeddings_bin_b64,
    embeddingDim: r.embedding_dim,
    embeddingModel: r.embedding_model || (r.embedding_dim > 0 ? getEmbeddingModelId() : ''),
    createdAt: new Date().toISOString(),
  };
}

function App() {
  const [opened, setOpened] = useState<OpenedPdf | null>(null);
  const [cache, setCache] = useState<PaperCacheEntry | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [embedProgress, setEmbedProgress] = useState<EmbedProgress | null>(null);

  // Which paper the background embedding task is currently for (ignore stale updates).
  const embedForHash = useRef<string | null>(null);

  /** Generate embeddings for `entry` in the background, then update the cache in place. */
  const runBackgroundEmbedding = (entry: PaperCacheEntry) => {
    if (entry.embeddingDim > 0 && entry.embeddingModel === getEmbeddingModelId()) return;
    if (!hasEmbeddingConfig()) return;

    embedForHash.current = entry.hash;
    setEmbedProgress({ done: 0, total: entry.chunkMeta.length });

    void api
      .embedChunks(entry.chunkMeta.map(c => c.text), (done, total) => {
        if (embedForHash.current === entry.hash) setEmbedProgress({ done, total });
      })
      .then(async res => {
        if (res.dim > 0) {
          const updated: PaperCacheEntry = {
            ...entry,
            embeddingsB64: res.b64,
            embeddingDim: res.dim,
            embeddingModel: res.model,
          };
          await putCachedPaper(updated);
          setCache(prev => (prev && prev.hash === updated.hash ? updated : prev));
        }
      })
      .catch(e => console.warn('Background embedding failed:', e))
      .finally(() => {
        if (embedForHash.current === entry.hash) {
          embedForHash.current = null;
          setEmbedProgress(null);
        }
      });
  };

  const handleOpen = async () => {
    setError(null);
    setBusy(true);
    try {
      setStage('Opening…');
      const pdf = await pickPdf();
      if (!pdf) {
        setBusy(false);
        return;
      }

      let entry = await getCachedPaper(pdf.hash);
      let fresh = false;
      if (!entry) {
        fresh = true;
        setStage('Reading the PDF…');
        const result = await api.processPaper(
          new File([pdf.bytes], pdf.name, { type: 'application/pdf' }),
          setStage,
          { embed: false }, // parse now, embed in the background
        );
        entry = toEntry(pdf.hash, pdf.name, result);
        await putCachedPaper(entry);
      }

      setPdfUrl(URL.createObjectURL(new Blob([pdf.bytes], { type: 'application/pdf' })));
      setOpened(pdf);
      setCache(entry);
      if (fresh) runBackgroundEmbedding(entry);
    } catch (e) {
      console.error(e);
      setError((e as Error).message || 'Could not open that PDF.');
    } finally {
      setBusy(false);
      setStage('');
    }
  };

  const handleClose = async () => {
    await flushWrites();
    embedForHash.current = null;
    setEmbedProgress(null);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl('');
    setOpened(null);
    setCache(null);
  };

  const handleReprocess = async () => {
    if (!opened) return;
    const result = await api.processPaper(
      new File([opened.bytes], opened.name, { type: 'application/pdf' }),
      undefined,
      { embed: false },
    );
    const entry = toEntry(opened.hash, opened.name, result);
    await putCachedPaper(entry);
    setCache(entry);
    runBackgroundEmbedding(entry);
  };

  if (opened && cache && pdfUrl) {
    return (
      <>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        <ReaderView
          opened={opened}
          cache={cache}
          pdfUrl={pdfUrl}
          embedProgress={embedProgress}
          onClose={handleClose}
          onReprocess={handleReprocess}
          onOpenSettings={() => setShowSettings(true)}
        />
      </>
    );
  }

  return (
    <>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <OpenPdfScreen
        onOpen={handleOpen}
        onOpenSettings={() => setShowSettings(true)}
        busy={busy}
        stage={stage}
        error={error}
      />
    </>
  );
}

export default App;
