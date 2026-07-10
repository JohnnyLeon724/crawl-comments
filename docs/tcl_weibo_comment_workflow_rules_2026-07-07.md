# TCL 微博评论抓取与评论内容处理规则说明

更新时间：2026-07-07  
适用目录：`/Users/koolou.zeng/Downloads/newskill`

## 1. 每次抓取的目标范围

当前 TCL 微博数据流程分两类抓取：

1. 关键词搜索帖子
   - 关键词：`tcl`、`tcl电视`、`tcl屏幕`
   - 时间：按任务指定，一般是“上一周到今天”
   - 目标：抓取搜索结果里的微博链接，去重后做帖子语义清洗和正负面标记

2. 官方账号帖子评论
   - 官方账号：
     - `TCL超极玩家`：`5656947064`
     - `TCL电视`：`1812511057`
   - 时间：按任务指定，一般是“上一周到今天”
   - 目标：抓取这两个官号在时间范围内发布的微博，再抓每条微博下的评论

如果要抓关键词帖子里的评论，输入可以换成关键词搜索去重后的微博链接文件，评论抓取脚本不限定只能抓官号。

## 2. 调用的功能组件

核心组件如下：

| 功能 | 组件/脚本 | 作用 |
|---|---|---|
| 搜索/官号发帖的登录态与接口调用 | `scripts/opencli-local.sh` | 固定使用项目内 `opencli-v1.6.8`，复用微博登录态；不用于评论采集 |
| 搜索关键词微博链接 | `scripts/search_weibo_links.js` | 打开微博搜索页，按关键词和时间抓全量搜索页 |
| 抓官号发帖 | `scripts/fetch_weibo_user_posts.js` | 通过微博用户发帖接口抓两个官号指定时间范围内的微博 |
| 批量抓评论 | `chrome:control-chrome` + `src/browser/chrome-comment-capture.js` | 在已登录 Chrome 的可见评论区采集双排序 DOM 证据 |
| 评论字段提取 | Codex 模型 + `src/normalize/model-output-schema.js` | 只从保存的候选 DOM 批次结构化评论字段 |
| 帖子语义审阅输入 | `scripts/prepare_weibo_semantic_review.py` | 把搜索帖子切分成语义审阅批次 |
| 评论语义审阅输入 | `scripts/prepare_weibo_comment_semantic_review.py` | 把评论/回复切分成语义审阅 prompt |
| 语义判定模型 | `/Applications/Codex.app/Contents/Resources/codex exec` | 按 JSON schema 输出语义判定结果 |
| 帖子语义输出 schema | `scripts/semantic_review_schema.json` | 约束帖子清洗和情感标记字段 |
| 评论语义输出 schema | `scripts/comment_semantic_review_schema.json` | 约束评论情感字段 |
| 帖子 Excel 报表 | `scripts/build_weibo_search_semantic_report.py` | 生成帖子清洗结果 Excel |
| 评论 Excel 报表 | `scripts/build_weibo_comment_semantic_report.py` | 生成评论负面识别 Excel，并按帖子楼层展示 |

## 3. 关键词微博链接抓取规则

执行脚本：

```bash
node scripts/search_weibo_links.js \
  --keyword 'tcl' \
  --start 2026-06-29 \
  --end 2026-07-06 \
  --pages all \
  --out-dir output/weibo_search_tcl_keywords_2026-06-29_to_2026-07-06
```

`tcl电视`、`tcl屏幕` 同样执行一次。

实际机制：

1. 打开 `s.weibo.com/weibo` 搜索页。
2. 参数使用 `q=<关键词>` 和 `timescope=custom:<start>-0:<end>-23`。
3. `--pages all` 表示不限制 50 页，持续翻页直到遇到停止条件。
4. 停止条件包括：
   - 页面为空
   - 结果页重复
   - 微博返回非 200
   - 明确指定页数时达到页数上限
5. 每页提取字段：
   - `author`
   - `time_text`
   - `primary_url`
   - `post_url`
   - `article_url`
   - `video_url`
   - `text`

搜索结果抓完后会做链接去重：

