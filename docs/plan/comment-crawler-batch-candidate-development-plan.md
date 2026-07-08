# 评论采集 Batch Candidate 架构开发计划书

更新时间：2026-07-08

## 1. 背景

当前项目已经完成从客户需求表到交付 Excel 的半自动流水线：

| 模块 | 已实现能力 | 主要文件 |
|---|---|---|
| 浏览器动作 | 页面展开、滚动、停止、Playwright/CDP 连接 | `src/browser/expand-comments-v1.js`、`src/browser/crawl-comments-playwright.js` |
| MCP | 当前页展开、保存 raw、保存 DOM snapshot、关闭当前 tab | `mcp/comment-crawler-tools.js`、`mcp/comment-crawler-dom-snapshot.js` |
| DOM snapshot | 整页候选 DOM chunks | `schemas/comment-dom-snapshot.schema.json` |
| AI 结构化 | 从 DOM chunks 提取评论字段 | `prompts/comment-dom-extraction.md`、`schemas/ai-comment-extraction.schema.json` |
| 归一化 | AI JSON 转标准 JSONL，并携带客户任务上下文 | `src/normalize/normalize-ai-comment-extraction.js` |
| Pipeline | 客户表解析、任务目录、合并、QA、断点续跑、Excel 生成 | `src/pipeline/*.py` |
| Skill | 固化评论 Excel 交付流程 | `.codex/skills/comment-excel-delivery/` |

当前瓶颈是：评论数量大时，`capture_current_comment_dom_snapshot` 会一次性扫描整页 DOM 并生成很多 chunks，容易达到 `maxChunks` 上限。继续上调上限会带来高 token、高延迟、AI 结构化不稳定和不可局部重跑的问题。

## 2. 目标

把评论抽取从“单任务一次性整页 DOM snapshot”升级为“单任务多批次 candidate snapshot”。

目标工作流：

```text
打开任务页面
  -> 展开当前可见评论和回复
  -> 捕获当前窗口内新增 comment candidates
  -> 保存 batch_0001/comment-dom-batch.json
  -> AI 结构化 batch_0001
  -> 归一化 batch_0001
  -> 滚动到下一窗口
  -> 重复直到无新增 candidate
  -> 合并 task 下所有 batch
  -> 项目级合并、QA、Excel
```

设计原则：

1. 单次给 AI 的内容固定上限，例如 50-100 条 candidates。
2. 批次可独立失败、独立重跑、独立 QA。
3. MCP 负责页面动作和候选提取；AI 负责语义拆字段。
4. 旧的 `comment-dom-snapshot-v1` 保留兼容，新的 batch 流程作为主路径。
5. Skill、文档、pipeline、resume 都必须理解 batch 目录结构。

## 3. 新目录结构

单任务目录从：

```text
runs/task_0001/
  task.json
  comment-dom-snapshot.json
  ai-comment-extraction.json
  normalized-comments.jsonl
```

演进为：

```text
runs/task_0001/
  task.json
  raw-comments.json
  capture-state.json
  normalized-comments.jsonl
  qa.json
  batches/
    batch_0001/
      comment-dom-batch.json
      ai-comment-extraction.json
      normalized-comments.jsonl
      qa.json
    batch_0002/
      comment-dom-batch.json
      ai-comment-extraction.json
      normalized-comments.jsonl
      qa.json
```

兼容规则：

- 如果存在 `runs/<task_id>/normalized-comments.jsonl`，项目合并器继续读取它。
- 如果只存在 `batches/*/normalized-comments.jsonl`，任务级合并器先生成任务级 `normalized-comments.jsonl`。
- 旧 `comment-dom-snapshot.json` 仍可被旧 prompt 和 normalizer 使用。

## 4. 数据契约

### 4.1 新增 DOM batch schema

新增：

```text
schemas/comment-dom-batch.schema.json
```

建议结构：

