/**
 * Learned similarity metric for the dense embedding path.
 *
 * Architecture: two linear projection layers (query_proj, key_proj) initialized
 * as identity, trained with manual passage links as positives and all other
 * passage pairs as negatives. Identical to the PyTorch SimilarityProjectionModel
 * from the archived backend, ported to TF.js for training and plain typed-array
 * math for inference.
 *
 * BM25 search is never touched here.
 */

import * as tf from '@tensorflow/tfjs';
import * as workspace from '../storage/workspace';

interface CachedModel {
  dim: number;
  queryWeight: Float32Array; // [dim * dim] row-major: W[i*dim+j] = weight[i][j]
  keyWeight: Float32Array;
}

const modelCache = new Map<number, CachedModel>();
// Projected + L2-normalized key embeddings: `${projectId}:${paperId}` → [n * dim]
const projectedKeyCache = new Map<string, Float32Array>();
const trainingInProgress = new Set<number>();

// ---------------------------------------------------------------------------
// Low-level math (no TF.js — used at inference time)
// ---------------------------------------------------------------------------

function matMulVec(W: Float32Array, v: Float32Array, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    let s = 0;
    const row = i * dim;
    for (let j = 0; j < dim; j++) s += W[row + j] * v[j];
    out[i] = s;
  }
  return out;
}

function l2normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  const scale = 1 / (Math.sqrt(norm) + 1e-8);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * scale;
  return out;
}

// ---------------------------------------------------------------------------
// Public inference API
// ---------------------------------------------------------------------------

export function hasModel(projectId: number): boolean {
  return modelCache.has(projectId);
}

function invalidateKeyCache(projectId: number): void {
  for (const key of projectedKeyCache.keys()) {
    if (key.startsWith(`${projectId}:`)) projectedKeyCache.delete(key);
  }
}

export function clearModel(projectId: number): void {
  modelCache.delete(projectId);
  invalidateKeyCache(projectId);
}

export async function loadModel(projectId: number): Promise<boolean> {
  try {
    const data = await workspace.getProjectModelWeights(projectId);
    if (!data) return false;
    modelCache.set(projectId, {
      dim: data.dim,
      queryWeight: new Float32Array(data.queryWeight),
      keyWeight: new Float32Array(data.keyWeight),
    });
    invalidateKeyCache(projectId);
    return true;
  } catch {
    return false;
  }
}

/** Project + L2-normalize a query vector through the learned query projection. */
export function projectQuery(projectId: number, queryEmb: Float32Array): Float32Array {
  const m = modelCache.get(projectId);
  if (!m || m.dim !== queryEmb.length) return l2normalize(queryEmb);
  return l2normalize(matMulVec(m.queryWeight, queryEmb, m.dim));
}

/** Project + L2-normalize a single key vector. */
export function projectKey(projectId: number, keyEmb: Float32Array): Float32Array {
  const m = modelCache.get(projectId);
  if (!m || m.dim !== keyEmb.length) return l2normalize(keyEmb);
  return l2normalize(matMulVec(m.keyWeight, keyEmb, m.dim));
}

/**
 * Get batch-projected + normalized key embeddings for a paper's chunks.
 * Result is flat [n * dim]. Computed once and cached per (projectId, paperId).
 */
export function getProjectedKeys(
  projectId: number,
  paperId: number,
  rawEmbeddings: Float32Array,
  embDim: number,
  n: number,
): Float32Array {
  const cacheKey = `${projectId}:${paperId}`;
  const cached = projectedKeyCache.get(cacheKey);
  if (cached) return cached;

  const m = modelCache.get(projectId);
  const useModel = m && m.dim === embDim;
  const out = new Float32Array(n * embDim);

  for (let i = 0; i < n; i++) {
    const raw = rawEmbeddings.subarray(i * embDim, (i + 1) * embDim);
    const proj = useModel
      ? l2normalize(matMulVec(m!.keyWeight, raw, embDim))
      : l2normalize(new Float32Array(raw));
    out.set(proj, i * embDim);
  }

  projectedKeyCache.set(cacheKey, out);
  return out;
}

