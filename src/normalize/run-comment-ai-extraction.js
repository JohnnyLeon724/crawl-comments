#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeModelOutputSchema } = require('./model-output-schema.js');

const DEFAULT_CODEX_BIN = [
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex'
].find(fs.existsSync) || '/Applications/Codex.app/Contents/Resources/codex';

const DEFAULT_SCHEMA_PATH = path.join(process.cwd(), 'schemas', 'ai-comment-extraction.schema.json');
const PROMPT_TEMPLATE_PATH = path.join(__dirname, '..', '..', 'prompts', 'comment-candidate-batch-extraction.md');

function printUsage() {
  console.log(`
用法：
  node script/run-comment-ai-extraction.js --task-dir output/project/runs/task_0001

参数：
  --task-dir    必填，包含 batches/model_*/comment-dom-batch.json 的任务目录
  --codex-bin   可选，Codex CLI 路径
  --schema      可选，canonical extraction schema 路径
  --cwd         可选，Codex 执行工作目录，默认当前目录
  --dry-run     可选，只打印命令，不调用模型
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
    taskDir: '',
    codexBin: DEFAULT_CODEX_BIN,
    schemaPath: DEFAULT_SCHEMA_PATH,
    cwd: process.cwd(),
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--task-dir') {
      args.taskDir = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--codex-bin') {
      args.codexBin = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--schema') {
      args.schemaPath = readFlagValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === '--cwd') {
      args.cwd = readFlagValue(argv, index, token);
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

function readModelBatches(taskDir) {
  const batchesDir = path.join(taskDir, 'batches');
  if (!fs.existsSync(batchesDir)) return [];

  return fs.readdirSync(batchesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => {
      const batchPath = path.join(batchesDir, entry.name, 'comment-dom-batch.json');
      if (!fs.existsSync(batchPath)) return null;
      const batch = readJson(batchPath);
      return { batchPath, batchDir: path.dirname(batchPath), batch };
    })
    .filter(record => record && record.batch?.batch_kind === 'model');
}

function buildExtractionPrompt(batch, template = fs.readFileSync(PROMPT_TEMPLATE_PATH, 'utf8')) {
  return `${template.trim()}\n\n## 当前模型批次\n\n以下是唯一允许提取的完整 \`comment-dom-batch-v1\` 输入；不得访问 URL、浏览器或其他来源。\n\n\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``;
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

function runOneBatch(record, options) {
  const prompt = buildExtractionPrompt(record.batch);
  const outputFile = path.join(record.batchDir, 'ai-comment-extraction.json');
  const command = buildCodexExecCommand({
    codexBin: options.codexBin,
    cwd: options.cwd,
    schemaPath: options.schemaPath,
    outputFile
  });

  if (options.dryRun) {
    return { status: 'dry-run', batchId: record.batch.batch_id, outputFile, prompt, command };
  }

  const result = spawnSync(command.command, command.args, {
    input: prompt,
    encoding: 'utf8',
    cwd: options.cwd
  });

  if (result.status !== 0) {
    return {
      status: 'failed',
      batchId: record.batch.batch_id,
      outputFile,
      prompt,
      command,
      exitCode: result.status,
      stderr: result.stderr || '',
      stdout: result.stdout || ''
    };
  }

  return { status: 'success', batchId: record.batch.batch_id, outputFile, prompt, command };
}

function runExtractionBatches(args) {
  if (!args?.taskDir) throw new Error('taskDir is required');

  const options = Object.assign({
    codexBin: DEFAULT_CODEX_BIN,
    schemaPath: DEFAULT_SCHEMA_PATH,
    cwd: process.cwd(),
    dryRun: false
  }, args, { taskDir: path.resolve(args.taskDir) });
  const modelSchemaPath = path.join(options.taskDir, 'model-output-schema.json');
  writeModelOutputSchema(options.schemaPath, modelSchemaPath);

  const modelOptions = Object.assign({}, options, { schemaPath: modelSchemaPath });
  const results = readModelBatches(options.taskDir).map(record => runOneBatch(record, modelOptions));
  const failedCount = results.filter(result => result.status === 'failed').length;

  return {
    status: failedCount > 0 ? 'failed' : 'success',
    taskDir: options.taskDir,
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

  const result = runExtractionBatches(args);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'failed') process.exitCode = 1;
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
  DEFAULT_SCHEMA_PATH,
  parseArgs,
  readModelBatches,
  buildExtractionPrompt,
  buildCodexExecCommand,
  runOneBatch,
  runExtractionBatches,
  main
};
