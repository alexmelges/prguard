import type { DuplicateMatch, EmbeddingRecord } from "./types.js";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function findDuplicates(
  current: EmbeddingRecord,
  existing: EmbeddingRecord[],
  threshold: number
): DuplicateMatch[] {
  return existing
    .filter((item) => !(item.type === current.type && item.number === current.number))
    .map((item) => ({
      type: item.type,
      number: item.number,
      similarity: cosineSimilarity(current.embedding, item.embedding),
      title: item.title
    }))
    .filter((item) => item.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}

export function clusterDuplicates(
  items: EmbeddingRecord[],
  threshold: number
): Array<{ anchor: EmbeddingRecord; members: EmbeddingRecord[] }> {
  const clusters: Array<{ anchor: EmbeddingRecord; members: EmbeddingRecord[] }> = [];
  const visited = new Set<string>();

  for (const item of items) {
    const key = `${item.type}:${item.number}`;
    if (visited.has(key)) {
      continue;
    }

    const members = [item];
    visited.add(key);

    for (const candidate of items) {
      const candidateKey = `${candidate.type}:${candidate.number}`;
      if (visited.has(candidateKey)) {
        continue;
      }

      const similarity = cosineSimilarity(item.embedding, candidate.embedding);
      if (similarity >= threshold) {
        members.push(candidate);
        visited.add(candidateKey);
      }
    }

    clusters.push({ anchor: item, members });
  }

  return clusters.filter((cluster) => cluster.members.length > 1);
}