```json
{
  "schema_version": "comment-dom-batch-v1",
  "batch_id": "batch_0001",
  "task_id": "task_0001",
  "platform": "douyin",
  "source_url": "https://www.douyin.com/video/...",
  "captured_at": "2026-07-08T00:00:00.000Z",
  "scroll": {
    "before_top": 12000,
    "after_top": 16000,
    "viewport_height": 1000,
    "document_height": 90000
  },
  "state": {
    "new_candidate_count": 80,
    "seen_candidate_count": 240,
    "has_more": true,
    "stop_reason": ""
  },
  "limits": {
    "maxCandidates": 80,
    "maxCharsPerCandidate": 2500
  },
  "candidates": [
    {
      "candidate_id": "candidate_000001",
      "candidate_hash": "sha1...",
      "dom_path": "HTML:nth-of-type(1)>...",
      "role_hint": "comment_candidate",
      "inner_text": "用户A 评论正文 3月前 江苏 2",
      "html": "<div>...</div>",
      "nearby_buttons": ["回复"],
      "rect": {
        "top": 120,
        "left": 680,
        "width": 420,
        "height": 88
      },
      "captured_at": "2026-07-08T00:00:00.000Z"
    }
  ]
}
```

### 4.2 AI extraction schema 兼容

`schemas/ai-comment-extraction.schema.json` 暂时可以复用，但要明确：

- `source_chunk_id` 可以引用 `candidate_id`。
- `raw.ai_row.source_batch_id` 可记录 batch。
- 后续如果歧义明显，再升级到 `ai-comment-extraction-v2`，新增 `source_batch_id` 为必填。

### 4.3 Capture state

新增：

```text
runs/<task_id>/capture-state.json
```

用途：

- 记录 `seen_candidate_hashes`。
- 记录最后滚动位置。
- 记录 batch 计数。
- 支持停止条件和断点续跑。

建议结构：

```json
{
  "schema_version": "comment-capture-state-v1",
  "task_id": "task_0001",
  "status": "running",
  "last_batch_id": "batch_0008",
  "seen_candidate_count": 640,
  "seen_candidate_hashes_file": "seen-candidate-hashes.json",
  "last_scroll_top": 58200,
  "idle_rounds": 2,
  "stop_reason": ""
}
```

## 5. MCP 改造计划

### 5.1 保留现有工具

继续保留：

- `expand_current_page_comments`
- `capture_current_comment_dom_snapshot`
- `save_current_page_comments`
- `normalize_comment_run`

原因：

- 已有测试和文档依赖。
- 适合小评论量页面。
- 可作为 debug fallback。

### 5.2 新增工具：`capture_comment_candidate_batch`

建议 MCP tool：

```text
capture_comment_candidate_batch
```

输入：

```json
{
  "outDir": "output/project/runs/task_0001/batches/batch_0001",
  "taskId": "task_0001",
  "batchId": "batch_0001",
  "stateFile": "output/project/runs/task_0001/capture-state.json",
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "scrollAfterCapture": true,
  "scrollStepRatio": 0.85,
  "closePageAfter": false
}
```

输出：

```json
{
  "status": "success",
  "taskId": "task_0001",
  "batchId": "batch_0001",
  "outDir": ".../batch_0001",
  "batchFile": ".../comment-dom-batch.json",
  "newCandidateCount": 80,
  "seenCandidateCount": 240,
  "hasMore": true,
  "stopReason": "",
  "scrollBefore": 12000,
  "scrollAfter": 16000
}
```

### 5.3 新增工具：`capture_comment_candidate_batches_until_idle`

第二阶段再做批量循环工具：

```text
capture_comment_candidate_batches_until_idle
```

作用：

- 在 MCP 内部循环捕获 batch。
- 每轮先点展开按钮，再捕获新增 candidates，再下滚。
- 达到停止条件后返回 summary。

第一版不建议直接做完整自动循环。先做单 batch 工具，让 Codex 控制节奏，更容易排错。

### 5.4 停止条件

组合判断：

```text
连续 maxIdleRounds 轮没有新增 candidate_hash
并且 scrollTop 不再增长
并且没有可见“展开更多/展开回复”按钮
并且 expander_state.stopReason 存在或滚动接近底部
```

