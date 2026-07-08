# 评论采集 MCP 使用说明

更新时间：2026-07-08

## 1. 当前能力

当前 MCP server 已实现 8 个工具：

| 工具 | 用途 | 输出 |
|---|---|---|
| `get_comment_crawler_status` | 检查 MCP server 状态 | server 版本、项目目录 |
| `expand_and_capture_comment_batches` | 主流程工具：边展开、边捕获当前 DOM、边滚动、边写 batch | 多个 `batches/<batch_id>/comment-dom-batch.json`、`capture-state.json` |
| `expand_current_page_comments` | 连接当前 Chrome CDP 页面，注入 `src/browser/expand-comments-v1.js` 展开和下滚评论 | `stopReason`、评论数、点击数、轮次 |
| `capture_comment_candidate_batch` | 捕获当前可见窗口内的评论候选 DOM，写入 batch，并可顺手下滚 | `batches/<batch_id>/comment-dom-batch.json`、`capture-state.json` |
| `capture_comment_candidate_batches_until_idle` | 在同一个 Chrome 页面内连续捕获多个 candidate batch，直到连续空 batch 或达到上限 | 多个 `batches/<batch_id>/comment-dom-batch.json`、`capture-state.json` |
| `capture_current_comment_dom_snapshot` | 读取当前页面有限 DOM chunks，供 AI 结构化提取评论字段 | `output/<run_id>/comment-dom-snapshot.json` |
| `save_current_page_comments` | 读取页面里的 expander payload 并保存到项目本地 | `output/<run_id>/raw-comments.json`、CSV、manifest、截图 |
| `normalize_comment_run` | 调用现有 normalizer，把 raw 转成统一 JSONL | `normalized-comments.jsonl` |

MCP 第一版只支持当前页面串行执行，默认只允许处理抖音和小红书页面，所有输出必须位于项目 `output/` 目录内。

## 2. 启动 Chrome CDP

推荐使用一个专用 Chrome profile。首次登录一次后，后续可以复用这个 profile 的登录态。

```bash
mkdir -p "$HOME/.comment-crawler-chrome-profile"

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.comment-crawler-chrome-profile"
```

打开后，在这个 Chrome 窗口里登录抖音或小红书，并进入目标笔记或视频页面。

注意：

- MCP 只能连接带 `--remote-debugging-port=9222` 启动的 Chrome。
- 如果页面没登录，展开结果可能为空或采集到登录弹窗文本。
- 如果当前 tab 不是目标页面，MCP 会操作当前 CDP session 选中的页面。

## 3. 配置 Codex MCP Server

MCP server 通过 stdio 启动，不需要 HTTP 服务。

如果你的 Codex 配置使用 TOML，可以添加：

```toml
[mcp_servers.comment-crawler]
command = "node"
args = ["/Users/gyp/Documents/demo/mcp/comment-crawler-server.js"]
```

如果你的 Codex 客户端使用 JSON 形式，可以按同样含义配置：

```json
{
  "mcpServers": {
    "comment-crawler": {
      "command": "node",
      "args": [
        "/Users/gyp/Documents/demo/mcp/comment-crawler-server.js"
      ]
    }
  }
}
```

配置后重启 Codex，确认能看到 `comment-crawler` 的工具列表。

## 4. 推荐调用顺序

在 Codex 中按这个顺序调用工具：

1. 检查 MCP：

```text
调用 comment-crawler 的 get_comment_crawler_status
```

2. 使用主流程工具边展开边捕获 DOM batches：

```text
调用 comment-crawler 的 expand_and_capture_comment_batches，参数：
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/douyin_batch_ai_test_001/runs/task_0001",
  "taskId": "task_0001",
  "maxRuntimeMs": 1800000,
  "maxRounds": 800,
  "maxBatches": 300,
  "maxIdleRounds": 8,
  "maxClicksPerRound": 3,
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "closePageAfter": true
}
```

输出会落在：

```text
output/douyin_batch_ai_test_001/runs/task_0001/
  capture-state.json
  batches/batch_0001/comment-dom-batch.json
  batches/batch_0002/comment-dom-batch.json
  ...
```

这个工具的循环顺序是“点击展开 -> 等待 -> 捕获当前 DOM -> 写 batch -> 滚动 -> 等待”，避免展开到底后只抓到底部 DOM。

3. 如果需要手动调试，可以只捕获当前页面的一个评论候选 batch：

```text
调用 comment-crawler 的 capture_comment_candidate_batch，参数：
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/douyin_batch_ai_test_001/runs/task_0001",
  "taskId": "task_0001",
  "batchId": "batch_0001",
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "scrollAfterCapture": true,
  "scrollStepRatio": 0.85,
  "closePageAfter": false
}
```

继续捕获下一批时，把 `batchId` 改成 `batch_0002`，或让工具根据 `capture-state.json` 推导下一批。批次达到上限时继续下一 batch，不要扩大单次 token。

如果只想自动连续捕获而不点击展开，可以改用 `capture_comment_candidate_batches_until_idle`：

```text
调用 comment-crawler 的 capture_comment_candidate_batches_until_idle，参数：
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/douyin_batch_ai_test_001/runs/task_0001",
  "taskId": "task_0001",
  "maxBatches": 20,
  "maxIdleBatches": 2,
  "maxCandidates": 80,
  "maxCharsPerCandidate": 2500,
  "includeHtml": true,
  "includeText": true,
  "scrollStepRatio": 0.85,
  "closePageAfter": true
}
```

