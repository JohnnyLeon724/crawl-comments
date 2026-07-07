# 评论采集、AI 结构化与 Excel 报表演进计划书

更新时间：2026-07-07

## 1. 目标

建设一个渐进式评论处理链路：

1. 用 Playwright 自动打开目标页面。
2. 注入页面内脚本完成评论展开、下滚和候选评论采集。
3. 保存原始评论结果，保证可复跑、可追溯。
4. 对评论做清洗、归一化和去重。
5. 使用 AI 按 JSON schema 做结构化判断。
6. 输出业务可读的 Excel 报表。

核心原则：高频机械动作由脚本完成，AI 只做低频理解和结构化，不让 Codex 或 AI 逐个按钮观察和点击。

## 2. 参考边界

可以参考 `NanmiCoder/MediaCrawler` 的架构思路：

- Playwright/CDP 复用浏览器登录态。
- 每个平台拆 adapter。
- 原始数据、处理结果和报表分层保存。
- 支持断点续跑、失败记录和配置化抓取。

不要直接复制它的代码。该项目许可证为非商业学习用途，并限制大规模抓取或影响平台运行。当前项目只把它作为设计参考。

## 3. 总体架构

```text
输入 URL / URL 列表
  -> Playwright Runner
  -> 注入 expand-comments-v1.js
  -> 页面内展开、下滚、候选评论采集
  -> Raw JSON / Raw CSV / manifest.json
  -> 平台 adapter 清洗与归一化
  -> AI 结构化批处理
  -> 结构化 JSONL
  -> Excel 报表
```

建议目录：

```text
scripts/
  crawl-comments-playwright.js
  normalize-comments.js
  prepare-comment-ai-review.js
  run-comment-ai-review.js
  build-comment-excel-report.js

adapters/
  douyin.js
  xiaohongshu.js

schemas/
  comment-row.schema.json
  comment-ai-review.schema.json

output/
  <run_id>/
    manifest.json
    raw-comments.json
    raw-comments.csv
    normalized-comments.jsonl
    ai-review-input/
    ai-review-output/
    comment-report.xlsx
```

## 4. 演进路线

阶段按执行顺序排序，同时兼顾收益和成本。优先做低成本、高收益、能减少后续返工的部分。

| 阶段 | 状态 | 任务 | 收益 | 成本 | 交付物 | 验收标准 |
|---|---|---|---:|---:|---|---|
| 0 | 已完成 | 明确合规、频率和数据边界 | 高 | 低 | 抓取规则说明 | 有速率限制、登录态说明、失败处理规则 |
| 1 | 已完成 | 稳定页面内展开脚本 | 高 | 低 | `script/expand-comments-v1.js` | 能自动展开、下滚、停止，并暴露 `getPayload()` |
| 2 | 已完成 | 实现单 URL Playwright Runner | 很高 | 中 | `script/crawl-comments-playwright.js` | 输入一个 URL，输出 raw JSON/CSV |
| 3 | 已完成 | 增加 `manifest.json` 与运行目录 | 高 | 低 | `output/<run_id>/manifest.json` | 成功、失败、耗时、URL、结果文件路径清楚 |
| 4 | 已完成 | 建立原始评论标准字段 | 高 | 中 | `schemas/comment-row.schema.json` | 不同平台评论能转成统一 row |
| 5 | 已完成 | 做抖音 adapter 精修 | 高 | 中 | `adapters/douyin.js` | 减少昵称、按钮、视频文案混入评论 |
| 6 | 已完成 | 批量 URL、断点续跑、失败重试 | 高 | 中 | 批量 runner 参数 | 中断后可 `--resume`，失败 URL 可重跑 |
| 7 | 已完成 | 评论清洗、去重、层级归一 | 高 | 中 | `normalized-comments.jsonl` | 一级评论、二级回复、父子关系和去重稳定 |
| 8 | 已完成 | AI 结构化 POC | 很高 | 中 | AI 输入批次、schema、输出 JSON | 少量评论能稳定输出情感、主题、依据 |
| 9 | 已完成 | Excel 报表生成 | 高 | 中 | `comment-report.xlsx` | 包含总结、全部评论、负面、正面、AI 明细 |
| 10 | 未开始 | 人工 QA 与 prompt 迭代 | 高 | 低 | QA 样本与误判记录 | 抽样检查误判可定位到 prompt 或清洗问题 |
| 11 | 未开始 | 扩展小红书 adapter | 中 | 中 | `adapters/xiaohongshu.js` | 复用同一 runner 输出标准 row |
| 12 | 未开始 | 工程化增强 | 中 | 高 | 配置文件、日志、测试夹具 | 可长期维护，但不阻塞前期收益 |