不要只依赖“滚动到底”，因为抖音/小红书可能有虚拟列表、懒加载、固定容器滚动。

## 6. DOM 提取器改造计划

当前：

```text
mcp/comment-crawler-dom-snapshot.js
  -> buildCommentDomSnapshotFromElements
  -> captureCommentDomSnapshot
```

新增：

```text
mcp/comment-crawler-candidates.js
  -> normalizeCandidateOptions
  -> buildCandidateHash
  -> collectVisibleCommentCandidates
  -> captureCommentCandidateBatch
```

提取策略：

1. 只取 viewport 附近的元素，不扫全页。
2. 优先选择平台评论容器内元素。
3. 使用 `getBoundingClientRect()` 过滤不可见元素。
4. 对候选做 hash 去重。
5. 记录 `rect`，方便判断是否来自当前窗口。
6. 输出候选而不是大块 DOM region。

需要补的平台细节：

| 平台 | 第一版策略 | 后续增强 |
|---|---|---|
| 抖音 | class/data-e2e/comment/reply + 可见区域过滤 | 针对评论项父容器收敛 selector |
| 小红书 | 参考 `clis/xiaohongshu/comments.js` 的评论容器识别 | 针对展开回复、二级回复做父子关系提示 |
| B站 | 暂不做 MCP 页面采集；先支持历史交付表导入 | 后续如果采 B站页面再加 adapter |

## 7. AI Prompt 改造计划

当前 prompt：

```text
prompts/comment-dom-extraction.md
```

保留用于旧 snapshot。

新增：

```text
prompts/comment-candidate-batch-extraction.md
```

Prompt 变化：

- 输入是 `comment-dom-batch-v1.candidates`。
- 每条输出必须引用 `candidate_id`。
- 明确“只处理 candidates，不补写未出现内容”。
- 对噪声候选写入 `rejected`。
- 对低置信字段使用空字符串或 `confidence=low`，不要猜。

AI 输出仍先使用 `ai-comment-extraction-v1`，其中：

```text
source_chunk_id = candidate_id
```

## 8. Normalizer 改造计划

当前：

```text
src/normalize/normalize-ai-comment-extraction.js
```

改造点：

1. 支持 `--batch` 参数：

```bash
node script/normalize-ai-comment-extraction.js \
  --input runs/task_0001/batches/batch_0001/ai-comment-extraction.json \
  --snapshot runs/task_0001/batches/batch_0001/comment-dom-batch.json \
  --task runs/task_0001/task.json \
  --out runs/task_0001/batches/batch_0001/normalized-comments.jsonl
```

2. 自动识别 snapshot 类型：

```text
comment-dom-snapshot-v1 -> chunks
comment-dom-batch-v1 -> candidates
```

3. `raw` 中记录：

```json
{
  "source_batch_id": "batch_0001",
  "source_candidate_id": "candidate_000001"
}
```

4. `row_key` 加入 batch/candidate，但仍以内容 hash 去重，避免跨 batch 重复。

## 9. Pipeline 改造计划

### 9.1 新增任务级 batch 合并

新增：

```text
src/pipeline/merge_task_batches.py
```

作用：

```text
runs/task_0001/batches/*/normalized-comments.jsonl
  -> runs/task_0001/normalized-comments.jsonl
```

要求：

- 按 batch 序号排序。
- 按 `row_key` 去重。
- 输出 `batch-merge-summary.json`。

### 9.2 项目级合并兼容 batch

修改：

```text
src/pipeline/merge_comment_runs.py
```

逻辑：

1. 优先读取 `runs/<task_id>/normalized-comments.jsonl`。
2. 若不存在，则读取 `runs/<task_id>/batches/*/normalized-comments.jsonl` 并临时合并。
3. 输出 summary 中增加 batch 数量。

### 9.3 QA 支持 batch

修改：

```text
src/pipeline/qa_comment_delivery.py
```