它适合调试滚动捕获；正式客户交付默认使用 `expand_and_capture_comment_batches`。后续 AI 仍然逐个 batch 结构化，不要把多个 batch 合并后一次性发给 AI。

`closePageAfter: true` 只用在每个任务最后一次 MCP 页面操作上。它会在 batch、snapshot 或 raw 保存完成后关闭当前 Chrome tab，避免下一条链接打开后 MCP 仍然选中上一条任务页面。

4. 让 AI 读取 `prompts/comment-candidate-batch-extraction.md` 和 `comment-dom-batch.json`，输出：

```text
output/douyin_batch_ai_test_001/runs/task_0001/batches/batch_0001/ai-comment-extraction.json
```

AI 输出里的 `source_chunk_id` 必须引用输入中的 `candidate_id`。

5. 归一化单个 batch 的 AI 输出：

```bash
node script/normalize-ai-comment-extraction.js \
  --input output/douyin_batch_ai_test_001/runs/task_0001/batches/batch_0001/ai-comment-extraction.json \
  --batch output/douyin_batch_ai_test_001/runs/task_0001/batches/batch_0001/comment-dom-batch.json \
  --task output/douyin_batch_ai_test_001/runs/task_0001/task.json \
  --out output/douyin_batch_ai_test_001/runs/task_0001/batches/batch_0001/normalized-comments.jsonl \
  --platform douyin
```

6. 一个任务的所有 batch 都归一化后，合并到任务级输出：

```bash
python src/pipeline/merge_task_batches.py \
  --task-dir output/douyin_batch_ai_test_001/runs/task_0001
```

旧版整页 DOM snapshot 和纯脚本保存流程仍可用于小页面或回归对照：

```text
调用 comment-crawler 的 capture_current_comment_dom_snapshot，参数：
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/douyin_dom_ai_test_001",
  "runId": "douyin_dom_ai_test_001",
  "maxChunks": 120,
  "maxCharsPerChunk": 3000,
  "includeHtml": true,
  "includeText": true,
  "closePageAfter": true
}
```

```text
调用 comment-crawler 的 save_current_page_comments，参数：
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/douyin_mcp_test_001",
  "runId": "douyin_mcp_test_001",
  "closePageAfter": true
}
```

再归一化旧版 raw-comments：

```text
调用 comment-crawler 的 normalize_comment_run，参数：
{
  "runDir": "output/douyin_mcp_test_001",
  "platform": "douyin"
}
```

小红书把 `platform` 改成 `xiaohongshu`，`outDir` 和 `runId` 换成自己的测试目录即可。

## 5. 后处理命令

MCP 当前只封装到归一化。AI 结构化和 Excel 报表继续复用现有脚本。

准备 AI 审阅批次：

```bash
node script/prepare-comment-ai-review.js \
  --input output/douyin_mcp_test_001/normalized-comments.jsonl \
  --out-dir output/douyin_mcp_test_001/ai-review-input \
  --batch-size 50
```

运行 AI 审阅：

```bash
node script/run-comment-ai-review.js \
  --input-dir output/douyin_mcp_test_001/ai-review-input
```

生成 Excel：

```bash
node script/build-comment-excel-report.js \
  --run-dir output/douyin_mcp_test_001
```

最终常见产物：

```text
output/douyin_mcp_test_001/
  manifest.json
  raw-comments.json
  raw-comments.csv
  final-page.png
  normalized-comments.jsonl
  ai-review-input/
  comment-report.xlsx
```

## 6. 本地冒烟测试

不连接浏览器时，可以直接验证 MCP server 的 JSON-RPC 基础链路：

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_comment_crawler_status","arguments":{}}}' \
  | node mcp/comment-crawler-server.js
```

项目单测：

```bash
node --test test/*.test.js
```

## 7. 常见问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 连接 CDP 失败 | Chrome 没用 `--remote-debugging-port=9222` 启动 | 重新按第 2 节启动 Chrome |
| 评论数为 0 | 页面未登录、当前 tab 不对、页面评论未加载 | 在 CDP Chrome 中登录并切到目标页面 |
| Codex 里看不到新工具 | MCP 进程还在用旧代码，或 Codex 未刷新工具列表 | 重启 Codex，或删除后重新添加该 MCP 配置 |
| 保存时报“未找到 comment expander payload” | 旧版 raw 保存依赖 `expand_current_page_comments` 的 payload | 若只是交付 Excel，改用 `expand_and_capture_comment_batches`；若要保存 raw，对当前页面重新调用 `expand_current_page_comments` |
| 输出路径被拒绝 | `outDir` 不在项目 `output/` 下 | 使用 `output/<run_id>` |
| 页面被拒绝 | 当前 URL 不是抖音或小红书域名 | 切到支持的平台页面 |
| 小红书采到登录弹窗 | 专用 profile 未登录 | 在该 Chrome profile 里完成登录后重跑 |

## 8. 安全边界

- 不读取 Cookie、密码、账号信息。
- 不绕过平台风控，不做多账号调度。
- 不并发展开多个页面。
- 不把结果写到项目外部目录。
- AI 只处理已经保存到本地的 DOM batch、DOM snapshot 或归一化文本，不参与页面点击和滚动。
