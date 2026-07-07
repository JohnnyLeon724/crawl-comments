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
| 浏览器登录态与接口调用 | `scripts/opencli-local.sh` | 固定使用项目内 `opencli-v1.6.8`，复用微博登录态 |
| 搜索关键词微博链接 | `scripts/search_weibo_links.js` | 打开微博搜索页，按关键词和时间抓全量搜索页 |
| 抓官号发帖 | `scripts/fetch_weibo_user_posts.js` | 通过微博用户发帖接口抓两个官号指定时间范围内的微博 |
| 批量抓评论 | `scripts/fetch_weibo_comments_batch_all.js` | 按微博链接抓一级评论；`--mode all` 时继续抓二级回复 |
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

执行脚本：

```bash
node scripts/fetch_weibo_comments_batch_all.js \
  --input output/weibo_official_posts_tcl_2026-06-29_to_2026-07-06/weibo_official_posts_2026-06-29_to_2026-07-06.json \
  --out-dir output/weibo_official_comments_tcl_2026-06-29_to_2026-07-06 \
  --mode all \
  --resume \
  --delay-ms 150 \
  --post-delay-ms 400 \
  --fetch-timeout-ms 30000 \
  --opencli-command-timeout-ms 1800000 \
  --max-consecutive-failures 3 \
  --retries 2
```

评论抓取不是 DOM 滚动抓页面文本，而是在浏览器登录态里调用微博接口。

主要接口：

1. 微博正文元信息：
   - `https://weibo.com/ajax/statuses/show`
   - 参数：`id=<postId>`、`locale=zh-CN`、`isGetLongText=true`

2. 一级评论：
   - `https://weibo.com/ajax/statuses/buildComments`
   - 参数核心：
     - `id=<postId>`
     - `uid=<authorUid>`
     - `fetch_level=0`
     - `count=20`
     - `is_reload=1`
     - `is_show_bulletin=2`
     - `is_mix=0`
     - `locale=zh-CN`
   - 热门排序：默认参数
   - 时间排序：额外加 `flow=1`
   - 翻页：用接口返回的 `max_id`

3. 二级回复：
   - 仍然是 `https://weibo.com/ajax/statuses/buildComments`
   - 参数核心：
     - `id=<rootCommentId>`
     - `uid=<authorUid>`
     - `fetch_level=1`
     - `is_mix=1`
     - `max_id=<maxId>`
     - `count=20`
     - `locale=zh-CN`

抓取逻辑：

1. 每条微博先抓正文元信息，拿到作者 UID、正文、评论数等。
2. 一级评论分别抓热门流和时间流。
3. 两个一级评论流按 `comment_id` 合并去重。
4. `--mode level1`：只输出一级评论。
5. `--mode all`：一级评论和二级回复放在同一个 CSV/JSON 里。
6. `--mode all` 时，脚本会找 `reply_count > 0` 的一级评论，再逐条调用二级回复接口。
7. 每条微博单独保存一份 JSON/CSV，最后合并成总表。
8. 如果单条微博失败，会记录到 `manifest.json`；开启 `--resume` 后可跳过已成功的微博。

评论总表核心字段：

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
5. 评论抓取 `manifest.json` 里成功数和失败数明确。
6. 评论总表里 `row_type` 能区分一级评论和二级回复。
7. 语义审阅结果条数和输入条数一致。
8. Excel 能正常打开。
9. Excel 摘要里不显示“输入文件 / 输入评论文件 / 语义判定文件”。
10. CSV 如果要给 Excel 直接打开，需要加 BOM，避免中文乱码。

## 10. 关键注意事项

1. 抓取依赖微博登录态，登录失效时会跳到 `passport.weibo.com/sso/signin`。
2. opencli 必须优先使用项目内 `scripts/opencli-local.sh`，避免误用全局 opencli 版本。
3. 评论抓取优先走接口，不按 DOM 文本滚动抓。
4. `--mode all` 时，一级评论和二级回复放在同一个 CSV，不拆两个文件。
5. 异常微博可以跳过，失败信息记录在 `manifest.json`。
6. 语义判定要读整段文本，不用关键词做最终负面判断。
7. 帖子清洗和评论情感是两套规则：帖子先判断是否纳入分析，评论只判断当前评论/回复的态度。
