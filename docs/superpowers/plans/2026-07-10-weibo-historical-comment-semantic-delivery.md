# 微博历史评论语义交付实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `docs/weibo_comments_all.xlsx` 的历史评论导入为可审计项目，完成逐条语义审阅、QA 和五表 Excel 交付。

**Architecture:** Python 导入器读取历史工作簿并写入标准任务与 JSONL 评论记录；它只继承表内的阶段、博主、链接和互动量，不补读微博正文。Node 审阅模块以评论正文、根评论和回复对象构造受字符数限制的模型批次，并在严格结果校验后由 Artifact Tool 渲染最终工作簿。Chrome 双排序测试项目保持独立，不作为本项目输入。

**Tech Stack:** Python 3.11、openpyxl（仅历史工作簿读取）、Node.js 内置测试、Codex CLI 严格输出 schema、`@oai/artifact-tool` 2.8.6+（Excel 写入与渲染验证）。

## Global Constraints

- 项目目录固定为 `output/weibo_historical_comment_semantic_2026-07-10/`，最终文件为该目录的 `delivery.xlsx`。
- 输入只允许 `docs/weibo_comments_all.xlsx` 的 `微博汇总` 和 `评论明细` 工作表；搜索语义表仅作口径参考，不加入本项目数据。
- 不补读、不显示或不生成微博正文；楼层展示按博主、微博链接、阶段和互动量分组。
- 历史导入和 `output/weibo_Qz3Tr1mPS_dual_sort_test/` 的 Chrome `partial` 测试必须隔离；不得用历史行补齐 421 条测试评论。
- 微博新评论采集继续 Chrome/model-only；不添加 MCP、API、CDP、OpenCLI 或隐藏接口回退。
- 模型只输出 `row_key`、情感、负面主题、语义依据、置信度，且不得生成来源、楼层、作者、时间或身份字段。
- 审阅批次自动同时受 80 条记录与 24,000 个字符限制；这是模型容量控制，不是人工采集分段。
- 负面主题只允许：产品体验、质量问题、售后服务、价格质疑、营销反感、品牌嘲讽、功能问题、内容质疑、其他负面；正面/中性必须为空字符串。
- 仅在导入、审阅、严格 QA 和抽样文件都完成时生成正式 `delivery.xlsx`。
- 所有 Excel 写入和渲染使用 `@oai/artifact-tool`；不得用 openpyxl、xlsxwriter 或 pandas 写入工作簿。
- 每个实现任务都先运行指定的失败测试，再作最小实现，最后运行指定的绿色测试并独立提交。

---

## File Structure

- Create `src/pipeline/import_weibo_comment_history.py`: 只读导入历史微博工作簿，产生任务、规范 JSONL、导入清单和缺失字段统计。
- Create `test/pipeline/test_import_weibo_comment_history.py`: 覆盖空白继承、楼层上下文、稳定键、重复行和不补正文的契约。
- Modify `src/normalize/prepare-comment-ai-review.js`: 以记录数和字符数双上限构造审阅批次，并保留二级回复上下文。
- Modify `src/normalize/run-comment-ai-review.js`: 支持只重跑没有完整结果的审阅批次。
- Create `src/normalize/validate-comment-ai-review.js` and `script/validate-comment-ai-review.js`: 校验模型输出与输入的一一对应关系及情感/主题条件。
- Modify `test/comment-ai-review.test.js`; create `test/comment-ai-review-validation.test.js`: 覆盖批次边界、恢复和严格 QA。
- Create `src/normalize/build-weibo-history-semantic-report.js`: 组合评论、审阅结果、阶段/微博/主题统计和五张表的内容模型。
- Create `script/build-weibo-history-semantic-report.mjs`: 以 Artifact Tool 写入、公式化汇总、条件格式和渲染检查工作簿。
- Create `test/weibo-history-semantic-report.test.js`: 覆盖报表模型、楼层顺序与五表合同。
- Modify `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md`, `.codex/skills/comment-excel-delivery/SKILL.md`, `.codex/skills/comment-excel-delivery/references/workflow.md`, and `test/pipeline/test_comment_excel_delivery_skill.py`: 记录历史微博语义交付命令和隔离边界。

### Task 1: 导入历史微博评论并建立审计项目