1. 同一条微博可能同时出现在多个关键词结果里。
2. 用 `primary_url / post_url / article_url / video_url` 的规范化 URL 做去重。
3. `source_keywords` 保留来源关键词，用 `|` 拼接，例如 `tcl|tcl电视`。
4. 去重后还会做“正文严格命中”检查：正文必须包含 `tcl`、`tcl电视`、`tcl屏幕` 之一。

## 4. 官号微博抓取规则

执行脚本：

```bash
node scripts/fetch_weibo_user_posts.js \
  --accounts 'TCL超极玩家=5656947064,TCL电视=1812511057' \
  --start 2026-06-29 \
  --end 2026-07-06 \
  --max-pages 10 \
  --out-dir output/weibo_official_posts_tcl_2026-06-29_to_2026-07-06
```

实际机制：

1. 通过微博接口 `https://weibo.com/ajax/statuses/mymblog` 抓账号发帖。
2. 按 `created_at` 判断是否落在开始和结束日期内。
3. 翻页到已明显早于开始日期后停止。
4. 按 `post_id` 或 `post_url` 去重。
5. 输出官号帖子 JSON 和 CSV，后续作为评论抓取输入。

## 5. 微博评论抓取规则

微博评论采集固定采用 **Chrome/model-only** 流程：必须用 `chrome:control-chrome` 操作用户已登录 Chrome 中可见的 Weibo 评论区，再由模型从已保存的 DOM 候选中提取字段。关键词找帖和官号发帖仍按第 3、4 节的接口流程执行；它们不授权接口抓取评论。

每条微博的执行顺序：

1. 在 Chrome 打开一个新的任务标签页，并通过已验证的 Weibo profile 确认唯一评论根、排序范围、评论节点、回复容器和滚动容器。profile 未通过唯一性/身份字段验证时停止为 `partial`，不得猜测 selector。
2. 只读取 explicit profile scope 内的可见文本、局部 HTML、公开 DOM 属性和控件；页面读取保持只读。登录、CAPTCHA、验证码、风控或访问限制出现时暂停，请用户处理；do not bypass，也不改用其他来源。
3. 在唯一排序范围内精确切换“按热度”，验证选中态后，安全展开可见的二级回复并仅滚动评论容器；记录每个滚动窗口的 `comment-dom-batch.json` 和 `capture-state.json`。
4. 在同一唯一排序范围内精确切换“按时间”，同样验证选中态、展开安全回复并采集。两个一级评论流按稳定证据合并去重；浏览器滚动批次只用于断点恢复与审计，不等于一次模型调用。
5. 先汇总、去重浏览器候选，再构造模型批次。每个模型批次最多 **80 candidates/24,000 characters**，先达到任一上限即切分。模型只从候选读取字段，不访问 URL、不控制浏览器、也不生成或改写身份字段。
6. 模型提取仍使用 canonical `schemas/ai-comment-extraction.schema.json` 的语义，但每次 Codex CLI 调用先由 `src/normalize/model-output-schema.js` 生成严格兼容的 `model-output-schema.json`，再传给 `--output-schema`。capture batch 是 evidence-only；只有 model batch 才需要 `ai-comment-extraction.json`。

评论身份与完成状态：

1. **DOM-ID 模式**：Chrome 从受限 DOM 读取 `source_comment_id`、`source_parent_comment_id` 和 `source_root_comment_id`。只有“按热度”和“按时间”均完成、回复安全展开耗尽、模型与 QA 通过且 DOM-ID 覆盖率满足门槛时，任务才可以为 `ok`。
2. **复合指纹模式**：页面没有稳定评论 ID 时，仅可由公开作者 UID href、规范化评论正文、时间、回复上下文和根评论上下文确定性生成 `source_composite_fingerprint`。它可用于去重和恢复，但任务始终是 `partial`，不得宣称双排序全量完成。
3. 排序无法验证、身份证据缺失、登录/验证码、根节点不唯一、回复无法完全展开或模型批次缺失时，保留审计产物并明确记录 `partial` 或 `failed` 原因。只有项目 QA 为 `ok` 才能生成正式全量交付；用户明确要求的测试样例必须标明范围。

Weibo 评论没有 MCP/API fallback：不得调用评论接口、MCP/CDP、OpenCLI 或隐藏 API 作为 Chrome 失败时的替代路径。

评论标准化结果的核心字段：

