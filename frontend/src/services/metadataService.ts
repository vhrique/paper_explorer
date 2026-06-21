import type { PaperMetadataResult } from '../api';

const HEADERS = { 'User-Agent': 'PaperExplorer/2.0' };
const SS_FIELDS = 'title,abstract,authors,year,venue,externalIds';
const OA_FIELDS = 'title,abstract_inverted_index,doi,publication_year,authorships,primary_location';

function cleanDoi(doi: string): string {
  doi = doi.trim();
  while (doi && '.),;]'.includes(doi[doi.length - 1])) doi = doi.slice(0, -1);
  for (const prefix of ['https://doi.org/', 'http://doi.org/', 'doi.org/', 'doi:']) {
    if (doi.toLowerCase().startsWith(prefix)) { doi = doi.slice(prefix.length); break; }
  }
  return doi;
}

async function httpGet(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function parseSemanticScholar(data: Record<string, unknown>): PaperMetadataResult {
  const extIds = (data.externalIds as Record<string, string> | null) ?? {};
  return {
    title: data.title as string | undefined,
    abstract: data.abstract as string | undefined,
    doi: extIds['DOI'],
    year: data.year as number | undefined,
    venue: (data.venue as string | undefined) || undefined,
    authors: ((data.authors as Array<{ name: string }>) ?? []).map(a => a.name),
    source: 'semantic_scholar',
  };
}

async function fetchSemanticScholar(doi?: string, arxivId?: string, title?: string): Promise<PaperMetadataResult | null> {
  if (doi) {
    const data = await httpGet(`https://api.semanticscholar.org/graph/v1/paper/DOI:${cleanDoi(doi)}?fields=${SS_FIELDS}`);
    if (data?.title) return parseSemanticScholar(data);
  }
  if (arxivId) {
    const data = await httpGet(`https://api.semanticscholar.org/graph/v1/paper/arXiv:${arxivId}?fields=${SS_FIELDS}`);
    if (data?.title) return parseSemanticScholar(data);
  }
  if (title) {
    const data = await httpGet(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&fields=${SS_FIELDS}&limit=1`);
    const results = data?.data as unknown[] | undefined;
    if (results?.length) return parseSemanticScholar(results[0] as Record<string, unknown>);
  }
  return null;
}

function reconstructAbstract(inverted: Record<string, number[]> | null | undefined): string | undefined {
  if (!inverted) return undefined;
  const maxPos = Math.max(...Object.values(inverted).flat());
  const words = new Array(maxPos + 1).fill('');
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) words[pos] = word;
  }
  const text = words.filter(w => w).join(' ');
  return text || undefined;
}

function parseOpenAlex(data: Record<string, unknown>): PaperMetadataResult {
  let doi = (data.doi as string | undefined) ?? '';
  if (doi.toLowerCase().startsWith('https://doi.org/')) doi = doi.slice('https://doi.org/'.length);

  const authorships = (data.authorships as Array<{ author?: { display_name?: string } }>) ?? [];
  const authors = authorships.map(a => a.author?.display_name).filter((n): n is string => Boolean(n));

  const loc = (data.primary_location as Record<string, unknown> | undefined) ?? {};
  const src = (loc.source as Record<string, unknown> | undefined) ?? {};
  const venue = src.display_name as string | undefined;

  return {
    title: data.title as string | undefined,
    abstract: reconstructAbstract(data.abstract_inverted_index as Record<string, number[]> | undefined),
    doi: doi || undefined,
    year: data.publication_year as number | undefined,
    venue,
    authors,
    source: 'openalex',
  };
}

async function fetchOpenAlex(doi?: string, arxivId?: string, title?: string): Promise<PaperMetadataResult | null> {
  if (doi) {
    const data = await httpGet(`https://api.openalex.org/works/doi:${cleanDoi(doi)}?select=${OA_FIELDS}`);
    if (data?.title) return parseOpenAlex(data);
  }
  if (arxivId) {
    const arxivDoi = `10.48550/arXiv.${arxivId}`;
    const data = await httpGet(`https://api.openalex.org/works/doi:${arxivDoi}?select=${OA_FIELDS}`);
    if (data?.title) return parseOpenAlex(data);
  }
  if (title) {
    const data = await httpGet(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=1&select=${OA_FIELDS}`);
    const results = data?.results as unknown[] | undefined;
    if (results?.length) return parseOpenAlex(results[0] as Record<string, unknown>);
  }
  return null;
}

export async function fetchPaperMetadata(doi?: string, arxivId?: string, title?: string): Promise<PaperMetadataResult> {
  const result = await fetchSemanticScholar(doi, arxivId, title) ?? await fetchOpenAlex(doi, arxivId, title);
  return result ?? { source: 'none' };
}
