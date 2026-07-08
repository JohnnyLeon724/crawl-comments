# 半自动可复跑评论 Excel 交付流水线计划书

更新时间：2026-07-08

## 1. 目标

建设一条从客户需求 Excel 到交付 Excel 的半自动、可复跑、可审计流水线。

第一版标准交付模板以 `docs/michelin_kol_comments_all_platforms_0630.xlsx` 为准，默认输出三张表：

1. `汇总`
2. `阶段汇总`
3. `评论明细`

核心分工：

```text
脚本
  -> 解析客户需求表
  -> 生成任务清单
  -> 校验和归一化 AI 输出
  -> 生成交付 Excel
  -> 管理运行状态、断点续跑和 QA

MCP
  -> 连接已登录 Chrome
  -> 展开评论和回复
  -> 下滚到停止
  -> 保存有限 DOM snapshot

AI
  -> 阅读 DOM snapshot
  -> 判断哪些是真评论
  -> 拆分用户名、正文、时间、地区、点赞、回复关系
  -> 输出结构化 JSON
```

这条路线避免让 AI 直接写 Excel，也避免让脚本硬猜复杂 DOM 语义。

## 2. 现有基础

当前项目已经具备以下能力：

| 能力 | 状态 | 现有文件 |
|---|---|---|
| 页面评论展开和下滚 | 已完成 | `script/expand-comments-v1.js` |
| Playwright 单链接采集 | 已完成 | `script/crawl-comments-playwright.js` |
| MCP 展开当前页面 | 已完成 | `mcp/comment-crawler-tools.js` |
| MCP DOM snapshot | 已完成 | `capture_current_comment_dom_snapshot` |
| DOM snapshot schema | 已完成 | `schemas/comment-dom-snapshot.schema.json` |
| AI 结构化输出 schema | 已完成 | `schemas/ai-comment-extraction.schema.json` |
| AI 结构化 prompt | 已完成 | `prompts/comment-dom-extraction.md` |
| AI 输出归一化 | 已完成 | `script/normalize-ai-comment-extraction.js` |
| 旧版评论 Excel 报表 | 已完成 | `script/build-comment-excel-report.js` |

下一阶段不重写这些能力，而是在其上补齐客户需求表解析、项目级运行目录、交付模板生成和 QA。

## 3. 输入与输出

### 3.1 输入：客户需求表

第一版按 `docs/米其林评论区分析KOL link-0630.xlsx` 的字段识别：

| 客户表字段 | 标准任务字段 | 说明 |
|---|---|---|
| `序号` | `source_index` | 客户表序号 |
| `账户ID` | `creator_name` | 博主或账号名称 |
| `发布平台` | `platform` | 抖音、小红书、B站等 |
| `发布日期` | `published_at_text` | 保留客户原始日期文本 |
| `发布链接` | `source_url_text` | 原始链接文本，可能混有分享文案 |
| `播放量/曝光` | `exposure_count` | 内容曝光或播放 |
| `互动总量` | `engagement_count` | 内容互动量 |
| `评论数` | `expected_comment_count` | 客户表中的评论量 |
| Excel 行号 | `source_excel_row` | 便于回溯 |

输出任务文件：

```text
output/<project_id>/crawl-tasks.json
```

任务示例：

```json
{
  "task_id": "task_0001",
  "phase": "KOL link-0630",
  "source_excel_row": 2,
  "source_index": "1",
  "platform": "douyin",
  "creator_name": "DJ初仔大朋友",
  "published_at_text": "6.15",
  "source_url_text": "https://v.douyin.com/PLP7UJ1YqCU/ E@H.iP 09/17 :1pm eBG:/",
  "source_url": "https://v.douyin.com/PLP7UJ1YqCU/",
  "exposure_count": 4604000,
  "engagement_count": 134000,
  "expected_comment_count": 2922,
  "status": "pending"
}
```

### 3.2 中间产物

每条任务一个运行目录：

```text
output/<project_id>/runs/<task_id>/
  task.json
  comment-dom-snapshot.json
  ai-comment-extraction.json
  normalized-comments.jsonl
  qa.json
```

项目级产物：

```text
output/<project_id>/
  crawl-tasks.json
  run-manifest.json
  all-normalized-comments.jsonl
  delivery.xlsx
  qa-summary.json
```

### 3.3 输出：交付 Excel

第一版交付 Excel 结构对齐 `docs/michelin_kol_comments_all_platforms_0630.xlsx`。

`汇总`：