| 字段 | 含义 |
|---|---|
| `row_type` | `level1` 表示一级评论，`level2` 表示二级回复 |
| `post_id` / `post_url` | 所属微博 |
| `post_author_name` | 发帖账号 |
| `post_text` | 微博正文 |
| `comment_id` | 当前评论或回复 ID |
| `root_comment_id` | 所属一级评论 ID |
| `parent_comment_id` | 被回复的评论 ID |
| `floor_number` | 一级评论楼层 |
| `created_at` | 评论时间 |
| `user_name` | 评论人 |
| `text` | 评论内容 |
| `reply_to_user_name` | 二级回复的被回复人 |
| `root_user_name` / `root_text` | 根评论人和根评论内容 |

## 6. 帖子内容清洗规则

帖子清洗是语义判断，不用关键词机械判断负面或剔除。

保留标准：

1. 用户或第三方围绕 TCL/TCL电视/TCL屏幕的真实产品体验。
2. 产品问题、售后、服务、质量、安装、功能体验。
3. 购买咨询、对具体型号的讨论。
4. 具体产品卖点、优势、体验信息。
5. 内容虽然提到国补/优惠，但核心是在讲产品体验、技术卖点或产品优势时保留。

剔除标准：

1. 股票基金相关：股票、基金、股价、投资、财报、资本市场。
2. 市场趋势/技术研发/技术供应：产业趋势、供应链、面板/芯片/研发新闻，不是消费者产品讨论。
3. 会员/国补优惠/电商/经销商相关：核心是折扣、优惠、促销、销售转化时剔除。
4. 友商电视品牌相关：海信、创维、小米/Redmi、华为、长虹、康佳、三星、LG、索尼、松下等作为核心内容时剔除。
5. 抽奖/赛事赞助无关产品：用户转发抽奖、品牌赞助赛事、与产品无关活动。
6. 挂车带货/商品链接：内容里明显挂商品链接或导购转化。
7. 无来源技术爆料/评测者爆料：没有官方来源或更多信息支持的爆料、传闻式参数。
8. 产品品牌无关：只是碰巧出现 TCL，实际和 TCL 产品品牌无关。
9. TCL 官方账号发文：TCL电视、TCL超极玩家、TCL官方、TCL华星等官方/品牌账号发的文章。
10. 销售自嗨宣传：只堆产品名、价格、卖点口号，没有真实体验、问题、咨询或有效产品信息。

帖子情感规则：

1. 负面：对 TCL/TCL产品/服务/体验有明确不满、吐槽、质量/功能/售后问题、劝退或批评。
2. 正面：明确认可、推荐、满意、体验好，或具体肯定产品优势。
3. 中性：信息陈述、询问、转述，无明显褒贬。

帖子 Excel 输出：

1. `总结`
2. `清洗后微博`
3. `全部负面`
4. `全部正面`
5. `剔除微博`
6. `语义判定明细`

Excel 摘要里不写入：

1. 输入文件
2. 输入评论文件
3. 语义判定文件

## 7. 评论内容处理规则

评论处理只判断评论/回复本身对 TCL、TCL电视、TCL产品体验、售后服务、品牌、官方微博内容的态度。

必须遵守：

1. 必须基于整段语义理解判断。
2. 不用关键词或单个词触发结论。
3. 二级回复要结合根评论和被回复内容理解。
4. 最终情感只判断当前这一条评论或回复。

评论情感规则：

1. 负面：
   - 表达不满、投诉、嘲讽、贬低、质疑、失望。
   - 指向使用体验差、质量问题、功能问题、售后问题、价格质疑、营销反感等。
2. 正面：
   - 明确认可、夸奖、支持、表达满意或购买意愿。
3. 中性：
   - 无关闲聊、普通提问、转发口号、表情、看不出态度，或不是针对 TCL/TCL产品/官方内容。

负面主题填写规则：

1. 只在 `sentiment=负面` 时填写。
2. 用短语，不写长句。
3. 常见主题：
   - 产品体验
   - 质量问题
   - 售后服务
   - 价格质疑
   - 营销反感
   - 品牌嘲讽
   - 功能问题
   - 内容质疑
   - 其他负面

评论 Excel 输出：

1. `总结`
2. `按帖子楼层展示`
3. `负面评论`
4. `正面评论`
5. `全部评论语义明细`

`按帖子楼层展示` 的展示规则：