## 5. 各阶段说明

### 阶段 0：边界与规则

收益：避免后续功能越做越重，也避免把抓取速度调到容易触发风控。

建议规则：

- 默认单页面串行抓取，不做并发。
- 每轮点击、滚动、页面间切换都保留随机等待。
- 输出 raw 数据，不在抓取阶段直接覆盖清洗结果。
- 登录失效、风控页、空结果都写入 `manifest.json`。

### 阶段 1：页面内脚本

当前已有 `expand-comments-v1.js`，它负责：

- 批量点击“展开更多回复”等按钮。
- 自动滚动评论容器。
- 连续空转后自动停止。
- 采集候选评论。
- 提供 `getPayload()`、`getResults()`、`downloadJson()`、`downloadCsv()`。

下一步只需要根据真实抖音页面抽样修正 adapter，不要先重写成大框架。

### 阶段 2：单 URL Playwright Runner

这是近期收益最高的一步。

需要支持：

```bash
node scripts/crawl-comments-playwright.js \
  --url "https://www.douyin.com/..." \
  --cdp http://127.0.0.1:9222 \
  --out-dir output/run_2026-07-07_001
```

同时支持独立 profile：

```bash
node scripts/crawl-comments-playwright.js \
  --url "https://www.douyin.com/..." \
  --profile .pw-profile \
  --out-dir output/run_2026-07-07_001
```

验收重点：

- 能打开页面并注入 `expand-comments-v1.js`。
- 能等待 `window.__commentExpanderV1.getState().stopReason`。
- 能读取 `window.__commentExpanderV1.getPayload()`。
- 能保存 raw JSON、raw CSV、截图和 manifest。

### 阶段 3：manifest 与可追溯性

不要等批量化后才补 manifest。每次运行都应记录：

- `run_id`
- `platform`
- `source_url`
- `started_at`
- `finished_at`
- `status`
- `stop_reason`
- `raw_comment_count`
- `output_files`
- `errors`
- `crawler_config`

收益很高，因为后续 AI、Excel、重跑都依赖它判断数据是否可信。

### 阶段 4：标准评论 row

建议统一字段：

```json
{
  "row_key": "",
  "platform": "douyin",
  "source_url": "",
  "post_id": "",
  "row_type": "level1",
  "comment_id": "",
  "root_comment_id": "",
  "parent_comment_id": "",
  "user_name": "",
  "text": "",
  "created_at": "",
  "like_count": 0,
  "reply_to_user_name": "",
  "root_text": "",
  "raw": {}
}
```

第一版拿不到的字段可以留空。不要为了字段完美而阻塞抓取闭环。

### 阶段 5：抖音 adapter

目标是把候选 DOM 文本变成更干净的评论 row。

优先处理：

- 去掉“回复、点赞、展开回复”等 UI 文案。
- 区分一级评论和二级回复。
- 尽量提取昵称、时间、点赞数。
- 给每条评论生成稳定 `row_key`。

不要一开始就追求 100% 精准。先用 20 条样本建立误差清单，再逐步修。

### 阶段 6：批量、断点和重试

等单 URL 稳定后，再支持：