/** Dot product of two already-normalized vectors (equals cosine similarity). */
export function dotSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export async function trainAndSave(
  projectId: number,
  passageEmbeddings: Array<{ id: number; embedding: number[] }>,
  links: Array<{ passage_id_1: number; passage_id_2: number }>,
  notePairs: Array<{ embedding: number[]; passageIds: number[] }> = [],
  epochs = 50,
  lr = 0.001,
): Promise<boolean> {
  if (passageEmbeddings.length === 0) return false;

  const dim = passageEmbeddings[0].embedding.length;
  if (dim === 0) return false;

  // Build id → Float32Array map
  const idToEmb = new Map<number, Float32Array>();
  for (const p of passageEmbeddings) {
    if (p.embedding.length === dim) idToEmb.set(p.id, new Float32Array(p.embedding));
  }

  const validLinks = links.filter(l => idToEmb.has(l.passage_id_1) && idToEmb.has(l.passage_id_2));

  // Build all positive pairs and the linked-pair set (for negative exclusion).
  const posQParts: Float32Array[] = [];
  const posKParts: Float32Array[] = [];
  const linkedSet = new Set<string>();

  // Manual passage links (bidirectional)
  for (const { passage_id_1: id1, passage_id_2: id2 } of validLinks) {
    posQParts.push(idToEmb.get(id1)!, idToEmb.get(id2)!);
    posKParts.push(idToEmb.get(id2)!, idToEmb.get(id1)!);
    linkedSet.add(`${Math.min(id1, id2)}_${Math.max(id1, id2)}`);
  }

  // Note → passage pairs: the note embedding and its annotated passage embeddings
  // are positive pairs (bidirectional), since the user wrote the note specifically
  // about that passage. Notes spanning multiple passages also make those passages
  // positive pairs with each other.
  for (const { embedding: noteEmb, passageIds } of notePairs) {
    if (noteEmb.length !== dim) continue;
    const noteF32 = new Float32Array(noteEmb);
    for (const pid of passageIds) {
      const passEmb = idToEmb.get(pid);
      if (!passEmb) continue;
      posQParts.push(noteF32, passEmb);
      posKParts.push(passEmb, noteF32);
    }
    for (let i = 0; i < passageIds.length; i++) {
      for (let j = i + 1; j < passageIds.length; j++) {
        const e1 = idToEmb.get(passageIds[i]);
        const e2 = idToEmb.get(passageIds[j]);
        if (!e1 || !e2) continue;
        const key = `${Math.min(passageIds[i], passageIds[j])}_${Math.max(passageIds[i], passageIds[j])}`;
        if (!linkedSet.has(key)) {
          posQParts.push(e1, e2);
          posKParts.push(e2, e1);
          linkedSet.add(key);
        }
      }
    }
  }

  if (posQParts.length === 0) {
    try { await workspace.deleteProjectModel(projectId); } catch { /* ok */ }
    clearModel(projectId);
    return true;
  }

  const nPos = posQParts.length;
  const posQArr = new Float32Array(nPos * dim);
  const posKArr = new Float32Array(nPos * dim);
  for (let i = 0; i < nPos; i++) {
    posQArr.set(posQParts[i], i * dim);
    posKArr.set(posKParts[i], i * dim);
  }

  // Build negative pairs from all non-linked passage pairs
  const passageIds = [...idToEmb.keys()];
  const negQParts: Float32Array[] = [];
  const negKParts: Float32Array[] = [];

  for (let i = 0; i < passageIds.length; i++) {
    for (let j = i + 1; j < passageIds.length; j++) {
      const key = `${Math.min(passageIds[i], passageIds[j])}_${Math.max(passageIds[i], passageIds[j])}`;
      if (!linkedSet.has(key)) {
        negQParts.push(idToEmb.get(passageIds[i])!, idToEmb.get(passageIds[j])!);
        negKParts.push(idToEmb.get(passageIds[j])!, idToEmb.get(passageIds[i])!);
      }
    }
  }

  // Sample negatives to keep training fast
  let nNeg = negQParts.length;
  const maxNeg = Math.min(Math.max(1000, validLinks.length * 20), 20000);
  let negQArr: Float32Array | null = null;
  let negKArr: Float32Array | null = null;

  if (nNeg > 0) {
    let indices = Array.from({ length: nNeg }, (_, i) => i);
    if (nNeg > maxNeg) {
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      indices = indices.slice(0, maxNeg);
      nNeg = maxNeg;
    }
    negQArr = new Float32Array(nNeg * dim);
    negKArr = new Float32Array(nNeg * dim);
    for (let k = 0; k < nNeg; k++) {
      negQArr.set(negQParts[indices[k]], k * dim);
      negKArr.set(negKParts[indices[k]], k * dim);
    }
  }

  // TF.js training — variables + Adam
  const qW = tf.variable(tf.eye(dim), true);
  const kW = tf.variable(tf.eye(dim), true);
  const optimizer = tf.train.adam(lr);

  const posQ = tf.tensor2d(posQArr, [nPos, dim]);
  const posK = tf.tensor2d(posKArr, [nPos, dim]);
  const negQ = negQArr ? tf.tensor2d(negQArr, [nNeg, dim]) : null;
  const negK = negKArr ? tf.tensor2d(negKArr, [nNeg, dim]) : null;

  try {
    for (let epoch = 0; epoch < epochs; epoch++) {
      const lossT = optimizer.minimize(() => tf.tidy(() => {
        // Positive loss: push linked pairs toward sim=1
        const pqProj = tf.matMul(posQ, qW, false, true);
        const pkProj = tf.matMul(posK, kW, false, true);
        const pqNorm = tf.div(pqProj, tf.add(tf.sqrt(tf.sum(tf.square(pqProj), 1, true)), 1e-8));
        const pkNorm = tf.div(pkProj, tf.add(tf.sqrt(tf.sum(tf.square(pkProj), 1, true)), 1e-8));
        const posSim = tf.sum(tf.mul(pqNorm, pkNorm), 1);
        const posLoss = tf.mean(tf.square(tf.sub(1.0, posSim)));

        if (!negQ || !negK) return posLoss as tf.Scalar;

        // Negative loss: hinge at 0.2
        const nqProj = tf.matMul(negQ, qW, false, true);
        const nkProj = tf.matMul(negK, kW, false, true);
        const nqNorm = tf.div(nqProj, tf.add(tf.sqrt(tf.sum(tf.square(nqProj), 1, true)), 1e-8));
        const nkNorm = tf.div(nkProj, tf.add(tf.sqrt(tf.sum(tf.square(nkProj), 1, true)), 1e-8));
        const negSim = tf.sum(tf.mul(nqNorm, nkNorm), 1);
        const negLoss = tf.mean(tf.square(tf.relu(tf.sub(negSim, 0.2))));

        return tf.add(posLoss, negLoss) as tf.Scalar;
      }), true);

      lossT?.dispose();
    }

    const qWeightData = qW.dataSync() as Float32Array;
    const kWeightData = kW.dataSync() as Float32Array;

    modelCache.set(projectId, {
      dim,
      queryWeight: new Float32Array(qWeightData),
      keyWeight: new Float32Array(kWeightData),
    });
    invalidateKeyCache(projectId);

    await workspace.saveProjectModelWeights(projectId, {
      dim,
      queryWeight: Array.from(qWeightData),
      keyWeight: Array.from(kWeightData),
    });

    return true;
  } finally {
    posQ.dispose();
    posK.dispose();
    negQ?.dispose();
    negK?.dispose();
    qW.dispose();
    kW.dispose();
    optimizer.dispose();
  }
}