**Files:**
- Create: `src/pipeline/import_weibo_comment_history.py`
- Create: `test/pipeline/test_import_weibo_comment_history.py`

**Interfaces:**
- Consumes: `import_weibo_comment_history(input_path: str | Path, out_dir: str | Path) -> dict[str, Any]`。
- Produces: `crawl-tasks.json`、`run-manifest.json`、`runs/task_*/task.json`、`all-normalized-comments.jsonl` 和 `history-import-summary.json`。
- Produces: 每条评论含标准字段 `row_key`, `task_id`, `phase`, `platform="weibo"`, `source_url`, `post_id`, `row_type`, `comment_id=""`, `root_comment_id=""`, `parent_comment_id=""`, `user_name`, `text`, `created_at`, `ip_location`, `like_count`, `reply_to_user_name`, `root_text`, `raw`。

- [ ] **Step 1: 编写失败的导入测试**

创建 `test/pipeline/test_import_weibo_comment_history.py`。测试以 openpyxl 仅创建临时输入夹具：`微博汇总` 有一条 `https://weibo.com/1/A` 任务；`评论明细` 有一级评论和连续的二级回复，第二行阶段、博主、链接和互动量留空。断言：

```python
result = import_weibo_comment_history(workbook_path, out_dir)
self.assertEqual(result["task_count"], 1)
self.assertEqual(result["comment_count"], 2)
rows = read_jsonl(out_dir / "all-normalized-comments.jsonl")
self.assertEqual(rows[0]["row_type"], "level1")
self.assertEqual(rows[0]["root_text"], "主评论")
self.assertEqual(rows[0]["raw"]["post_text"], "")
self.assertEqual(rows[1]["row_type"], "level2")
self.assertEqual(rows[1]["source_url"], "https://weibo.com/1/A")
self.assertEqual(rows[1]["root_text"], "主评论")
self.assertEqual(rows[1]["reply_to_user_name"], "用户A")
self.assertNotEqual(rows[0]["row_key"], rows[1]["row_key"])
```

添加一行完全相同的重复一级评论，断言 `history-import-summary.json` 的 `duplicate_row_count == 1` 且 JSONL 仍只保留两条唯一记录。再添加一条没有任何可继承任务键的评论，断言 `orphan_row_count == 1`。

- [ ] **Step 2: 运行测试确认 RED**

运行：

```bash
uv run --project src/pipeline python -m unittest test/pipeline/test_import_weibo_comment_history.py
```

预期：失败，原因是 `import_weibo_comment_history` 模块不存在。

- [ ] **Step 3: 实现只读导入器**

在 `src/pipeline/import_weibo_comment_history.py` 中复用 `parse_client_requirements.py` 的 `normalize_text`、`read_number`、`extract_first_url` 和 `write_project_files`。实现以下稳定键与归一化逻辑：

```python
def build_row_key(source_url: str, floor_info: str, parent_floor: str,
                  reply_index: str, user_name: str, text: str,
                  time_location: str) -> str:
    source = "|".join([
        source_url, floor_info, parent_floor, reply_index,
        user_name, text, time_location,
    ])
    return "weibo-history::" + hashlib.sha256(source.encode("utf-8")).hexdigest()

def classify_row_type(comment_type: str) -> str:
    return "level2" if "回复" in normalize_text(comment_type) else "level1"

def parse_time_location(value: Any) -> tuple[str, str]:
    text = normalize_text(value)
    if " / " in text:
        return tuple(normalize_text(part) for part in text.split(" / ", 1))
    return text, ""
```

`read_summary_tasks` 读取 `微博汇总`，用 `(阶段, Excel行, 序号)` 映射任务；任务的 `expected_comment_count` 取 `微博评论总数`，`engagement_count` 取 `微博互动量`。`read_detail_comments` 对 `阶段、Excel行、序号、博主昵称、平台、页面链接、微博互动量` 做逐行继承；每个任务维护 `root_by_floor: dict[str, tuple[str, str]]`，一级评论写入 `(评论人, 评论内容)`，二级回复从 `父楼层` 读取根评论上下文。任何一级/二级行均将 `comment_id`、`root_comment_id`、`parent_comment_id` 留空，且 `raw["post_text"]` 永远为空字符串。