| 字段 | 来源 |
|---|---|
| `阶段` | 项目参数或客户表批次名 |
| `Excel行` | 客户表行号 |
| `序号` | 客户表 `序号` |
| `平台` | 任务平台 |
| `博主昵称` | 客户表 `账户ID` |
| `发布日期` | 客户表 `发布日期` |
| `源表链接` | 清洗后的客户表链接 |
| `实际打开URL` | MCP/页面最终 URL |
| `已抓评论数` | 归一化评论行数 |
| `主评论数` | `row_type=level1` 数量 |
| `回复数` | `row_type=level2` 数量 |
| `状态` | `ok`、`partial`、`failed` |
| `备注` | 异常说明 |

`阶段汇总`：

按阶段和平台聚合内容数、已抓评论数、主评论数、回复数。

`评论明细`：

| 字段 | 来源 |
|---|---|
| `阶段` | 任务上下文 |
| `Excel行` | 客户表行号 |
| `序号` | 客户表 `序号` |
| `博主昵称` | 客户表 `账户ID` |
| `平台` | 任务平台 |
| `发布日期` | 客户表 `发布日期` |
| `页面链接` | 实际打开 URL |
| `内容互动量` | 客户表 `互动总量` |
| `源表评论数` | 客户表 `评论数` |
| `楼层信息` | 归一化生成 |
| `评论类型` | 主评论或回复 |
| `父楼层` | 回复对应主评论楼层 |
| `回复序号` | 回复在父楼层下的序号 |
| `评论人` | AI 提取 `user_name` |
| `评论内容` | AI 提取 `text` |
| `回复对象` | AI 提取或归一化推断 |
| `点赞数` | AI 提取 `like_count` |
| `评论时间/地区` | `created_at` 和 `ip_location` 拼接 |

## 4. 推荐工作流

### 4.1 项目初始化

```bash
python script/parse_client_requirements.py \
  --input "docs/米其林评论区分析KOL link-0630.xlsx" \
  --phase "KOL link-0630" \
  --out-dir output/michelin_kol_0630
```

生成：

```text
output/michelin_kol_0630/crawl-tasks.json
```

### 4.2 单条任务采集

由 Codex 调用 `comment-crawler-v2`：

```text
1. 打开或确认目标页面
2. expand_current_page_comments
3. capture_current_comment_dom_snapshot
```

每个任务保存：

```text
output/michelin_kol_0630/runs/task_0001/comment-dom-snapshot.json
```

### 4.3 AI 结构化

Codex 读取：

```text
prompts/comment-dom-extraction.md
schemas/ai-comment-extraction.schema.json
output/michelin_kol_0630/runs/task_0001/comment-dom-snapshot.json
```

输出：

```text
output/michelin_kol_0630/runs/task_0001/ai-comment-extraction.json
```

### 4.4 归一化

```bash
node script/normalize-ai-comment-extraction.js \
  --run-dir output/michelin_kol_0630/runs/task_0001 \
  --platform douyin
```

后续需要增强为带客户任务上下文：

```bash
node script/normalize-ai-comment-extraction.js \
  --run-dir output/michelin_kol_0630/runs/task_0001 \
  --task output/michelin_kol_0630/runs/task_0001/task.json
```

### 4.5 项目级合并与 Excel 生成

```bash
python script/build_client_comment_excel.py \
  --project-dir output/michelin_kol_0630 \
  --template docs/michelin_kol_comments_all_platforms_0630.xlsx \
  --out output/michelin_kol_0630/delivery.xlsx
```

## 5. 阶段计划

阶段按执行顺序排序，同时兼顾收益和成本。

