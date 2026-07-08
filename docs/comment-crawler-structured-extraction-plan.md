# MCP DOM Snapshot + AI 评论结构化计划书

更新时间：2026-07-08

## 1. 方向确认

新的架构边界调整为：

```text
MCP
  -> 连接用户已登录的 Chrome
  -> 展开评论和回复
  -> 下滚直到停止
  -> 截取有限、可控、靠近评论区的 DOM snapshot
  -> 返回或保存 DOM chunks

AI
  -> 阅读 DOM chunks
  -> 判断哪些内容是真评论
  -> 拆分 user_name / text / created_at / ip_location / like_count 等字段
  -> 输出结构化 JSON

本地脚本
  -> 校验 AI 输出 schema
  -> 保存 normalized-comments.jsonl
  -> 继续生成 AI 语义分析和 Excel 报表
```

MCP 不再负责复杂字段提取。它只负责高频、机械、耗 token 的浏览器动作，以及把页面压缩成 AI 能处理的 DOM 材料。

核心原则：**不要把整页 DOM 原样交给 AI，要返回有边界的 DOM snapshot。**

## 2. 当前问题

当前 `script/expand-comments-v1.js` 会在页面内尝试直接抽取评论文本，导致两个问题：

1. 抽取范围过宽，整页导航、播放器、页脚、视频简介、笔记正文都可能进入 results。
2. 抽取粒度过粗，只返回一个 `text` 字段，用户名、正文、时间、地区、点赞、回复按钮混在一起。

抖音错误样例：

```json
{
  "row_type": "level1",
  "text": "Klaus｜胡萝卜...哥，极氪001换胎，255 55 19选竞驰5E还是浩悦5E啊？3月前·江苏2分享"
}
```

期望 AI 从 DOM 中提取为：

```json
{
  "row_type": "level1",
  "user_name": "Klaus｜胡萝卜",
  "text": "哥，极氪001换胎，255 55 19选竞驰5E还是浩悦5E啊？",
  "created_at": "3月前",
  "ip_location": "江苏",
  "like_count": 2
}
```

小红书错误样例：

```json
{
  "row_type": "level1",
  "text": "沪ICP备13030189号 | 营业执照 | 2024沪公网安备31010102002533号 | ... 电话：9501-3888"
}
```

```json
{
  "row_type": "level1",
  "text": "托马斯这是我用到现在最好的轮胎置顶评论04-04上海24Henry的平行宇宙作者哟，主角来了 这个评价相当高啊！04-04上海1回复展开 3 条"
}
```

期望 AI 从 DOM chunks 中识别：

```json
[
  {
    "row_type": "level1",
    "user_name": "托马斯",
    "text": "这是我用到现在最好的轮胎",
    "created_at": "04-04",
    "ip_location": "上海",
    "like_count": 24,
    "is_pinned": true
  },
  {
    "row_type": "level2",
    "user_name": "Henry的平行宇宙",
    "text": "哟，主角来了 这个评价相当高啊！",
    "created_at": "04-04",
    "ip_location": "上海",
    "like_count": 1,
    "is_author": true
  }
]
```

## 3. 为什么不返回整页 DOM

整页 DOM 会带来：

- token 成本过高。
- 页脚、播放器、推荐区、笔记正文干扰 AI。
- 大量 class/style/svg/script 没有提取价值。
- AI 很难判断评论区边界。

所以 MCP 的责任不是“理解评论字段”，而是做轻量 DOM 裁剪：

- 去掉 `script/style/svg/canvas/video` 等无用节点。
- 优先围绕评论区、展开回复按钮、评论滚动容器采集。
- 保留局部 HTML、可见文本、DOM path、附近按钮文本。
- 限制 chunk 数量和每个 chunk 的字符数。

## 4. 推荐工具设计

### 4.1 保留现有工具

继续保留：

| 工具 | 保留原因 |
|---|---|
| `get_comment_crawler_status` | 检查 MCP 是否可用 |
| `expand_current_page_comments` | 快速展开和下滚，替代 Codex 手动操控浏览器 |
| `save_current_page_comments` | 兼容旧 raw 输出，短期保留 |
| `normalize_comment_run` | 兼容已有后处理，后续改为消费 AI 输出 |

### 4.2 新增核心工具

新增：

```text
capture_current_comment_dom_snapshot
```

职责：

1. 连接当前 Chrome CDP 页面。
2. 检查 URL 是否属于抖音或小红书。
3. 读取页面当前 DOM。
4. 找到评论相关区域和候选评论块。
5. 返回有限 DOM chunks。
6. 可选保存到 `output/<run_id>/comment-dom-snapshot.json`。