任务无法匹配时增加 `orphan_row_count` 并跳过；相同 `row_key` 时增加 `duplicate_row_count` 并跳过。写入 `history-import-summary.json`：`schema_version`, `input`, `task_count`, `comment_count`, `level1_count`, `level2_count`, `duplicate_row_count`, `orphan_row_count`, `missing_source_url_count`, `missing_text_count`。CLI 只接受：

```bash
python src/pipeline/import_weibo_comment_history.py \
  --input docs/weibo_comments_all.xlsx \
  --out-dir output/weibo_historical_comment_semantic_2026-07-10
```

- [ ] **Step 4: 运行导入测试确认 GREEN**

运行：

```bash
uv run --project src/pipeline python -m unittest test/pipeline/test_import_weibo_comment_history.py
```

预期：通过，包含空白继承、回复根上下文、重复计数、孤儿计数与不补微博正文断言。

- [ ] **Step 5: 提交 Task 1**

```bash
git add src/pipeline/import_weibo_comment_history.py test/pipeline/test_import_weibo_comment_history.py
git commit -m "feat(weibo): import historical comment workbook"
```

### Task 2: 生成可恢复的限额语义审阅并严格校验

**Files:**
- Modify: `src/normalize/prepare-comment-ai-review.js`
- Modify: `src/normalize/run-comment-ai-review.js`
- Create: `src/normalize/validate-comment-ai-review.js`
- Create: `script/validate-comment-ai-review.js`
- Modify: `test/comment-ai-review.test.js`
- Create: `test/comment-ai-review-validation.test.js`

**Interfaces:**
- Consumes: `splitReviewItems(rows, maxItems, maxChars) -> ReviewItem[][]`，其中 `ReviewItem` 为 `{row_key,row_type,user_name,text,root_text,reply_to_user_name}`。
- Produces: `validateCommentAiReview(commentRows, reviewRows) -> {status, summary, errors}`；`status` 仅为 `ok` 或 `failed`。
- Produces: `runReviewBatches({inputDir, resume: true, ...})`，仅跳过已包含预期 `row_key` 集合的 JSON 数组输出。

- [ ] **Step 1: 编写失败的批次、恢复和 QA 测试**

在 `test/comment-ai-review.test.js` 增加：

```js
test('splits review items by both item and character ceilings', () => {
  const items = [
    { row_key: 'a', text: '12345' },
    { row_key: 'b', text: '67890' },
    { row_key: 'c', text: 'abcde' }
  ];
  assert.deepEqual(prep.splitReviewItems(items, 2, 10).map(chunk => chunk.map(row => row.row_key)), [
    ['a', 'b'], ['c']
  ]);
});

test('resume mode skips only a complete review output', () => {
  const batch = { rows_file: rowsFile, prompt_file: promptFile, output_file: outputFile };
  fs.writeFileSync(rowsFile, JSON.stringify([{ row_key: 'a' }]));
  fs.writeFileSync(outputFile, JSON.stringify([{ row_key: 'a' }]));
  assert.equal(runner.isCompleteReviewOutput(batch), true);
});
```

创建 `test/comment-ai-review-validation.test.js`，用三条输入评论和三条审阅结果断言 `status == 'ok'`；再分别断言缺少 `row_key`、重复 `row_key`、未知 `sentiment`、正面仍填写 `negative_theme`、负面主题为空五种情况均为 `failed` 且在 `errors` 中有相应编码。

- [ ] **Step 2: 运行测试确认 RED**

运行：

```bash
node --test test/comment-ai-review.test.js test/comment-ai-review-validation.test.js
```

预期：失败，因为 `splitReviewItems`、`isCompleteReviewOutput` 和审阅校验器尚不存在。

- [ ] **Step 3: 实现双上限批次、断点恢复与校验器**

将 `prepare-comment-ai-review.js` 的默认值替换为：

```js
const DEFAULT_BATCH_SIZE = 80;
const DEFAULT_MAX_CHARS = 24000;

function reviewItemChars(item) {
  return [item.text, item.root_text, item.reply_to_user_name]
    .map(value => String(value || '').length)
    .reduce((sum, length) => sum + length, 0);
}

function splitReviewItems(items, maxItems, maxChars) {
  const chunks = [];
  let current = [];
  let chars = 0;
  for (const item of items) {
    const itemChars = reviewItemChars(item);
    if (current.length && (current.length >= maxItems || chars + itemChars > maxChars)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += itemChars;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
```

