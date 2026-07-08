# 评论采集 MCP 化项目演进计划书

更新时间：2026-07-08

## 1. 目标

在现有评论采集链路已经跑通的基础上，逐步把“展开评论、下滚、保存结果、归一化、AI 结构化、输出 Excel”封装为 Codex 可调用的 MCP 工具。

核心目标不是重写爬虫，而是让 Codex 通过 MCP 调用现有脚本能力，减少“观察页面、逐个点击、逐轮滚动”带来的 token 消耗，并复用用户 Chrome 中已有的登录态。

目标链路：

```text
Codex
  -> MCP server
  -> Chrome CDP / 当前浏览器页面
  -> 注入 script/expand-comments-v1.js
  -> 展开评论、下滚、停止
  -> 保存 raw-comments.json / raw-comments.csv / manifest.json
  -> normalize-comments.js
  -> AI 结构化
  -> Excel 报表
```

## 2. 当前代码基线

以下能力已经在当前代码中存在，MCP 化时应优先复用，不要重复实现。

| 能力 | 当前文件 | 当前状态 | MCP 化复用方式 |
|---|---|---|---|
| 页面内展开、滚动、停止 | `script/expand-comments-v1.js` | 已完成 | MCP 注入到当前 Chrome 页面执行 |
| Playwright 打开页面与 CDP/profile 登录态 | `script/crawl-comments-playwright.js` | 已完成 | 抽出 CDP 连接、页面选择、注入、等待、保存逻辑 |
| 小红书登录墙等待 | `script/crawl-comments-playwright.js` | 已完成 | MCP 执行前检测页面状态，必要时提示用户登录 |
| 抖音到底 idle 停止 | `script/expand-comments-v1.js` | 已完成 | 继续复用现有停机规则 |
| 原始结果输出 | `script/crawl-comments-playwright.js` | 已完成 | MCP 工具保存同样的 output 目录结构 |
| 抖音归一化 | `adapters/douyin.js`、`script/normalize-comments.js` | 已完成 | MCP 后处理工具调用现有 normalizer |
| 小红书归一化 | `adapters/xiaohongshu.js`、`script/normalize-comments.js` | 已完成 | MCP 后处理工具调用现有 normalizer |
| 评论 row schema | `schemas/comment-row.schema.json` | 已完成 | MCP 输出继续遵守该 schema |
| AI 审阅批处理 | `script/prepare-comment-ai-review.js`、`script/run-comment-ai-review.js` | 已完成 | 后续作为独立 MCP tool 暴露 |
| Excel 报表 | `script/build-comment-excel-report.js` | 已完成 | 后续作为独立 MCP tool 暴露 |
| QA 抽样 | `script/build-comment-qa-sample.js` | 已完成 | 后续作为质量检查工具暴露 |
| 配置与测试夹具 | `script/comment-crawler-config.js`、`test/` | 已完成 | MCP 配置和测试沿用现有规则 |

## 3. 设计原则

- 渐进式封装：先把已有 CLI 能力包装成 MCP tool，再考虑 Chrome 插件或 UI。
- 复用现有脚本：页面展开逻辑仍以 `expand-comments-v1.js` 为唯一核心，不在 MCP server 内再写一套。
- 用户登录态优先：第一版只支持连接用户手动打开的 Chrome CDP，避免账号、Cookie、验证码等敏感状态进入项目文件。
- 单页面串行：第一版只处理当前页面，不做并发、不做多账号、不做任务队列。
- 输出本地化：所有结果只写入项目本地 `output/`，不上传外部服务。
- AI 后置：MCP 不让 AI 参与点击和滚动，只让 AI 处理归一化后的评论文本。

## 4. 总体架构

```text
用户手动打开 Chrome 并登录平台
  -> Chrome 以 remote-debugging-port 启动
  -> Codex 调用 MCP tool
  -> MCP server 连接 CDP
  -> 选择当前页面或指定 URL 的 tab
  -> 注入 expand-comments-v1.js
  -> 等待 window.__commentExpanderV1.stopReason
  -> 读取 payload
  -> 写入 output/<run_id>/
  -> 可选执行 normalize / AI / Excel
```