新增检查：

- batch 数量。
- 空 batch 数量。
- AI extraction 缺失 batch。
- batch truncated。
- 连续 idle 停止是否合理。
- `candidate_count` 与 `normalized row_count` 的比例。

### 9.4 Resume 支持 batch

修改：

```text
src/pipeline/resume_comment_project.py
```

新增 action：

```text
run_batch
rerun_batch
merge_task
qa_task
```

第一版可以先保持任务级 resume，但在 `existing_files` 里识别 `batches/`。

## 10. Skill 和文档改造计划

### 10.1 Skill

修改：

```text
.codex/skills/comment-excel-delivery/SKILL.md
.codex/skills/comment-excel-delivery/references/workflow.md
```

变化：

- 把主流程从“每任务一个 DOM snapshot”改为“每任务多个 batches”。
- 明确单 batch AI 结构化步骤。
- 增加“批次达到上限时继续下一 batch，不扩大单次 token”的原则。
- 增加 batch 级 resume/QA 说明。

### 10.2 MCP 使用文档

修改：

```text
docs/comment-crawler-mcp-usage.md
```

新增：

- `capture_comment_candidate_batch` 用法。
- 批量任务推荐参数。
- `closePageAfter` 只在任务最后一个 batch 使用。
- 如果 batch 中 `hasMore=true`，继续打开下一 batch。

### 10.3 旧计划文档

不直接重写历史计划。新增本文作为 v2 开发计划，并在：

```text
docs/plan/semi-automated-comment-excel-pipeline-plan.md
```

追加引用：

```text
大评论量页面进入 Batch Candidate 架构，详见 docs/plan/comment-crawler-batch-candidate-development-plan.md
```

## 11. 测试计划

### 11.1 MCP 单元测试

新增：

```text
test/comment-crawler-candidate-batch.test.js
```

覆盖：

- 只采可见候选。
- `maxCandidates` 生效。
- `candidate_hash` 去重。
- `scrollAfterCapture` 更新 scrollTop。
- 写入 `comment-dom-batch.json`。
- `closePageAfter` 不在中间 batch 误关页面。

### 11.2 Schema 测试

新增：

```text
test/comment-dom-batch-schema.test.js
```

覆盖：

- 合法 batch 通过。
- 缺 `candidate_id` 失败。
- 缺 `candidate_hash` 失败。
- `candidates` 超出字段不允许。

### 11.3 Normalizer 测试

修改：

```text
test/normalize-ai-comment-extraction.test.js
```

覆盖：

- `comment-dom-batch-v1` 输入。
- `source_chunk_id` 指向 candidate。
- 输出 raw 带 `source_batch_id`。

### 11.4 Pipeline 测试

新增：

```text
test/pipeline/test_merge_task_batches.py
```

修改：

```text
test/pipeline/test_merge_comment_runs.py
test/pipeline/test_qa_comment_delivery.py
test/pipeline/test_resume_comment_project.py
test/pipeline/test_comment_excel_delivery_skill.py
```

### 11.5 真实烟测

用一个高评论抖音链接：

1. 生成 `batch_0001`。
2. AI 结构化 `batch_0001`。
3. 归一化 `batch_0001`。
4. 生成 `batch_0002`，确认去重生效。
5. 合并 task。
6. 生成 Excel。

验收：

- 单 batch 不超过设定 candidates。
- 不再出现 `truncated=true` 后无后续处理。
- batch 数量可增加，但单次 AI 输入稳定。
- task 级 `normalized-comments.jsonl` 可合并成功。

## 12. 阶段计划

阶段按执行顺序排序，同时兼顾收益和成本。