`parseArgs` 增加 `--max-chars`，`prepareReviewBatches` 在 manifest 记录 `max_chars`，并将模型规则明确为“历史导入没有微博正文；二级回复结合 root_text 与 reply_to_user_name；只标注当前评论”。

在 `run-comment-ai-review.js` 实现 `isCompleteReviewOutput(batch)`：读取 `rows_file` 与 `output_file`，只有二者都是数组、输出 `row_key` 无重复、输出键集合与输入键集合完全相同才返回 `true`。增加 `--resume`；启用时在 `runReviewBatches` 中对完整批次返回 `{status: 'skipped', outputFile}`，否则调用现有 `runOneBatch`。

新校验器的核心实现为：

```js
const SENTIMENTS = new Set(['负面', '正面', '中性']);
const THEMES = new Set(['', '产品体验', '质量问题', '售后服务', '价格质疑', '营销反感', '品牌嘲讽', '功能问题', '内容质疑', '其他负面']);

function validateCommentAiReview(commentRows, reviewRows) {
  const errors = [];
  const expected = new Set(commentRows.filter(row => row.row_key && row.text).map(row => String(row.row_key)));
  const seen = new Set();
  for (const row of reviewRows) {
    const key = String(row?.row_key || '');
    if (!key || !expected.has(key)) errors.push({ code: 'unexpected_row_key', row_key: key });
    if (seen.has(key)) errors.push({ code: 'duplicate_row_key', row_key: key });
    seen.add(key);
    if (!SENTIMENTS.has(row?.sentiment)) errors.push({ code: 'invalid_sentiment', row_key: key });
    if (!THEMES.has(row?.negative_theme)) errors.push({ code: 'invalid_negative_theme', row_key: key });
    if (row?.sentiment !== '负面' && row?.negative_theme !== '') errors.push({ code: 'theme_requires_negative', row_key: key });
    if (row?.sentiment === '负面' && !row?.negative_theme) errors.push({ code: 'missing_negative_theme', row_key: key });
  }
  for (const key of expected) if (!seen.has(key)) errors.push({ code: 'missing_row_key', row_key: key });
  return { status: errors.length ? 'failed' : 'ok', summary: { expected_count: expected.size, review_count: reviewRows.length, error_count: errors.length }, errors };
}
```

CLI 接受 `--comments`, `--ai-review`, `--out`，读取现有 JSONL/manifest 审阅输出，写入 `semantic-qa-summary.json` 并在 `failed` 时设置非零退出码。

- [ ] **Step 4: 运行审阅测试确认 GREEN**

运行：

```bash
node --test test/comment-ai-review.test.js test/comment-ai-review-validation.test.js
```

预期：通过；80 条/24,000 字双阈值、根评论上下文、恢复跳过及五种非法输出均得到验证。

- [ ] **Step 5: 提交 Task 2**

```bash
git add src/normalize/prepare-comment-ai-review.js src/normalize/run-comment-ai-review.js src/normalize/validate-comment-ai-review.js script/validate-comment-ai-review.js test/comment-ai-review.test.js test/comment-ai-review-validation.test.js
git commit -m "feat(weibo): validate historical comment reviews"
```

### Task 3: 建立微博语义报表内容模型

**Files:**
- Create: `src/normalize/build-weibo-history-semantic-report.js`
- Create: `test/weibo-history-semantic-report.test.js`

**Interfaces:**
- Consumes: `buildWeiboHistoryReportModel(commentRows, reviewRows) -> ReportModel`。
- Produces: `ReportModel.summary`, `ReportModel.phaseRows`, `ReportModel.postRows`, `ReportModel.themeRows`, `ReportModel.floorRows`, `ReportModel.negativeRows`, `ReportModel.positiveRows`, `ReportModel.detailRows`。
- Produces: 逻辑工作表名严格为 `总结`, `按帖子楼层展示`, `负面评论`, `正面评论`, `全部评论语义明细`。

- [ ] **Step 1: 编写失败的报表内容测试**

创建 `test/weibo-history-semantic-report.test.js`，使用一条一级正面评论、其一条二级负面回复和另一条中性一级评论：

