# TCL 微博评论 Chrome 采集项目演进计划书

更新时间：2026-07-10
状态：设计已确认，待实施

## 1. 目标与已确认边界

将 TCL 微博流程中的“评论采集”从浏览器登录态下的微博接口调用，迁移为 **Codex Chrome 插件驱动的可见 DOM 采集 + 模型结构化提取**。目标是让微博与当前抖音、小红书评论交付链路使用同一套任务、证据、标准化、QA 和 Excel 交付能力。

本次确认的边界如下：

1. 保留关键词找帖和官号发帖的现有接口流程；它们不属于本项目迁移范围。
2. 停止在生产评论采集中调用 `statuses/show`、`buildComments` 或 OpenCLI 评论接口；微博评论只能来自用户已登录 Chrome 中可见的评论区。
3. 保留旧流程语义：分别采集“按热度”和“按时间”两条一级评论流，合并去重；并抓取每条一级评论下所有在 UI 中可安全展开的二级回复。
4. 登录、验证码、风控、页面访问限制由用户在 Chrome 中处理。遇到这些状态立即停止并记录，不绕过、不改用接口。
5. 模型只从已保存的、范围受限的评论 DOM 候选中识别字段；模型不控制浏览器、不访问 URL、不生成评论身份字段。

## 2. 当前基线与关键缺口

当前项目已经在 `schemas/crawl-task.schema.json`、`schemas/comment-row.schema.json` 和客户表解析器中支持 `weibo` 平台。但它还不能安全地执行微博 Chrome 评论采集，原因如下：

| 能力 | 当前情况 | 本项目处理方式 |
|---|---|---|
| Chrome 评论 profile | `src/browser/chrome-comment-capture.js` 只有 Douyin 内置 profile | 先以真实微博页面探测出唯一评论区域，再新增 Weibo profile |
| AI 提取 schema | `schemas/ai-comment-extraction.schema.json` 不允许 `weibo` | 增加 `weibo`，并为 Codex 使用严格兼容副本 |
| 微博帖子 ID | `normalize-ai-comment-extraction.js` 只解析 Douyin/Xiaohongshu | 新增 Weibo URL 适配器，生成稳定帖子标识 |
| 双排序去重 | 现有 `row_key` 依赖 batch 与候选 ID，跨排序流不能保证去重 | 采集 DOM 中的稳定评论身份；缺失时不得宣称双流完整 |
| QA | 目前只保存单一 `capture-state.json` 观察值 | 分别记录两个排序流、一级评论计数和回复展开状态 |

其中“稳定评论身份”是上线硬门槛。旧接口有 `comment_id`；Chrome 方案必须从可见 DOM 属性、评论链接或页面嵌入的评论标识中确定性读取 `source_comment_id`、父评论 ID 和根评论 ID。模型不得推测这些 ID。若真实 DOM 不提供可验证身份，则双排序结果只能标为 `partial`，不能以“用户名 + 文本”猜测后认定全量。

## 3. 目标架构

```text
既有微博帖子 URL 清单
  -> 每帖一个 Chrome 新标签页（复用用户登录态）
  -> 在唯一微博详情根内安全打开评论区
  -> 在唯一评论面板内采集“按热度”流
       -> 精确展开安全的二级回复 -> 容器滚动 -> DOM 候选批次
  -> 在同一评论面板内采集“按时间”流
       -> 精确展开安全的二级回复 -> 容器滚动 -> DOM 候选批次
  -> 以 DOM 稳定身份合并候选；每次滚动只作为断点证据
  -> 按模型上下文自适应切分候选（不是按滚动次数）
  -> Codex 模型按严格兼容 schema 输出结构化行
  -> 确定性写入微博 ID / 父子关系 / row_key
  -> 合并、QA、微博评论语义审阅、既有 Excel 报表
```

所有项目产物继续放在 `output/<project_id>/runs/<task_id>/`。每个浏览器滚动窗口仍保存为 `batches/<batch_id>/comment-dom-batch.json`，用于可审计性和断点续跑；但模型输入先汇总、去重，再按内容量切分，避免把每次滚动机械地变成一次模型调用。

## 4. 安全 Chrome 交互设计

### 4.1 先做真实页面探测，再固化 profile

实施的第一步不是猜 CSS selector。选择至少 3 条已登录可访问的微博详情页：少评论、评论较多且有回复、含长文本或图片/视频的一条。每条页面必须记录：