1. 同一条微博只显示一次微博正文。
2. 微博正文下面展示该微博的评论。
3. 一级评论显示为 `一级评论`。
4. 二级回复显示为 `二级回复`，内容前加缩进符号 `↳`。
5. 负面行标红，正面行标绿。
6. 保留评论时间、评论人、回复给、点赞数、情感、负面主题、语义依据等业务可读字段。

### 7.1 历史导入评论的例外边界

`docs/weibo_comments_all.xlsx` 是既有评论的 **历史导入** 分析输入，只读取 `微博汇总` 与 `评论明细`，不替代第 5 节的 Chrome/model-only 新评论采集。它必须和 Chrome `partial` 项目隔离，不能用历史评论补齐页面展示评论数、双排序覆盖率或任何实时采集缺口。

历史输入没有微博正文，因此 **不补读历史微博正文**：不得为了报表调用 Chrome、MCP/CDP、评论接口、OpenCLI 或任何其他来源补读正文。历史项目的 `按帖子楼层展示` 以博主、微博链接、阶段、互动量为每条微博的单次分组标题，随后按原始楼层连续展示一级评论和 `↳` 二级回复；不显示或编造正文。微博评论仍然没有 MCP/API fallback。

历史分析执行顺序如下：

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

模型审阅批次同时受 80 条和 24,000 字符限制，只用于上下文容量控制。`--resume` 只跳过 `row_key` 集合完整匹配的已完成输出。只有导入、严格审阅校验、60 条（或数据不足时全部）的抽样 QA 均完成，且 `semantic-qa-summary.json` 为 `ok` 时，才可由 Artifact Tool 生成五表 `delivery.xlsx` 并逐表渲染检查。

## 8. 语义模型调用方式

语义判定通过 Codex CLI 执行，并用 JSON schema 限制输出结构。

帖子语义判定示例：

```bash
/Applications/Codex.app/Contents/Resources/codex exec \
  --skip-git-repo-check \
  --cd /Users/koolou.zeng/Downloads/newskill \
  --sandbox read-only \
  --output-schema scripts/semantic_review_schema.json \
  -o review_001.json \
  - < prompt_001.txt
```

评论语义判定示例：

```bash
/Applications/Codex.app/Contents/Resources/codex exec \
  --skip-git-repo-check \
  --cd /Users/koolou.zeng/Downloads/newskill \
  --sandbox read-only \
  --output-schema scripts/comment_semantic_review_schema.json \
  -o review_001.json \
  - < prompt_001.txt
```

帖子 schema 要求输出：

1. `rank`
2. `url`
3. `decision`
4. `exclude_category`
5. `sentiment`
6. `negative_theme`
7. `reason`

评论 schema 要求输出：

1. `row_key`
2. `sentiment`
3. `negative_theme`
4. `reason`

## 9. 每次运行后的校验规则

每次交付前要检查：

1. 微博搜索页或官号页没有跳到登录页。
2. 搜索结果不是空跑。
3. 关键词帖子已去重。
4. 去重后的帖子正文确实包含 `tcl`、`tcl电视` 或 `tcl屏幕`。
5. 每条微博的 `capture-state.json`、双排序 stream 状态、模型批次和 QA 原因明确；`partial` 不得作为完整交付。
6. 评论总表里 `row_type` 能区分一级评论和二级回复。
7. 语义审阅结果条数和输入条数一致。
8. Excel 能正常打开。
9. Excel 摘要里不显示“输入文件 / 输入评论文件 / 语义判定文件”。
10. CSV 如果要给 Excel 直接打开，需要加 BOM，避免中文乱码。

## 10. 关键注意事项

1. 抓取依赖微博登录态，登录失效时会跳到 `passport.weibo.com/sso/signin`。
2. 搜索和官号发帖接口仍固定使用项目内 `scripts/opencli-local.sh`；微博评论采集不得使用该路径。
3. 评论必须使用 Chrome/model-only 双排序流程；没有 MCP/API fallback。
4. 异常微博不能静默跳过，必须保留 Chrome/model 审计产物并标记 `partial` 或 `failed`。
6. 语义判定要读整段文本，不用关键词做最终负面判断。
7. 帖子清洗和评论情感是两套规则：帖子先判断是否纳入分析，评论只判断当前评论/回复的态度。