```bash
node scripts/crawl-comments-playwright.js \
  --input urls.txt \
  --out-dir output/run_2026-07-07_002 \
  --resume \
  --delay-ms 2000 \
  --retries 2
```

控制点：

- 默认串行。
- 每条 URL 独立输出。
- 失败不阻断全局任务。
- `manifest.json` 记录已成功 URL，`--resume` 跳过。

### 阶段 7：清洗与归一

把 raw comments 转成 normalized comments：

- 去重。
- 清空无效文本。
- 合并重复楼层。
- 补充 `row_key`。
- 保留 `raw` 字段，便于追溯。

这一阶段不使用 AI，保持确定性。

### 阶段 8：AI 结构化

AI 不参与爬取，只处理归一化后的评论。

建议 schema：

```json
{
  "row_key": "",
  "sentiment": "负面",
  "negative_theme": "售后服务",
  "reason": "",
  "confidence": "high"
}
```

批处理策略：

- 每批 30 到 80 条评论。
- 二级回复带上根评论和被回复内容。
- 输出必须受 JSON schema 约束。
- 每批单独保存，失败可单批重跑。

第一版主题先少一点：

- 产品体验
- 质量问题
- 售后服务
- 价格质疑
- 营销反感
- 品牌嘲讽
- 功能问题
- 内容质疑
- 其他负面

### 阶段 9：Excel 报表

参考当前微博规则，建议 sheet：

1. `总结`
2. `按帖子楼层展示`
3. `负面评论`
4. `正面评论`
5. `全部评论语义明细`
6. `抓取运行明细`

展示规则：

- 一级评论正常显示。
- 二级回复前加缩进符号。
- 负面行标红，正面行标绿。
- 总结页显示评论数、负面数、正面数、中性数、失败 URL 数。
- 不在摘要里显示本地输入文件路径。

### 阶段 10：QA 与 prompt 迭代

每次输出后抽样检查：

- 抽 20 条负面。
- 抽 20 条正面。
- 抽 20 条中性。
- 抽 20 条二级回复。

记录误判类型：

- 评论抽取错误。
- 清洗错误。
- 上下文不足。
- AI 判断错误。
- 主题分类不合适。

先修确定性问题，再修 prompt。

### 阶段 11：小红书 adapter

小红书已有 `clis/xiaohongshu/comments.js` 的 DOM 抽取思路可参考。扩展时保持同一个输出 schema，不要为小红书单独做一套报表。

第一版只要求：

- 单笔记评论。
- 可选楼中楼回复。
- 输出标准 row。
- AI 与 Excel 复用抖音链路。

### 阶段 12：工程化增强

等前面链路稳定后再做：

- 配置文件。
- 多平台统一 CLI。
- HTML fixture 回归测试。
- 更完整日志。
- 可视化 UI。
- Chrome 插件。
- 任务队列。
- 数据库。

这些投入较高，早做容易拖慢核心闭环。

## 6. 暂不建议做的事情

短期不要做：

- 直接接入或复制 MediaCrawler 代码。
- 并发抓取、多账号调度、代理池。
- 让 Codex/AI 逐个按钮操控浏览器。
- 一上来做完整 Web UI。
- 一上来做数据库和任务系统。
- 把 AI 判断塞进页面展开脚本。

原因：这些成本高、失败面大，而且会遮住当前最大的不确定性：真实页面评论能否稳定展开和抽取。

## 7. 最近三步

按投入产出比，下一步只做这三件事：

1. 写 `scripts/crawl-comments-playwright.js`，支持单 URL、CDP/profile、输出 raw JSON/CSV。
2. 用 1 条抖音 URL 跑通完整链路，检查 `stop_reason`、评论数量和 raw 文本质量。
3. 根据样本补 `adapters/douyin.js`，只修最明显的混入字段和层级问题。

这三步完成后，再进入批量 URL 和 AI 结构化。这样每一步都有可交付结果，也能及时发现页面结构、风控、登录态和抽取质量问题。