- 唯一帖子详情根与唯一评论面板的 selector、计数和截图；
- 评论入口、排序控件、评论滚动容器、一级评论节点、回复容器、结束文本；
- 可读的评论 ID / 父 ID / 根 ID 来源，以及它在滚动和排序切换后是否稳定；
- 二级回复的实际展开文案与展开后的状态变化；
- 访问受限、登录失效或验证码的可识别页面信号。

只有当评论面板和评论节点都能证明唯一性，才把 selector 写入 `PLATFORM_PROFILES.weibo`。探测失败不进入自动滚动阶段。

### 4.2 控件白名单

- 打开评论区：仅在唯一帖子详情根内操作经探测确认的评论入口；不能以全页“评论”文字匹配。
- 切换排序：仅在唯一评论面板内点击精确的“按热度”或“按时间”，并在点击后验证选中态或列表内容已变化。
- 展开二级回复：仅接受探测中出现且经白名单确认的精确回复展开文本；继续拒绝“收起”“展开全文”“商品”“详情”和泛化“回复”按钮。
- 滚动：仅使用 Chrome CUA 在已验证的评论滚动容器坐标内滚动；每次滚动后重新读取该容器。
- 页面操作后发现意外新标签页时，关闭该意外标签，只保留当前任务标签。

Chrome 页面读取只允许评论根范围内的文本、局部 HTML、可见控件和公开 DOM 属性；不得读取 Cookie、Local Storage、账号资料或执行接口请求。

## 5. 数据契约与确定性归一化

### 5.1 候选批次

保留 `comment-dom-batch-v1` 文件名和既有字段，并为每个 candidate 增加可选、确定性来源字段：

```json
{
  "capture_sort_mode": "hot",
  "source_comment_id": "…",
  "source_parent_comment_id": "…",
  "source_root_comment_id": "…"
}
```

`capture_sort_mode` 只能为 `hot` 或 `time`。三个来源 ID 必须由 Chrome 读取 DOM 得到；没有值时保留空字符串并记录其来源缺失。候选去重优先级固定为：`source_comment_id`，其次为同一根评论下的 `作者 + 正文 + 时间` 复合指纹。后者只用于降低重复候选，不能满足双流全量门槛。

### 5.2 模型提取与 schema

模型输出继续使用 `ai-comment-extraction-v1`：它负责从 `source_chunk_id` 对应的候选中提取 `row_type`、用户、正文、时间、点赞、回复对象和根评论正文；不新增由模型填写的评论 ID 字段。

需要完成以下兼容性改动：

1. 在 canonical schema 中允许 `platform: weibo`。
2. 所有 Codex CLI 调用先用 `src/normalize/model-output-schema.js` 从 canonical schema 生成同目录的 `model-output-schema.json`，再传给 `--output-schema`。
3. canonical schema 保持项目可选字段语义；严格副本将对象的全部 properties 写入 `required` 并设置 `additionalProperties: false`，以兼容本机强制 schema 模式。

归一化器按 `source_chunk_id` 查回 candidate 元数据，确定性写入 `comment_id`、`parent_comment_id`、`root_comment_id`。`row_key` 在有 `source_comment_id` 时只基于 `platform + source_url + source_comment_id` 生成；因此同一评论在热度流、时间流或断点重跑中仍是同一行。新增 `src/adapters/weibo.js` 从微博 canonical URL 生成稳定 `post_id`。

## 6. 批处理策略

浏览器批次和模型批次必须分开：

| 层级 | 单位 | 目的 | 规则 |
|---|---|---|---|
| 任务 | 一条微博 | 隔离登录态、失败和恢复 | 每帖一个 `runs/<task_id>/` |
| 浏览器证据 | 一次安全滚动窗口 | 可恢复、可追溯 DOM 采集 | 每次窗口落一个 batch；不直接等于模型调用 |
| 模型输入 | 已去重候选集合 | 字段结构化 | 默认最多 80 条或 24,000 个候选文本字符，先触及者切分 |
| 语义审阅 | 已标准化评论 | 情感与负面主题 | 维持现有 50 条默认批量，可按模型稳定性调整 |

因此小微博（例如不超过 80 条候选评论）只产生一次模型提取；大微博会有多个浏览器证据批次，但只有少量内容批次。模型单批失败可以仅重跑该内容批，不重新滚动页面。

## 7. 完成门槛与异常语义

每条微博在 `capture-state.json` 中保存 `streams.hot` 和 `streams.time`，每条流均记录排序验证、滚动轮数、结束信号、唯一一级评论数、唯一回复数、剩余展开数和失败原因。