```js
const model = report.buildWeiboHistoryReportModel(comments, reviews);
assert.deepEqual(model.sheetNames, ['总结', '按帖子楼层展示', '负面评论', '正面评论', '全部评论语义明细']);
assert.equal(model.summary.total_comments, 3);
assert.equal(model.summary.level1_comments, 2);
assert.equal(model.summary.level2_replies, 1);
assert.equal(model.summary.negative_comments, 1);
assert.equal(model.summary.negative_rate, 1 / 3);
assert.equal(model.floorRows[0].record_type, 'post_header');
assert.match(model.floorRows[0].post_title, /博主：博主A/);
assert.equal(model.floorRows[2].display_text, '↳ 售后没人处理');
assert.equal(model.negativeRows[0].negative_theme, '售后服务');
assert.equal(model.positiveRows[0].sentiment, '正面');
```

追加断言：`post_title` 不包含“微博正文”，二级回复的 `root_text` 保留一级评论文本，按 `phase + source_url + source_row` 排序不会把回复移到其他微博。

- [ ] **Step 2: 运行测试确认 RED**

运行：

```bash
node --test test/weibo-history-semantic-report.test.js
```

预期：失败，因为报表内容模块不存在。

- [ ] **Step 3: 实现确定性内容模型**

创建模块并复用 `build-comment-excel-report.js` 的 `readJsonl` 与 `readAiReviewRows`，但不要复用其四表通用布局。模型合并时要求每条评论都有审阅；否则抛出 `Error('语义审阅未覆盖全部评论')`。核心分组键与标题：

```js
function postGroupKey(row) {
  return [row.phase, row.source_url, row.source_excel_row, row.source_index].join('|');
}

function postTitle(row) {
  return `博主：${row.creator_name || '未提供'}｜阶段：${row.phase || '未提供'}｜互动量：${Number(row.source_engagement_count || 0)}｜链接：${row.source_url}`;
}

function displayText(row) {
  return row.row_type === 'level2' ? `↳ ${row.text}` : row.text;
}
```

`floorRows` 先写一行 `{record_type:'post_header', post_title}`，随后按照原始导入顺序写评论；每行有 `record_type`, `row_type`, `display_text`, `created_at`, `user_name`, `reply_to_user_name`, `like_count`, `sentiment`, `negative_theme`, `reason`, `confidence`, `row_key`。`detailRows` 保留所有导入字段、`raw.source_row` 和审阅字段。`phaseRows`、`postRows` 与 `themeRows` 的计数由同一合并记录按阶段、分组键与负面主题聚合，排序规则分别为名称、阶段后 URL、负面数降序后主题名称。

- [ ] **Step 4: 运行报表内容测试确认 GREEN**

运行：

```bash
node --test test/weibo-history-semantic-report.test.js
```

预期：通过，五表合同、楼层标题、回复缩进、情感过滤和统计均可复现。

- [ ] **Step 5: 提交 Task 3**

```bash
git add src/normalize/build-weibo-history-semantic-report.js test/weibo-history-semantic-report.test.js
git commit -m "feat(weibo): model historical semantic report"
```

### Task 4: 使用 Artifact Tool 生成并验证五表 Excel

**Files:**
- Create: `script/build-weibo-history-semantic-report.mjs`
- Modify: `test/weibo-history-semantic-report.test.js`

**Interfaces:**
- Consumes: `--comments output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl --ai-review output/weibo_historical_comment_semantic_2026-07-10/ai-review-input --qa output/weibo_historical_comment_semantic_2026-07-10/semantic-qa-summary.json --out output/weibo_historical_comment_semantic_2026-07-10/delivery.xlsx`。
- Produces: 只在 `qa.status === 'ok'` 时输出五张表的 `.xlsx`；否则以错误 `语义 QA 未通过，拒绝生成正式 delivery.xlsx` 终止。
- Produces: 在同一输出目录生成 `delivery-preview-总结.png`、`delivery-preview-按帖子楼层展示.png`、`delivery-preview-负面评论.png`、`delivery-preview-正面评论.png`、`delivery-preview-全部评论语义明细.png`，用于视觉验收，不进入 Git。

- [ ] **Step 1: 编写失败的 CLI 门禁与导出测试**