建议新增目录：

```text
mcp/
  comment-crawler-server.js
  comment-crawler-tools.js
  comment-crawler-cdp.js
  comment-crawler-output.js

test/
  comment-crawler-mcp.test.js
```

后续如果确定需要 Chrome 插件，再新增：

```text
extension/
  manifest.json
  content-script.js
  background.js
```

Chrome 插件不是第一版目标。

## 5. 演进路线

阶段按执行顺序排序，同时兼顾收益和成本。状态中的“已完成”表示当前代码已经具备，不需要在 MCP 阶段重复实现。

| 阶段 | 状态 | 任务 | 收益 | 成本 | 交付物 | 验收标准 |
|---|---|---|---:|---:|---|---|
| 0 | 已完成 | 保留现有 CLI 采集闭环 | 很高 | 已投入 | `script/crawl-comments-playwright.js`、`script/expand-comments-v1.js` | 抖音、小红书可打开页面、展开评论、保存 raw |
| 1 | 已完成 | 保留归一化、AI、Excel 后处理 | 很高 | 已投入 | `normalize-comments.js`、AI scripts、Excel script | raw 能转 normalized，AI 和 Excel 可复用 |
| 2 | 已完成 | MCP 最小可行性验证 | 很高 | 低 | `mcp/comment-crawler-server.js` | Codex 能发现并调用一个本地 MCP tool |
| 3 | 已完成 | 抽出 CDP 页面控制模块 | 很高 | 中 | `mcp/comment-crawler-cdp.js` | 能连接 `http://127.0.0.1:9222` 并定位当前 tab |
| 4 | 已完成 | 实现 `expand_current_page_comments` | 很高 | 中 | MCP tool | 当前 Chrome 页面可注入 expander 并返回评论数、stop reason |
| 5 | 已完成 | 实现 `save_current_page_comments` | 高 | 低 | MCP tool、`output/<run_id>/` | 当前页面 payload 可保存 raw JSON/CSV/manifest |
| 6 | 待开始 | 实现 `normalize_comment_run` | 高 | 低 | MCP tool | 给定 run dir 和 platform，输出 `normalized-comments.jsonl` |
| 7 | 待开始 | 补 MCP 安全边界与配置 | 高 | 低 | 配置、域名限制、输出限制 | 只写入项目 `output/`，不读取 Cookie，不并发执行 |
| 8 | 待开始 | 写 Codex 使用说明 | 高 | 低 | docs 使用说明 | 用户知道如何启动 Chrome CDP、启用 MCP、运行工具 |
| 9 | 待开始 | MCP 工具单测 | 中 | 中 | `test/comment-crawler-mcp.test.js` | mock CDP/page 时工具参数、输出、错误分支可测 |
| 10 | 待开始 | 真实页面端到端验证 | 高 | 中 | 手工验收记录 | 抖音、小红书各跑 1 条，输出 raw 和 normalized |
| 11 | 待开始 | AI 与 Excel MCP 化 | 中 | 中 | `prepare_ai_review`、`build_excel_report` tools | Codex 可从 run dir 直接生成 AI 批次和 Excel |
| 12 | 待开始 | 批量 URL MCP 化 | 中 | 中 | `crawl_url_batch` tool | 复用已有 batch/resume/retry，失败不阻断全局任务 |
| 13 | 暂缓 | Chrome 插件 native messaging | 中 | 高 | extension 原型 | 只有 CDP MCP 稳定后再评估是否需要 |
| 14 | 暂缓 | Web UI、数据库、任务队列 | 低 | 高 | UI/DB/queue | 当前阶段不做，避免拖慢可用闭环 |

## 6. 阶段说明

### 阶段 0：保留 CLI 采集闭环

当前 CLI 已经能覆盖第一版核心场景：

```bash
node script/crawl-comments-playwright.js \
  --url "https://www.douyin.com/video/<video_id>" \
  --out-dir output/douyin_manual_test_001 \
  --timeout-ms 300000 \
  --post-load-ms 5000
```