建议参数：

```json
{
  "cdpEndpoint": "http://127.0.0.1:9222",
  "outDir": "output/mcp_test_001",
  "runId": "mcp_test_001",
  "maxChunks": 80,
  "maxCharsPerChunk": 4000,
  "includeHtml": true,
  "includeText": true
}
```

返回：

```json
{
  "status": "success",
  "platform": "xiaohongshu",
  "url": "https://www.xiaohongshu.com/explore/...",
  "runId": "mcp_test_001",
  "outDir": "output/mcp_test_001",
  "snapshotFile": "output/mcp_test_001/comment-dom-snapshot.json",
  "chunkCount": 42,
  "truncated": false,
  "chunks": [
    {
      "chunk_id": "chunk_0001",
      "dom_path": "HTML:nth-of-type(1)>BODY:nth-of-type(1)>...",
      "role_hint": "comment_candidate",
      "inner_text": "托马斯这是我用到现在最好的轮胎置顶评论04-04上海24",
      "html": "<div class=\"...\">...</div>",
      "nearby_buttons": ["回复", "展开 3 条"],
      "captured_at": "2026-07-08T03:21:30.390Z"
    }
  ]
}
```

## 5. DOM Snapshot 契约

### 5.1 snapshot 文件

```json
{
  "schema_version": "comment-dom-snapshot-v1",
  "platform": "douyin",
  "source_url": "https://www.douyin.com/video/...",
  "captured_at": "2026-07-08T03:30:00.000Z",
  "expander_state": {
    "stopReason": "idle",
    "totalClicks": 122,
    "round": 62
  },
  "limits": {
    "maxChunks": 80,
    "maxCharsPerChunk": 4000
  },
  "chunks": []
}
```

### 5.2 chunk 字段

| 字段 | 说明 |
|---|---|
| `chunk_id` | 稳定编号，供 AI 输出引用 |
| `dom_path` | DOM 路径，便于回溯 |
| `role_hint` | `comment_candidate`、`comment_region`、`unknown` |
| `inner_text` | 可见文本，适合 AI 快速理解 |
| `html` | 清洗后的局部 HTML，保留节点层次 |
| `nearby_buttons` | 回复、展开、点赞等按钮文本 |
| `parent_chunk_id` | 可选，用于回复上下文 |
| `captured_at` | 采集时间 |

## 6. AI 结构化输出契约

AI 读取 `comment-dom-snapshot.json` 后，输出：

```json
{
  "schema_version": "ai-comment-extraction-v1",
  "source_url": "https://www.xiaohongshu.com/explore/...",
  "rows": [
    {
      "source_chunk_id": "chunk_0001",
      "row_type": "level1",
      "user_name": "托马斯",
      "text": "这是我用到现在最好的轮胎",
      "created_at": "04-04",
      "ip_location": "上海",
      "like_count": 24,
      "reply_to_user_name": "",
      "root_text": "",
      "is_pinned": true,
      "is_author": false,
      "confidence": "high",
      "evidence": "托马斯这是我用到现在最好的轮胎置顶评论04-04上海24"
    }
  ],
  "rejected": [
    {
      "source_chunk_id": "chunk_0002",
      "reason": "footer_legal_text"
    }
  ]
}
```

要求：

- `text` 只放评论正文。
- 页脚、播放器、笔记正文、推荐内容必须放入 `rejected` 或忽略。
- 每条 row 必须带 `source_chunk_id`。
- 不确定字段可以留空，但不能把 UI 文案拼进正文。
- `confidence` 使用 `high`、`medium`、`low`。

## 7. 本地校验与归一化

新增脚本建议：

```text
script/normalize-ai-comment-extraction.js
```

职责：

1. 读取 `ai-comment-extraction.json`。
2. 校验 schema。
3. 生成项目现有的 `normalized-comments.jsonl`。
4. 保留 `raw` 字段，包含 AI row、source chunk 和 snapshot 文件路径。

这样后续 `prepare-comment-ai-review.js`、`build-comment-excel-report.js` 可以继续复用。

## 8. 阶段计划

阶段按执行顺序排序，同时兼顾收益和成本。