| 阶段 | 状态 | 任务 | 收益 | 成本 | 交付物 | 验收标准 |
|---|---|---|---:|---:|---|---|
| 0 | 已完成 | 明确半自动边界 | 很高 | 低 | 本文档方向 | 脚本管确定性，AI 管理解，MCP 管页面动作 |
| 1 | 已完成 | 客户需求表解析 | 很高 | 低 | `src/pipeline/parse_client_requirements.py`、`crawl-tasks.json` | 能从客户表生成任务，链接清洗正确 |
| 2 | 已完成 | 任务运行目录规范 | 高 | 低 | `task.json`、`run-manifest.json` | 每条任务有独立目录和状态 |
| 3 | 已完成 | MCP DOM snapshot | 很高 | 已投入 | `comment-dom-snapshot.json` | 当前页面可保存 bounded DOM chunks |
| 4 | 已完成 | AI DOM 结构化契约 | 很高 | 已投入 | prompt + schema | AI 输出 rows/rejected 且可引用 chunk |
| 5 | 已完成 | 归一化携带客户上下文 | 很高 | 中 | 增强 `normalized-comments.jsonl` | 每条评论能回溯到客户表行和任务 |
| 6 | 已完成 | 项目级合并脚本 | 高 | 低 | `all-normalized-comments.jsonl` | 多任务评论可合并、去重、保序 |
| 7 | 已完成 | 交付 Excel 生成器 | 很高 | 中 | `src/pipeline/build_client_comment_excel.py`、`delivery.xlsx` | 生成 `汇总`、`阶段汇总`、`评论明细` |
| 8 | 待开始 | 项目结构解耦与仓库瘦身 | 高 | 中 | 分层目录、归档目录、清理清单 | 脚本、测试、文档、样例数据分类清楚，删除或归档非必须文件 |
| 9 | 待开始 | QA 与差异标记 | 高 | 中 | `qa-summary.json`、Excel 状态列 | 识别 `ok/partial/failed` 和数量差异 |
| 10 | 待开始 | 批量断点续跑 | 高 | 中 | `resume` 工作流 | 失败任务可重跑，不覆盖已完成任务 |
| 11 | 待开始 | B站字段兼容 | 中 | 中 | B站 adapter 映射 | 兼容 `bilibili_comments_all_phases.xlsx` 的字段习惯 |
| 12 | 待开始 | 沉淀为 Codex skill | 中高 | 低 | `comment-excel-delivery` skill | Codex 可按固定流程处理新客户表 |

## 6. 第一轮开发范围

第一轮只做确定性脚本，不碰新的浏览器自动化。

1. `src/pipeline/parse_client_requirements.py`
   - 读取客户需求表。
   - 清洗链接文本。
   - 标准化平台名。
   - 输出 `crawl-tasks.json`。
2. `schemas/crawl-task.schema.json`
   - 固化任务字段。
3. `build_client_comment_excel.py` 的最小版本
   - 输入已有 `normalized-comments.jsonl` 和任务上下文。
   - 输出三张表结构。
4. 单元测试
   - 客户表样例解析。
   - 链接清洗。
   - Excel 字段映射。

第一轮验收不要求真实抓取新评论，只要求能把“已有归一化评论 + 客户任务上下文”整理成标准交付 Excel。

## 7. 项目结构解耦与清理原则

随着任务解析、MCP、AI 结构化、Excel 交付、QA 和 skill 化逐步增加，继续把所有脚本放在 `script/`、所有测试放在 `test/` 会很快失控。

结构整理不应在第一天做大搬家，但必须在交付 Excel 闭环跑通后、批量断点续跑前完成。否则后续新增平台、模板和测试时会越来越难维护。

### 7.1 目标结构

建议逐步演进为：

```text
src/
  browser/
    expand-comments-v1.js
  mcp/
    comment-crawler-server.js
    comment-crawler-tools.js
    comment-crawler-dom-snapshot.js
  pipeline/
    parse_client_requirements.py
    merge_comment_runs.py
    qa_comment_delivery.py
    build_client_comment_excel.py
  normalize/
    normalize-ai-comment-extraction.js
    normalize-comments.js
  adapters/
    douyin.js
    xiaohongshu.js

tests/
  mcp/
  pipeline/
  normalize/
  adapters/
  fixtures/

docs/
  active/
  archive/
  handoff/
  examples/

schemas/
  crawl-task.schema.json
  comment-dom-snapshot.schema.json
  ai-comment-extraction.schema.json

prompts/
  comment-dom-extraction.md
```

第一版可以保留旧路径兼容入口，例如 `script/normalize-ai-comment-extraction.js` 继续存在，但内部转调新位置，避免已有命令立即失效。

### 7.2 清理范围

清理要分三类处理：

| 类型 | 处理方式 | 示例 |
|---|---|---|
| 当前仍被命令或测试引用 | 保留，必要时迁移并留下兼容入口 | MCP server、归一化脚本、schema |
| 已完成但仍有参考价值 | 移入 `docs/archive/` 或 `docs/examples/` | 旧演进计划、历史 handoff、样例交付说明 |
| 无引用、重复、临时调试文件 | 删除 | 临时测试输出、重复 fixture、过期手工脚本 |

删除前必须做引用检查：

```bash
rg "文件名或核心函数名"
```

