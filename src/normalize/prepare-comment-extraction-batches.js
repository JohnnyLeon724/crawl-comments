#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_CANDIDATES = 80;
const DEFAULT_MAX_TEXT_CHARS = 24000;

function printUsage() {
  console.log(`
用法：
  node script/prepare-comment-extraction-batches.js --task-dir output/project/runs/task_0001

参数：
  --task-dir        必填，包含 batches/capture_*/comment-dom-batch.json 的任务目录
  --max-candidates  可选，每个模型批次最多候选数，默认 80
  --max-text-chars  可选，每个模型批次最多候选文本字符数，默认 24000
  --help            查看帮助
`.trim());
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 需要一个值`);
  }
  return value;
}

function parsePositiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    taskDir: '',
    maxCandidates: DEFAULT_MAX_CANDIDATES,
    maxTextChars: DEFAULT_MAX_TEXT_CHARS,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--task-dir') {
      args.taskDir = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--max-candidates') {
      args.maxCandidates = parsePositiveInt(readFlagValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === '--max-text-chars') {
      args.maxTextChars = parsePositiveInt(readFlagValue(argv, index, token), token);
      index += 1;
      continue;
    }
    throw new Error(`未知参数：${token}`);
  }

  if (!args.help && !args.taskDir) throw new Error('必须提供 --task-dir');
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function candidateMergeKey(candidate) {
  return String(
    candidate?.source_comment_id ||
    candidate?.source_composite_fingerprint ||
    candidate?.candidate_hash ||
    candidate?.candidate_id ||
    ''
  );
}

function candidateTextChars(candidate) {
  return String(candidate?.inner_text || '').length;
}

function shouldStartNewBatch(current, candidate, limits) {
  return current.candidates.length > 0 && (
    current.candidates.length >= limits.maxCandidates ||
    current.textChars + candidateTextChars(candidate) > limits.maxTextChars
  );
}

function uniqueSortedStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))].sort();
}

function sourceCaptureBatchIds(candidate, captureBatchId) {
  const existing = Array.isArray(candidate?.source_capture_batch_ids)
    ? candidate.source_capture_batch_ids
    : [];
  return uniqueSortedStrings([...existing, captureBatchId]);
}

function readCaptureBatches(taskDir) {
  const batchesDir = path.join(taskDir, 'batches');
  if (!fs.existsSync(batchesDir)) return [];

  return fs.readdirSync(batchesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => {
      const filePath = path.join(batchesDir, entry.name, 'comment-dom-batch.json');
      if (!fs.existsSync(filePath)) return null;
      return { directoryName: entry.name, filePath, batch: readJson(filePath) };
    })
    .filter(item => item && item.batch?.batch_kind === 'capture');
}

function mergeCaptureCandidates(captureBatches) {
  const candidates = new Map();
  let captureCandidateCount = 0;

  for (const capture of captureBatches) {
    const captureBatchId = String(capture.batch.batch_id || capture.directoryName);
    const sourceCandidates = Array.isArray(capture.batch.candidates) ? capture.batch.candidates : [];

    for (const rawCandidate of sourceCandidates) {
      captureCandidateCount += 1;
      const key = candidateMergeKey(rawCandidate);
      if (!key) continue;
      const existing = candidates.get(key);
      const captureIds = sourceCaptureBatchIds(rawCandidate, captureBatchId);

      if (existing) {
        existing.source_capture_batch_ids = uniqueSortedStrings([
          ...existing.source_capture_batch_ids,
          ...captureIds
        ]);
        continue;
      }

      const candidate = Object.assign({}, rawCandidate, {
        source_capture_batch_ids: captureIds
      });
      candidates.set(key, candidate);
    }
  }

  return {
    captureCandidateCount,
    candidates: [...candidates.values()]
  };
}

function chunkCandidates(candidates, limits) {
  const chunks = [];
  let current = { candidates: [], textChars: 0 };

  for (const candidate of candidates) {
    if (shouldStartNewBatch(current, candidate, limits)) {
      chunks.push(current);
      current = { candidates: [], textChars: 0 };
    }
    current.candidates.push(candidate);
    current.textChars += candidateTextChars(candidate);
  }

  if (current.candidates.length > 0) chunks.push(current);
  return chunks;
}

function countIdentityModes(candidates) {
  const counts = {};
  for (const candidate of candidates) {
    const identityMode = String(candidate?.identity_mode || 'unknown');
    counts[identityMode] = (counts[identityMode] || 0) + 1;
  }
  return counts;
}

function clearModelBatchDirectories(batchesDir) {
  if (!fs.existsSync(batchesDir)) return;
  for (const entry of fs.readdirSync(batchesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && /^model_\d+$/.test(entry.name)) {
      fs.rmSync(path.join(batchesDir, entry.name), { recursive: true, force: true });
    }
  }
}

function buildModelBatch(chunk, index, source) {
  const batchId = `model_${String(index + 1).padStart(3, '0')}`;
  return {
    schema_version: 'comment-dom-batch-v1',
    batch_id: batchId,
    task_id: String(source?.task_id || ''),
    platform: String(source?.platform || 'unknown'),
    batch_kind: 'model',
    source_url: String(source?.source_url || ''),
    captured_at: String(source?.captured_at || ''),
    scroll: Object.assign({
      before_top: 0,
      after_top: 0,
      viewport_height: 0,
      document_height: 0
    }, source?.scroll || {}),
    state: {
      new_candidate_count: chunk.candidates.length,
      seen_candidate_count: chunk.candidates.length,
      has_more: false,
      stop_reason: 'model_batch_prepared'
    },
    limits: {
      maxCandidates: DEFAULT_MAX_CANDIDATES,
      maxCharsPerCandidate: Number(source?.limits?.maxCharsPerCandidate) || 8000
    },
    candidates: chunk.candidates
  };
}

function prepareModelBatches(args) {
  const taskDir = path.resolve(String(args?.taskDir || ''));
  if (!taskDir) throw new Error('taskDir is required');
  const limits = {
    maxCandidates: parsePositiveInt(args?.maxCandidates ?? DEFAULT_MAX_CANDIDATES, 'maxCandidates'),
    maxTextChars: parsePositiveInt(args?.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS, 'maxTextChars')
  };
  const captureBatches = readCaptureBatches(taskDir);
  const merged = mergeCaptureCandidates(captureBatches);
  const chunks = chunkCandidates(merged.candidates, limits);
  const batchesDir = path.join(taskDir, 'batches');
  const source = captureBatches[0]?.batch || {};

  clearModelBatchDirectories(batchesDir);
  const modelBatchPaths = chunks.map((chunk, index) => {
    const batch = buildModelBatch(chunk, index, source);
    batch.limits.maxCandidates = limits.maxCandidates;
    const batchPath = path.join(batchesDir, batch.batch_id, 'comment-dom-batch.json');
    writeJson(batchPath, batch);
    return batchPath;
  });

  const sourceCaptureBatchIds = uniqueSortedStrings(captureBatches.map(capture => (
    capture.batch.batch_id || capture.directoryName
  )));
  const manifestPath = path.join(taskDir, 'model-batch-manifest.json');
  const manifest = {
    schema_version: 'comment-model-batch-manifest-v1',
    task_dir: taskDir,
    limits,
    capture_batch_count: captureBatches.length,
    capture_candidate_count: merged.captureCandidateCount,
    unique_candidate_count: merged.candidates.length,
    model_batch_count: modelBatchPaths.length,
    source_capture_batch_ids: sourceCaptureBatchIds,
    identity_mode_counts: countIdentityModes(merged.candidates),
    model_batch_paths: modelBatchPaths,
    batches: chunks.map((chunk, index) => ({
      batch_id: `model_${String(index + 1).padStart(3, '0')}`,
      candidate_count: chunk.candidates.length,
      text_char_count: chunk.textChars,
      source_capture_batch_ids: uniqueSortedStrings(chunk.candidates.flatMap(candidate => (
        candidate.source_capture_batch_ids || []
      ))),
      identity_mode_counts: countIdentityModes(chunk.candidates),
      output_path: modelBatchPaths[index]
    }))
  };
  writeJson(manifestPath, manifest);

  return {
    status: 'success',
    taskDir,
    captureBatchCount: captureBatches.length,
    captureCandidateCount: merged.captureCandidateCount,
    uniqueCandidateCount: merged.candidates.length,
    modelBatchCount: modelBatchPaths.length,
    modelBatchPaths,
    manifestPath
  };
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
    return null;
  }
  if (args.help) {
    printUsage();
    return null;
  }
  const result = prepareModelBatches(args);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_CANDIDATES,
  DEFAULT_MAX_TEXT_CHARS,
  parseArgs,
  candidateMergeKey,
  shouldStartNewBatch,
  readCaptureBatches,
  mergeCaptureCandidates,
  chunkCandidates,
  prepareModelBatches,
  main
};