在 `test/weibo-history-semantic-report.test.js` 增加两个子测试。第一个写入 `{status:'failed'}` QA 文件并断言：

```js
const result = spawnSync(process.execPath, [
  'script/build-weibo-history-semantic-report.mjs',
  '--comments', comments, '--ai-review', reviews, '--qa', failedQa, '--out', out
], { cwd: projectRoot, encoding: 'utf8' });
assert.notEqual(result.status, 0);
assert.match(result.stderr, /语义 QA 未通过/);
```

第二个写入 `{status:'ok'}` 和一条正面、一条负面审阅结果，断言零退出码、文件存在，并使用 `FileBlob.load`/`SpreadsheetFile.importXlsx` 检查工作表顺序完全为五张合同表。此测试在执行前使用以下一次性运行时依赖准备命令：

```bash
[ -e node_modules ] || ln -s /Users/gyp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node_modules
```

- [ ] **Step 2: 运行测试确认 RED**

运行：

```bash
[ -e node_modules ] || ln -s /Users/gyp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node_modules
/Users/gyp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/weibo-history-semantic-report.test.js
```

预期：失败，因为 Artifact Tool CLI 渲染器不存在。

- [ ] **Step 3: 实现工作簿渲染器**

在 `.mjs` 中以 `createRequire` 导入 Task 3 的 CommonJS 内容模型，并以 Artifact Tool 建表：

```js
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const require = createRequire(import.meta.url);
const modelBuilder = require('../src/normalize/build-weibo-history-semantic-report.js');

function assertQaOk(qa) {
  if (qa?.status !== 'ok') throw new Error('语义 QA 未通过，拒绝生成正式 delivery.xlsx');
}

function applyHeader(range) {
  range.format = {
    fill: '#1F4E78', font: { bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true,
    borders: { preset: 'outside', style: 'thin', color: '#9FBAD0' },
  };
}
```

创建全部五张工作表后，再写 `总结` 公式；明细数据范围使用确定的末行，绝不使用整列引用。例如 `全部评论语义明细` 的 `row_key` 在 A 列、层级在 H 列、情感在 N 列、负面主题在 O 列时：

```js
summary.getRange('B4').formulas = [[`=COUNTA('全部评论语义明细'!$A$2:$A$${detailLastRow})`]];
summary.getRange('B5').formulas = [[`=COUNTIF('全部评论语义明细'!$H$2:$H$${detailLastRow},"level1")`]];
summary.getRange('B6').formulas = [[`=COUNTIF('全部评论语义明细'!$H$2:$H$${detailLastRow},"level2")`]];
summary.getRange('B9').formulas = [[`=IFERROR(B8/B4,0)`]];
```

`按帖子楼层展示` 的帖子标题行合并 `A:K`，浅蓝底并加粗；评论表头冻结在首行。对包含评论的整行添加条件格式：情感列等于 `负面` 时为浅红底深红字，等于 `正面` 时为浅绿底深绿字。所有数据表设置冻结首行、自动筛选、合理列宽与换行；隐藏网格线。`总结` 将阶段、微博和负面主题统计分区摆放并使用同一细节表的带界限 `COUNTIFS` 公式。写出每张表的 `workbook.render` PNG，再用 `SpreadsheetFile.exportXlsx` 保存正式文件。

- [ ] **Step 4: 运行导出测试确认 GREEN**

运行：

```bash
/Users/gyp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/weibo-history-semantic-report.test.js
```

预期：通过。失败 QA 不产出文件；成功 QA 生成五张表和可导入的 xlsx。

- [ ] **Step 5: 提交 Task 4**

```bash
git add script/build-weibo-history-semantic-report.mjs test/weibo-history-semantic-report.test.js
git commit -m "feat(weibo): render historical semantic delivery"
```

### Task 5: 更新交付合同并运行真实历史数据

**Files:**
- Modify: `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md`
- Modify: `.codex/skills/comment-excel-delivery/SKILL.md`
- Modify: `.codex/skills/comment-excel-delivery/references/workflow.md`
- Modify: `test/pipeline/test_comment_excel_delivery_skill.py`
- Create at runtime, ignored: `output/weibo_historical_comment_semantic_2026-07-10/`