| 阶段 | 状态 | 任务 | 收益 | 成本 | 交付物 | 验收标准 |
|---|---|---|---:|---:|---|---|
| 0 | 已完成 | 明确 v2 契约和迁移边界 | 很高 | 低 | 本文档 | 不破坏现有 snapshot 主路径 |
| 1 | 已完成 | 新增 `comment-dom-batch.schema.json` | 很高 | 低 | schema + schema test | batch/candidate 结构固定 |
| 2 | 已完成 | 抽出 candidate 提取模块 | 很高 | 中 | `mcp/comment-crawler-candidates.js` | 可见候选、hash、去重、上限可测 |
| 3 | 已完成 | 新增 MCP 单 batch 工具 | 很高 | 中 | `capture_comment_candidate_batch` | 可保存 `batches/batch_xxxx/comment-dom-batch.json` |
| 4 | 已完成 | 新增 batch prompt | 高 | 低 | `prompts/comment-candidate-batch-extraction.md` | AI 输出引用 candidate_id |
| 5 | 已完成 | normalizer 支持 batch 输入 | 很高 | 中 | 增强 `normalize-ai-comment-extraction.js` | batch AI JSON 可转 JSONL |
| 6 | 已完成 | 新增任务级 batch 合并 | 很高 | 中 | `merge_task_batches.py` | 多 batch 可生成任务级 normalized JSONL |
| 7 | 待开始 | 项目级 merge/QA/resume 兼容 batch | 很高 | 中 | pipeline 增强 | Excel 流程不关心底层是 snapshot 还是 batch |
| 8 | 待开始 | Skill 和 MCP 文档改为 batch 主路径 | 高 | 低 | skill workflow + usage docs | AI 按 skill 不再走整页 snapshot |
| 9 | 待开始 | 增加自动循环批采工具 | 中高 | 中高 | `capture_comment_candidate_batches_until_idle` | 大评论量页面可半自动跑完 |
| 10 | 待开始 | 平台候选提取精修 | 高 | 中高 | 抖音/小红书 selector 增强 | 噪声率下降，AI rejected 减少 |
| 11 | 待开始 | batch QA 可视化/汇总 | 中 | 中 | `batch-summary.json` 或 Excel 隐藏表 | 可定位失败 batch |

## 13. 推荐第一轮开发范围

第一轮只做“可控的 batch 主路径”，不做全自动循环：

1. `schemas/comment-dom-batch.schema.json`
2. `mcp/comment-crawler-candidates.js`
3. `capture_comment_candidate_batch`
4. `prompts/comment-candidate-batch-extraction.md`
5. `normalize-ai-comment-extraction.js` 支持 batch snapshot
6. `src/pipeline/merge_task_batches.py`
7. Skill workflow 更新

第一轮不做：

- 自动一直滚到底。
- 平台深度 selector 精修。
- 完整 batch 级 QA 看板。

理由：

- 单 batch 工具足以解决 maxChunks 上限。
- Codex 可以先控制循环和观察质量。
- 自动循环需要更稳定的停止条件，适合第二轮做。

## 14. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 虚拟列表导致旧 candidate 消失 | 无法一次性回溯 DOM | batch 捕获后立即落盘 |
| 同一评论跨 batch 重复 | Excel 重复行 | candidate hash + row_key 双层去重 |
| DOM selector 抓到播放器/页脚 | AI token 浪费 | candidate 提取先过滤可见区域和噪声词 |
| AI 批次质量不稳定 | 局部字段错误 | batch 级 QA 和 rerun |
| 自动滚动停止误判 | 漏抓或空转 | 第一轮由 Codex 控制循环，第二轮再自动化 |
| 旧流程仍被使用 | 大评论页面继续撞上限 | skill 和 docs 改为 batch 主路径，旧 snapshot 标记为小页面/debug |

## 15. 最终验收标准

1. 大评论量页面不再因为单次 `maxChunks` 上限阻塞。
2. 任意单次 AI 输入规模稳定，不随总评论数线性增长。
3. 每个 batch 可独立保存、结构化、归一化、重跑。
4. 任务级和项目级合并仍能生成 `delivery.xlsx`。
5. `resume-plan.json` 能识别 batch 产物。
6. Skill 触发后的默认工作流使用 batch 主路径。
7. 旧 snapshot 流程仍可用于小页面和 debug，不破坏既有测试。