export type TrainingResult =
  | 'trained'
  | 'cleared'       // had a model, but all links were removed
  | 'no-links'      // no passage links in this project
  | 'no-embeddings' // passages exist but none have embeddings
  | 'already-running'
  | 'error';

/**
 * Gather training data from the workspace and retrain.
 * Returns a descriptive result so callers can show feedback.
 */
export async function triggerModelTraining(projectId: number): Promise<TrainingResult> {
  if (trainingInProgress.has(projectId)) return 'already-running';
  trainingInProgress.add(projectId);
  try {
    const papers = await workspace.getProjectPapers(projectId);
    const allEmbeddings: Array<{ id: number; embedding: number[] }> = [];
    for (const paper of papers) {
      const embs = await workspace.getPassageEmbeddings(paper.id);
      allEmbeddings.push(...embs);
    }

    const [links, notePairs] = await Promise.all([
      workspace.getAllPassageLinks(),
      workspace.getNoteEmbeddingsForProject(projectId),
    ]);
    const validLinks = links.filter(
      l => allEmbeddings.some(e => e.id === l.passage_id_1) &&
           allEmbeddings.some(e => e.id === l.passage_id_2),
    );

    const hasSignal = links.length > 0 || notePairs.length > 0;
    if (!hasSignal) return 'no-links';
    if (allEmbeddings.length === 0) return 'no-embeddings';
    if (validLinks.length === 0 && notePairs.length === 0) return 'no-embeddings';

    const ok = await trainAndSave(projectId, allEmbeddings, links, notePairs);
    // trainAndSave returns true with no model when links = 0 (cleared), true when trained
    if (!ok) return 'error';
    return validLinks.length > 0 ? 'trained' : 'cleared';
  } catch (e) {
    console.warn('[similarityModel] Training failed:', e);
    return 'error';
  } finally {
    trainingInProgress.delete(projectId);
  }
}

/**
 * Fire-and-forget version for post-link-change auto-retraining.
 * Drops concurrent calls silently.
 */
export function scheduleModelTraining(projectId: number): void {
  void triggerModelTraining(projectId);
}