| 结果 | 判定 |
|---|---|
| `ok` | 热度流和时间流均完成；安全回复展开耗尽；候选有稳定身份；所有模型批次、标准化和 QA 通过；一级评论计数与平台可见声明值达到既有 80% 质量阈值（如声明值可读） |
| `partial` | 任一排序不可安全切换、DOM 身份缺失、可见评论数量低于阈值、回复不能完全展开、模型批次缺失、滚动无进展或已知 UI 限制 |
| `failed` | 登录/验证码/风控、唯一根无法确认、评论区无法打开、零条采集或不可恢复的模型失败 |

平台展示评论数、采集到的唯一一级评论数、采集到的回复数须分开保存。不得把二级回复计入一级评论覆盖率，也不得用评论总数差异自动伪造失败或成功。

`partial` 任务保留所有已获得的证据，交由 `resume_comment_project.py` 生成续跑计划；只有项目 QA 为 `ok` 才能作为正式全量交付生成 Excel。用户明确要求的测试/样例交付除外，必须标注其范围。

## 8. 实施阶段与验收

### 阶段 A：微博 DOM 可行性门

使用 Chrome 插件完成三类真实页面探测，不写生产 selector。交付探测记录、三份受限候选样本和 selector/身份稳定性结论。

验收：每个自动化动作均有唯一 scope；至少一个热点流与时间流切换可验证；至少一条一级评论和一条二级回复具有可复现的稳定 DOM 身份。任何一项不满足时，暂停自动化实现并输出受阻证据。

### 阶段 B：Chrome profile 与候选身份

实现 Weibo profile、唯一根验证、评论入口、排序流状态机、精确回复展开、容器滚动和扩展候选 schema。为无进展、错误排序状态、意外新标签、登录墙和身份缺失写独立测试。

验收：模拟测试覆盖每一种拒绝路径；真实页面的热度流和时间流分别写出可验证的候选 batch 与状态。

### 阶段 C：模型结构化与标准化

实现微博 URL adapter、AI extraction schema 的 `weibo` 枚举、严格 schema 副本生成调用，以及基于 DOM 身份的跨流去重与父子关系写回。

验收：同一 `source_comment_id` 出现在两个 batch 后仅保留一条 normalized row；模型无法输出或篡改 DOM 身份；严格模型 schema 能被本机 Codex CLI 接受。

### 阶段 D：QA、恢复与试运行

扩展 QA 为双排序流指标，生成带明确 `ok` / `partial` / `failed` 原因的恢复计划。用一组小规模 TCL 微博链接跑到现有评论语义审阅和 Excel 报表，不在试运行中调用微博评论接口。

验收：完整任务能从 Chrome evidence 到 Excel 闭环；故意删除一个模型批次或模拟排序不可用时，QA 必须是 `partial` 而非 `ok`。

## 9. 计划涉及的文件

| 文件 | 计划改动 |
|---|---|
| `src/browser/chrome-comment-capture.js` | 增加受实页探测验证的 Weibo profile、排序流和候选来源身份支持 |
| `schemas/comment-dom-batch.schema.json` | 允许 `weibo` 及候选的排序/来源身份字段 |
| `schemas/ai-comment-extraction.schema.json` | 允许 `weibo`，保持模型不负责身份字段 |
| `src/adapters/weibo.js` | 解析和规范化微博帖子 URL 标识 |
| `src/normalize/normalize-ai-comment-extraction.js` | 回填 DOM 身份、微博 `post_id`、跨流稳定去重 |
| `src/normalize/model-output-schema.js` | 复用于提取模型 strict schema 生成 |
| `src/pipeline/merge_task_batches.py` | 以稳定 row key 合并跨流/重跑 batch |
| `src/pipeline/qa_comment_delivery.py` | 增加双排序流和一级评论覆盖率 QA |
| `test/chrome-comment-capture.test.js` 等 | 为新 profile、身份、排序和 partial 门槛增加回归测试 |
| `docs/tcl_weibo_comment_workflow_rules_2026-07-07.md` | 将“评论接口优先”改为 Chrome 插件优先，保留找帖/发帖接口说明 |

## 10. 明确不做

- 不迁移关键词搜索和官号发帖接口。
- 不重新引入 MCP/CDP 或以接口作为微博评论采集的静默回退。
- 不保存或导出账号 Cookie、token、Local Storage。
- 不做并发多帖、多账号、验证码绕过、隐藏 API 调用或大规模高频抓取。
- 不让模型直接生成 Excel，也不让模型决定是否点击、滚动、排序或展开。