这部分不要重写。MCP 第一版应把 CLI 中已经可靠的能力拆成可复用模块，而不是直接复制大段逻辑。

### 阶段 1：保留后处理闭环

当前后处理已经存在：

```bash
node script/normalize-comments.js \
  --run-dir output/douyin_manual_test_001 \
  --platform douyin
```

后续 AI 和 Excel 也已经有独立脚本。MCP 化的收益来自“把这些步骤变成工具调用”，不是改变数据结构。

### 阶段 2：MCP 最小可行性验证

先实现最小 server，只暴露一个轻量 tool，例如：

```text
get_comment_crawler_status
```

返回：

```json
{
  "status": "ok",
  "version": "mcp-v1",
  "projectRoot": "/Users/gyp/Documents/demo"
}
```

验收重点是 Codex 能发现 MCP server，能调用 tool，能拿到 JSON 返回。此阶段不碰浏览器，成本最低。

### 阶段 3：抽出 CDP 页面控制模块

从现有 `crawl-comments-playwright.js` 中抽出可复用能力：

- 加载 Playwright，包括 Codex bundled runtime fallback。
- 连接 `--cdp http://127.0.0.1:9222`。
- 获取当前或最近活跃页面。
- 读取页面 URL、标题、body 文本。
- disconnect 而不是 close 外部 Chrome。

交付模块建议为：

```text
mcp/comment-crawler-cdp.js
```

先只支持 CDP，不支持独立 profile。因为 MCP 的核心价值是复用用户已经登录的 Chrome。

### 阶段 4：实现 `expand_current_page_comments`

工具职责：

1. 连接当前 Chrome CDP。
2. 定位当前页面。
3. 注入 `script/expand-comments-v1.js`。
4. 等待 stop reason。
5. 返回 summary。

建议返回：

```json
{
  "status": "success",
  "platform": "douyin",
  "url": "https://www.douyin.com/video/...",
  "stopReason": "idle",
  "rawCommentCount": 120,
  "totalClicks": 42,
  "rounds": 58
}
```

这个阶段收益最高，因为它直接替代 Codex 逐轮看页面、点按钮、滚动。

### 阶段 5：实现 `save_current_page_comments`

工具职责：

1. 读取 `window.__commentExpanderV1.getPayload()`。
2. 写入本地 output 目录。
3. 生成与 CLI 一致的文件：

```text
output/<run_id>/
  manifest.json
  raw-comments.json
  raw-comments.csv
  final-page.png
```

输出结构必须和当前 CLI 一致，这样 normalizer、AI、Excel 不需要感知数据来自 CLI 还是 MCP。

### 阶段 6：实现 `normalize_comment_run`

工具职责是包装现有 normalizer：

```text
normalize_comment_run(runDir, platform)
```

内部复用：

```text
script/normalize-comments.js
adapters/douyin.js
adapters/xiaohongshu.js
```

验收标准：

- 输入 `output/<run_id>` 和 `douyin`，输出 `normalized-comments.jsonl`。
- 输入 `output/<run_id>` 和 `xiaohongshu`，输出 `normalized-comments.jsonl`。
- 返回 row count 和输出路径。

### 阶段 7：安全边界与配置

第一版安全边界：

- 只连接显式传入的 CDP endpoint，默认 `http://127.0.0.1:9222`。
- 只读取当前页面 DOM 和当前 expander payload。
- 不读取浏览器 Cookie、本地存储、密码、账号信息。
- 所有文件只写入项目本地 `output/`。
- 默认串行执行，一个页面展开任务未结束时拒绝第二个任务。
- 对 URL host 做平台识别，但不做平台绕过或风控规避。

建议配置：

```json
{
  "mcp": {
    "cdpEndpoint": "http://127.0.0.1:9222",
    "outputBaseDir": "output",
    "allowedHosts": [
      "douyin.com",
      "xiaohongshu.com"
    ],
    "maxRuntimeMs": 600000
  }
}
```

### 阶段 8：Codex 使用说明

新增文档建议：

```text
docs/comment-crawler-mcp-usage.md
```

至少包含：

