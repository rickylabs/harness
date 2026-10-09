import { duplicateValues, issueNumber, type JsonRecord, nonEmpty, oneOf, records, strings } from '../json.ts';
import { EDGE_KINDS } from './vocabulary.ts';

export function validateDag(
  errors: string[],
  dag: JsonRecord,
  activeIssues: JsonRecord[],
): void {
  if (dag.schemaVersion !== 1) errors.push('dag.schemaVersion must be 1');
  const nodes = records(dag.nodes);
  const edges = records(dag.edges);
  const waves = records(dag.waves);
  const nodeIds = nodes.map((node) => node.id).filter(nonEmpty);
  for (const duplicate of duplicateValues(nodeIds)) {
    errors.push(`DAG node ${duplicate} is duplicated`);
  }
  const nodeSet = new Set(nodeIds);
  const activeNumbers = activeIssues.map((issue) => issue.number).filter(issueNumber);
  const activeNumberSet = new Set(activeNumbers);

  for (const node of nodes) {
    if (node.kind === 'issue') {
      if (!issueNumber(node.issueNumber) || !activeNumberSet.has(node.issueNumber)) {
        errors.push(`DAG issue node ${String(node.id)} has no active inventory backing`);
      }
      if (node.id !== `issue:${String(node.issueNumber)}`) {
        errors.push(`DAG issue node ${String(node.id)} has an inconsistent issueNumber`);
      }
    } else if (!oneOf(node.kind, ['rfc', 'external'] as const)) {
      errors.push(`DAG node ${String(node.id)} has an invalid kind`);
    }
  }

  for (const number of activeNumbers) {
    const matches = nodes.filter((node) =>
      node.id === `issue:${number}` && node.issueNumber === number
    );
    if (matches.length !== 1) {
      errors.push(`active issue #${number} must appear exactly once in the DAG`);
    }
  }

  const waveByNode = new Map<string, number>();
  for (const wave of waves) {
    if (!Number.isInteger(wave.index) || (wave.index as number) < 0) {
      errors.push('every DAG wave needs a non-negative integer index');
      continue;
    }
    for (const id of strings(wave.nodeIds)) {
      if (!nodeSet.has(id)) errors.push(`DAG wave references missing node ${id}`);
      if (waveByNode.has(id)) errors.push(`DAG node ${id} appears in more than one wave`);
      waveByNode.set(id, wave.index as number);
    }
  }
  for (const id of nodeIds) {
    if (!waveByNode.has(id)) errors.push(`DAG node ${id} is absent from waves`);
  }

  const adjacency = new Map(nodeIds.map((id) => [id, [] as string[]]));
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    const from = edge.from;
    const to = edge.to;
    if (!oneOf(edge.kind, EDGE_KINDS)) errors.push('DAG edge has an invalid kind');
    if (!nonEmpty(from) || !nodeSet.has(from) || !nonEmpty(to) || !nodeSet.has(to)) {
      errors.push('DAG edge references a missing node');
      continue;
    }
    if (from === to) errors.push(`DAG edge ${from} -> ${to} is self-referential`);
    adjacency.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
    const fromWave = waveByNode.get(from);
    const toWave = waveByNode.get(to);
    if (fromWave !== undefined && toWave !== undefined && fromWave >= toWave) {
      errors.push(`DAG dependency ${from} -> ${to} must run in an earlier wave`);
    }
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of adjacency.get(id) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (visited !== nodeIds.length) errors.push('DAG contains a cycle');
}