测试文件不按“写完功能就删”的方式处理。只有当测试覆盖重复、目标代码已删除、或测试只验证旧行为且会误导维护时，才合并或删除；删除测试前必须有替代测试覆盖同一风险。

### 7.3 验收标准

项目结构阶段完成时应满足：

1. 核心入口有清晰目录归属：浏览器、MCP、pipeline、normalize、adapters。
2. 测试目录按模块分类，不再全部堆在单层 `test/`。
3. 文档分为 active、archive、handoff、examples。
4. 非必须文件有清理清单，说明删除或归档原因。
5. 旧命令仍可运行，或在文档中明确替代命令。
6. 全量测试通过。

## 8. QA 规则

每条任务生成 QA 结果：

| 检查项 | 规则 |
|---|---|
| 评论数差异 | `已抓评论数 / 源表评论数 < 80%` 标记 `partial` |
| 空正文 | `text` 为空的行不进入交付明细 |
| 噪声评论 | 命中页脚、登录、播放器、推荐区关键词时进入 `rejected` |
| 重复评论 | 使用 `row_key` 去重 |
| 缺少用户名 | 保留行，但 QA 标记 `missing_user_name` |
| 缺少时间地区 | 保留行，但 QA 标记 `missing_time_or_location` |
| AI 证据回溯 | 每条 AI 行必须有 `source_chunk_id` |

Excel 中至少保留任务状态和备注；详细 QA 可以放在 `qa-summary.json`，后续需要时再加隐藏工作表。

## 9. Skill 化方案

最终工作流适合整理成 Codex skill，但不建议第一天就做。

原因：

1. 代码和字段契约还会迭代。
2. Skill 应该固化稳定流程，而不是承载频繁变化的实现细节。
3. 先用文档和脚本跑通 2-3 次真实交付，再沉淀为 skill，质量会更高。

建议 skill 名称：

```text
comment-excel-delivery
```

建议目录：

```text
.codex/skills/comment-excel-delivery/
  SKILL.md
  references/
    workflow.md
    excel-template-fields.md
    qa-rules.md
    ai-extraction-contract.md
```

Skill 只保存流程和判断标准，不复制项目脚本：

| 文件 | 内容 |
|---|---|
| `SKILL.md` | 触发条件、总流程、何时读取哪些 reference |
| `workflow.md` | 从客户表到交付 Excel 的步骤 |
| `excel-template-fields.md` | `汇总`、`阶段汇总`、`评论明细` 字段规则 |
| `qa-rules.md` | partial、failed、噪声、缺失字段判断 |
| `ai-extraction-contract.md` | DOM snapshot 到 AI JSON 的契约 |

触发示例：

```text
按评论交付流水线处理这个客户表
把这批 KOL 链接采集评论并生成交付 Excel
根据客户需求表生成评论明细和汇总表
```

## 10. 风险与取舍

| 风险 | 影响 | 应对 |
|---|---|---|
| 平台登录态失效 | 无法采集或只采到登录墙 | MCP 前置状态检查，失败写入 manifest |
| 评论虚拟列表导致漏采 | 评论数低于客户表 | QA 标记 `partial`，支持重跑 |
| AI 错拆用户名和正文 | Excel 字段污染 | 保留 `source_chunk_id`，抽样回查 |
| 客户表格式变化 | 解析失败 | 第一版支持固定模板，后续加字段别名 |
| 多平台字段差异 | Excel 格式不统一 | 统一交付字段，平台特有字段放 raw/备注 |
| 直接全自动批跑触发异常 | 成功率低 | 第一版保持半自动串行，可人工介入 |
| 过早大规模重构目录 | 影响已有命令和测试 | 先跑通交付闭环，再迁移；保留兼容入口 |
| 删除历史文件导致追溯断层 | 难以解释旧决策 | 优先归档，确认无引用和无价值后再删除 |

## 11. 推荐执行顺序

下一步按以下顺序开发：

1. 实现客户需求表解析和任务 schema。
2. 实现项目运行目录和任务 manifest。
3. 增强 AI 归一化结果，使评论行带客户任务上下文。
4. 实现标准交付 Excel 生成器。
5. 做项目结构解耦与仓库瘦身，保留旧入口兼容。
6. 用 `docs/米其林评论区分析KOL link-0630.xlsx` 和已有交付表做回归对照。
7. 跑一条抖音和一条小红书真实任务，验证从 DOM snapshot 到 Excel 的闭环。
8. 两次真实交付稳定后，再创建 `comment-excel-delivery` skill。