- 如何启动 Chrome CDP。
- 如何在 Codex 配置 MCP server。
- 如何打开抖音/小红书页面并登录。
- 如何调用 `expand_current_page_comments`。
- 如何保存 output。
- 如何执行归一化、AI、Excel。
- 常见错误：CDP 端口未开、页面未登录、当前 tab 不是目标页面、评论为空。

### 阶段 9：MCP 工具单测

不要等真实浏览器才测试。先把 MCP tool handler 写成普通函数，注入 mock page：

- mock `page.evaluate()` 返回 payload。
- mock `page.waitForFunction()` 控制 stop reason。
- mock output writer 校验文件路径。
- mock CDP browser 校验 disconnect。

单测重点：

- 参数校验。
- output 目录限制。
- 成功返回 summary。
- 页面未注入 expander 时的错误。
- CDP 连接失败时的错误。

### 阶段 10：真实页面端到端验证

手动验收顺序：

1. 启动 Chrome CDP。
2. 打开并登录抖音。
3. Codex 调 MCP 展开当前页面评论。
4. 保存 output。
5. 归一化。
6. 检查 `manifest.json`、`raw-comments.json`、`normalized-comments.jsonl`。
7. 小红书重复同样流程。

验收只要求单页面成功，不做批量。

### 阶段 11：AI 与 Excel MCP 化

在采集和归一化稳定后，再暴露：

```text
prepare_ai_review(runDir, batchSize)
run_ai_review(runDir)
build_excel_report(runDir)
build_qa_sample(runDir)
```

这一步收益是让 Codex 能从一个 run dir 一路推进到 Excel，但成本高于前几个阶段，因此放在采集 MCP 稳定之后。

### 阶段 12：批量 URL MCP 化

复用已有 batch/resume/retry 逻辑：

```text
crawl_url_batch(inputFile, outDir, platform, resume, retries)
```

注意：第一版 MCP 不应该主动做大批量并发。即使支持批量，也保持串行、延迟、可中断、可恢复。

### 阶段 13：Chrome 插件 native messaging

这是暂缓项。只有当 CDP MCP 出现明显限制时再做，例如：

- 用户无法方便用 CDP 启动 Chrome。
- 需要从普通 Chrome 会话中直接触发工具。
- 需要页面内按钮或轻量 UI。

Chrome 插件会引入 manifest、权限、native messaging、安装流程和调试成本，不适合作为第一版。

### 阶段 14：Web UI、数据库、任务队列

当前不建议做。

原因：

- 真实页面展开和评论质量仍是最大不确定性。
- Web UI 和数据库会扩大维护面。
- 任务队列会诱导并发抓取，不符合当前低频、串行、可控的边界。

## 7. 建议的第一轮执行顺序

第一轮只做 4 个小步：

1. `mcp/comment-crawler-server.js`：启动 MCP server，暴露 `get_comment_crawler_status`。
2. `mcp/comment-crawler-cdp.js`：连接 Chrome CDP，读取当前页面 URL 和标题。
3. `expand_current_page_comments`：注入 `expand-comments-v1.js` 并返回 summary。
4. `save_current_page_comments`：保存与 CLI 一致的 raw output。

这四步完成后，MCP 的核心价值已经成立：Codex 可以不再逐个按钮操控页面，而是调用工具完成展开和保存。

## 8. 暂不做的事情

短期不要做：

- 不做 Chrome 插件。
- 不做数据库。
- 不做 Web UI。
- 不做并发抓取。
- 不做代理池、多账号调度。
- 不把 AI 放进页面展开循环。
- 不复制第三方项目代码。

这些都可以以后做，但不是第一版 MCP 成功的必要条件。

## 9. 成功标准

第一版 MCP 成功的标准：

- 用户手动打开并登录 Chrome。
- Codex 能调用 MCP tool 展开当前抖音或小红书页面评论。
- MCP 能保存与 CLI 一致的 output 文件。
- 归一化、AI、Excel 继续复用现有脚本。
- 整个过程比 Codex 逐步观察和点击更省 token、更稳定、更容易复跑。