| 阶段 | 状态 | 任务 | 收益 | 成本 | 交付物 | 验收标准 |
|---|---|---|---:|---:|---|---|
| 0 | 已完成 | 保留 MCP 展开和保存闭环 | 很高 | 已投入 | 现有 MCP tools | 能展开、下滚、保存 output |
| 1 | 待开始 | 调整计划与数据边界 | 高 | 低 | 本文档 | 明确 MCP 只返回 DOM snapshot，AI 负责结构化 |
| 2 | 待开始 | 定义 DOM snapshot schema | 很高 | 低 | `schemas/comment-dom-snapshot.schema.json` | chunks 字段、大小限制、source 信息明确 |
| 3 | 待开始 | 定义 AI 输出 schema | 很高 | 低 | `schemas/ai-comment-extraction.schema.json` | AI 输出 rows/rejected/source_chunk_id 可校验 |
| 4 | 待开始 | 实现 `capture_current_comment_dom_snapshot` | 很高 | 中 | MCP tool | 当前页面可返回并保存 bounded DOM chunks |
| 5 | 待开始 | DOM 裁剪和噪声压缩 | 很高 | 中 | snapshot extractor | 不返回整页 DOM，去除 script/style/svg，限制 chunk 大小 |
| 6 | 待开始 | AI 结构化 prompt 模板 | 高 | 低 | `prompts/comment-dom-extraction.md` | 能指导 AI 从 chunks 输出 schema JSON |
| 7 | 待开始 | AI 输出归一化脚本 | 高 | 中 | `normalize-ai-comment-extraction.js` | AI JSON 可转现有 `normalized-comments.jsonl` |
| 8 | 待开始 | 抖音样本验收 | 高 | 中 | fixture + 手工记录 | 抽样 20 条，正文污染显著下降 |
| 9 | 待开始 | 小红书样本验收 | 高 | 中 | fixture + 手工记录 | 页脚、播放器、笔记正文不进入 rows |
| 10 | 待开始 | Excel 字段扩展 | 中 | 低 | Excel report | 增加地区、置顶、作者、source chunk 等字段 |

## 9. 第一轮执行顺序

第一轮只做 5 个小步：

1. 新增 DOM snapshot schema。
2. 新增 AI 输出 schema。
3. 新增 `capture_current_comment_dom_snapshot` MCP tool。
4. 新增 AI 结构化 prompt 模板。
5. 新增 AI 输出到 normalized JSONL 的转换脚本。

第一轮完成后，推荐调用链变成：

```text
1. expand_current_page_comments
2. capture_current_comment_dom_snapshot
3. Codex/AI 读取 comment-dom-snapshot.json 并输出 ai-comment-extraction.json
4. normalize-ai-comment-extraction.js
5. prepare-comment-ai-review.js / build-comment-excel-report.js
```

## 10. 测试策略

### 10.1 单元测试

- snapshot schema 校验。
- AI 输出 schema 校验。
- DOM chunk 限制：
  - 不超过 `maxChunks`。
  - 不超过 `maxCharsPerChunk`。
  - 不包含 `script/style/svg`。
- 归一化脚本：
  - 结构化 rows 转 `normalized-comments.jsonl`。
  - rejected 不进入 normalized。
  - `source_chunk_id` 保留到 `raw`。

### 10.2 手工验收

抖音和小红书各跑 1 条页面：

```text
平台：
URL：
snapshot chunkCount：
AI rows：
AI rejected：
人工抽样 20 条：
  非评论污染数：
  用户名错误数：
  正文错误数：
  时间/地区错误数：
结论：
```

验收目标：

- AI rows 中不应出现页脚、播放器、笔记正文、推荐区。
- 用户名和正文拆分明显优于旧 `text` 粘连输出。
- 每条结构化评论都能回溯到 `source_chunk_id`。

## 11. 风险与取舍

- AI 结构化会消耗 token，但比 Codex 操控浏览器逐轮点击更可控。
- Snapshot 过大仍会拖慢 AI，所以必须有 chunk 和字符上限。
- Snapshot 过窄可能漏评论，所以第一版要保留 `role_hint=comment_region` 的上下文块。
- AI 可能误判字段，因此必须保留 `evidence` 和 `source_chunk_id` 供抽样 QA。
- 旧的 `save_current_page_comments` 可以保留兼容，但不再作为高质量结构化主路径。

## 12. 完成标准

改造完成后应满足：

- MCP 不再承担复杂评论字段抽取。
- MCP 可以快速展开、下滚，并返回/保存有限 DOM snapshot。
- AI 可以基于 snapshot 输出结构化评论 JSON。
- 本地脚本能把 AI JSON 转为现有 normalized JSONL。
- 后续 AI 语义分析和 Excel 报表继续复用。