**Interfaces:**
- Consumes: 本计划 Task 1–4 的 CLI 产物。
- Produces: `history-import-summary.json`, `ai-review-input/`, `semantic-qa-summary.json`, `qa-sample.jsonl`, `delivery.xlsx` 与五张 PNG 预览。

- [ ] **Step 1: 编写失败的文档合同测试**

在 `test/pipeline/test_comment_excel_delivery_skill.py` 断言交付技能和规则文件同时出现：`weibo_comments_all.xlsx`、`import_weibo_comment_history.py`、`validate-comment-ai-review.js`、`build-weibo-history-semantic-report.mjs`、`历史导入`、`按帖子楼层展示`、`不补读历史微博正文`，并继续断言 Weibo 评论没有 `MCP/API fallback`。

- [ ] **Step 2: 运行测试确认 RED**

运行：

```bash
uv run --project src/pipeline python -m unittest test/pipeline/test_comment_excel_delivery_skill.py
```

预期：失败，因为历史导入语义交付流程尚未写入合同文档。

- [ ] **Step 3: 更新规则和技能文档**

在三个文档中加入相同的历史交付顺序：导入历史 Excel → 自动限额审阅 → Codex 严格 schema 输出 → 校验 → 生成抽样 QA → 生成五表交付。明确它是已有历史数据分析，不替代 Chrome/model-only 新评论采集；不调用 Chrome、接口或其他来源补读微博正文；当前 Chrome `partial` 项目不得并入。

- [ ] **Step 4: 运行文档测试确认 GREEN**

运行：

```bash
uv run --project src/pipeline python -m unittest test/pipeline/test_comment_excel_delivery_skill.py
```

预期：通过，且规则保留 Weibo 无 MCP/API 回退约束。

- [ ] **Step 5: 执行真实导入、审阅、QA 与交付**

按顺序运行，任何命令非零退出时先修复对应任务，不跳过校验：

```bash
uv run --project src/pipeline python src/pipeline/import_weibo_comment_history.py \
  --input docs/weibo_comments_all.xlsx \
  --out-dir output/weibo_historical_comment_semantic_2026-07-10

node script/prepare-comment-ai-review.js \
  --input output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl \
  --out-dir output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --batch-size 80 \
  --max-chars 24000

node script/run-comment-ai-review.js \
  --input-dir output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --cwd /Users/gyp/Documents/demo \
  --resume

node script/validate-comment-ai-review.js \
  --comments output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl \
  --ai-review output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --out output/weibo_historical_comment_semantic_2026-07-10/semantic-qa-summary.json

node script/build-comment-qa-sample.js \
  --comments output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl \
  --ai-review output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --sample-size 60 \
  --out output/weibo_historical_comment_semantic_2026-07-10/qa-sample.jsonl

/Users/gyp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  script/build-weibo-history-semantic-report.mjs \
  --comments output/weibo_historical_comment_semantic_2026-07-10/all-normalized-comments.jsonl \
  --ai-review output/weibo_historical_comment_semantic_2026-07-10/ai-review-input \
  --qa output/weibo_historical_comment_semantic_2026-07-10/semantic-qa-summary.json \
  --out output/weibo_historical_comment_semantic_2026-07-10/delivery.xlsx
```

检查 `semantic-qa-summary.json` 的 `status == "ok"`、`expected_count == review_count`、`error_count == 0`；检查 QA 抽样文件有 60 条或输入不足 60 条时等于输入条数。用 Artifact Tool 逐张渲染五个工作表，确认标题、表头、中文、公式结果与红绿条件格式不截断。

- [ ] **Step 6: 运行完整回归并提交 Task 5**

运行：

```bash
/Users/gyp/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-reporter=dot test/*.test.js
uv run --project src/pipeline python -m unittest discover -s test/pipeline
git diff --check
```

预期：Node、Python 与格式检查均通过。随后仅提交源码、测试与文档，不提交 `output/`、预览图或用户输入 Excel：

```bash
git add docs/tcl_weibo_comment_workflow_rules_2026-07-07.md .codex/skills/comment-excel-delivery/SKILL.md .codex/skills/comment-excel-delivery/references/workflow.md test/pipeline/test_comment_excel_delivery_skill.py
git commit -m "docs(weibo): document historical semantic delivery"
```
