#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createModelOutputSchema } = require('./model-output-schema.js');

const DEFAULT_CODEX_BIN = [
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex'
].find(fs.existsSync) || '/Applications/Codex.app/Contents/Resources/codex';

function printUsage() {
  console.log(`
用法：
  node script/run-comment-ai-review.js --input-dir ai-review-input

参数：
  --input-dir   必填，prepare-comment-ai-review 生成的目录
  --codex-bin   可选，Codex CLI 路径
  --schema      可选，输出 schema 路径
  --cwd         可选，Codex 执行工作目录，默认当前目录
  --dry-run     可选，只打印命令，不调用模型
  --resume      可选，只跳过 row_key 集合完整匹配的已有输出
  --help        查看帮助
`.trim());
}

function readFlagValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 需要一个值`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    inputDir: '',
    codexBin: DEFAULT_CODEX_BIN,
    schemaPath: path.join(process.cwd(), 'schemas/comment-ai-review.schema.json'),
    cwd: process.cwd(),
    dryRun: false,
    resume: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    if (token === '--resume') {
      args.resume = true;
      continue;
    }

    if (token === '--input-dir') {
      args.inputDir = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--codex-bin') {
      args.codexBin = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--schema') {
      args.schemaPath = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    if (token === '--cwd') {
      args.cwd = readFlagValue(argv, i, token);
      i += 1;
      continue;
    }

    throw new Error(`未知参数：${token}`);
  }

  if (args.help) return args;
  if (!args.inputDir) throw new Error('必须提供 --input-dir');

  return args;
}

function readManifest(inputDir) {
  return JSON.parse(fs.readFileSync(path.join(inputDir, 'manifest.json'), 'utf8'));
}

function createReviewModelOutputSchema(canonicalSchema) {
  return {
    $schema: canonicalSchema.$schema,
    title: 'Comment AI Review Model Output',
    type: 'object',
    additionalProperties: false,
    required: ['results'],
    properties: {
      results: createModelOutputSchema(canonicalSchema)
    }
  };
}

function writeReviewModelOutputSchema(canonicalPath, outputPath) {
  const canonicalSchema = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  const modelSchema = createReviewModelOutputSchema(canonicalSchema);
  fs.writeFileSync(outputPath, `${JSON.stringify(modelSchema, null, 2)}\n`);
  return modelSchema;
}

function buildCodexExecCommand(options) {
  return {
    command: options.codexBin,
    args: [
      'exec',
      '--skip-git-repo-check',
      '--cd',
      options.cwd,
      '--sandbox',
      'read-only',
      '--output-schema',
      options.schemaPath,
      '-o',
      options.outputFile,
      '-'
    ]
  };
}

function runOneBatch(batch, options) {
  const prompt = fs.readFileSync(batch.prompt_file, 'utf8');
  const command = buildCodexExecCommand({
    codexBin: options.codexBin,
    cwd: options.cwd,
    schemaPath: options.schemaPath,
    outputFile: batch.output_file
  });

  if (options.dryRun) {
    return {
      status: 'dry-run',
      command
    };
  }

  const result = spawnSync(command.command, command.args, {
    input: prompt,
    encoding: 'utf8',
    cwd: options.cwd
  });

  if (result.status !== 0) {
    return {
      status: 'failed',
      command,
      exitCode: result.status,
      stderr: result.stderr || '',
      stdout: result.stdout || ''
    };
  }

  return {
    status: 'success',
    command,
    outputFile: batch.output_file
  };
}

function readJsonArray(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function readReviewOutputRows(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.results) ? parsed.results : null;
  } catch (_error) {
    return null;
  }
}

function isCompleteReviewOutput(batch) {
  const inputRows = readJsonArray(batch.rows_file);
  const outputRows = readReviewOutputRows(batch.output_file);
  if (!inputRows || !outputRows) return false;

  const expectedKeys = inputRows.map(row => String(row?.row_key || ''));
  const actualKeys = outputRows.map(row => String(row?.row_key || ''));
  if (expectedKeys.some(key => !key) || actualKeys.some(key => !key)) return false;
  if (new Set(expectedKeys).size !== expectedKeys.length) return false;
  if (new Set(actualKeys).size !== actualKeys.length) return false;
  if (expectedKeys.length !== actualKeys.length) return false;

  const expected = new Set(expectedKeys);
  return actualKeys.every(key => expected.has(key));
}

function runReviewBatches(args) {
  const manifest = readManifest(args.inputDir);
  const modelSchemaPath = path.join(args.inputDir, 'model-output-schema.json');
  writeReviewModelOutputSchema(args.schemaPath, modelSchemaPath);
  const modelOptions = Object.assign({}, args, { schemaPath: modelSchemaPath });
  const results = manifest.batches.map(batch => {
    if (args.resume && isCompleteReviewOutput(batch)) {
      return { status: 'skipped', outputFile: batch.output_file };
    }
    return runOneBatch(batch, modelOptions);
  });
  const failedCount = results.filter(result => result.status === 'failed').length;

  return {
    status: failedCount > 0 ? 'failed' : 'success',
    inputDir: args.inputDir,
    modelSchemaPath,
    batchCount: results.length,
    failedCount,
    results
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

  const result = runReviewBatches(args);
  console.log(JSON.stringify(result, null, 2));

  if (result.status === 'failed') {
    process.exitCode = 1;
  }

  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_CODEX_BIN,
  parseArgs,
  readManifest,
  createReviewModelOutputSchema,
  writeReviewModelOutputSchema,
  buildCodexExecCommand,
  runOneBatch,
  readReviewOutputRows,
  isCompleteReviewOutput,
  runReviewBatches,
  main
};
