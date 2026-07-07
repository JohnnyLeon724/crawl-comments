# Comment Crawler Handoff

Created: 2026-07-07
Workspace: `/Users/gyp/Documents/demo`
Current HEAD: `3a31698 fix: 避免登录墙误采为评论`
Working tree at handoff time: clean

## Purpose

This project is evolving a browser-script based social comment crawler into a full pipeline:

1. Playwright opens a target page.
2. A page-side script expands replies, scrolls, and collects candidate comments.
3. Raw results are saved with manifest metadata.
4. Platform adapters normalize rows.
5. AI batches structure sentiment/theme judgments.
6. Excel and QA artifacts are generated.

The canonical plan and stage status live in:

- `docs/comment-crawler-evolution-plan.md`

Avoid duplicating that plan in future handoffs; reference it instead.

## Recent Development Summary

The staged implementation from the evolution plan is complete through stage 12. Key commits:

- `9be3a16 feat: 支持批量评论采集续跑`
- `8a13d52 feat: 增加评论归一化输出`
- `6055faf feat: 增加评论AI结构化批处理`
- `eb47e14 feat: 增加评论Excel报表生成`
- `0439f7d feat: 增加评论QA抽样审计`
- `e811674 feat: 增加小红书评论适配器`
- `15d818a fix: 按小红书CLI校准评论适配器`
- `45d60c0 feat: 增加评论采集工程化配置`
- `ab7cb71 fix: 兼容内置Playwright运行时`
- `3a31698 fix: 避免登录墙误采为评论`

The most recent fixes addressed two test-time blockers:

- Local project had no `playwright` dependency. `script/crawl-comments-playwright.js` now falls back to the Codex bundled node modules and uses installed Chrome when Playwright's bundled browser is absent.
- An unauthenticated Xiaohongshu page was being captured as two fake comments from the login wall. The runner now detects auth/security blocks before extraction, and the page-side expander filters login wall text.

## Important Files

- Runner: `script/crawl-comments-playwright.js`
- Page expander: `script/expand-comments-v1.js`
- Normalizer: `script/normalize-comments.js`
- Douyin adapter: `adapters/douyin.js`
- Xiaohongshu adapter: `adapters/xiaohongshu.js`
- AI batch prep: `script/prepare-comment-ai-review.js`
- AI runner wrapper: `script/run-comment-ai-review.js`
- Excel report: `script/build-comment-excel-report.js`
- QA sample/audit: `script/build-comment-qa-sample.js`
- Config helper: `script/comment-crawler-config.js`
- JSONL logger: `script/comment-crawler-log.js`
- Example config: `config/comment-crawler.config.example.json`
- Schemas: `schemas/comment-row.schema.json`, `schemas/comment-ai-review.schema.json`
- Xiaohongshu fixture: `test/fixtures/comment-crawler/xiaohongshu-comments-payload.json`

## Current Behavior

Use the runner with a persistent profile:

```bash
node script/crawl-comments-playwright.js \
  --url "TARGET_URL" \
  --out-dir output/manual_test_001 \
  --timeout-ms 300000 \
  --post-load-ms 5000
```

Default profile: `.pw-profile`

If the page is unauthenticated, expected behavior is now:

- `status: "failed"`
- `stop_reason: "auth_required"` in `output/manual_test_001/manifest.json`
- `raw-comments.json` should not contain login wall text as comments

The user tested a Xiaohongshu share URL containing sensitive query values such as `xsec_token`, share IDs, and app/share metadata. Do not copy the full URL into docs or commits. Use a redacted placeholder such as:

```text
https://www.xiaohongshu.com/explore/<note_id>?xsec_token=<redacted>&...
```

## How To Test

Automated verification:

```bash
node --test test/*.test.js
```

Latest observed full-suite result before this handoff: 60 tests passed.

Local fixture normalization:

```bash
node script/normalize-comments.js \
  --input test/fixtures/comment-crawler/xiaohongshu-comments-payload.json \
  --out output/local_test_001/normalized-comments.jsonl \
  --platform xiaohongshu
```

AI input batch:

```bash
node script/prepare-comment-ai-review.js \
  --input output/local_test_001/normalized-comments.jsonl \
  --out-dir output/local_test_001/ai-review-input \
  --batch-size 20
```

Excel report, once review JSON exists:

```bash
node script/build-comment-excel-report.js \
  --comments output/local_test_001/normalized-comments.jsonl \
  --ai-review output/local_test_001/ai-review-input \
  --out output/local_test_001/comment-report.xlsx
```

## Open Questions / Next Steps

- Test a real Xiaohongshu page after login in `.pw-profile`; confirm the runner reaches the note content instead of auth wall.
- If real Xiaohongshu still returns too few comments, inspect whether the generic `expand-comments-v1.js` selectors are sufficient or whether the runner should reuse the more specific DOM extraction strategy from `clis/xiaohongshu/comments.js`.
- Consider adding a runner option to choose extraction mode, e.g. generic expander vs. platform-specific extractor.
- Consider adding a first-class login check command or dry-run command that only reports auth/security state and screenshot path.
- After successful raw crawl, run `normalize-comments`, AI batch prep, Excel, and QA end-to-end from one real output directory.

## Suggested Skills

- `test-driven-development`: use before changing crawler, adapter, or report behavior.
- `verification-before-completion`: run fresh tests before claiming fixes.
- `chrome:control-chrome`: useful if the next session needs to inspect or control the user's logged-in Chrome state.
- `browser:control-in-app-browser`: useful for local file or localhost checks.
- `spreadsheets:Spreadsheets`: use if revising `.xlsx` report generation or visual verification.
- `handoff`: use again if transferring context after more real-site testing.

## Safety Notes

- Do not commit real Xiaohongshu URLs containing `xsec_token`, share IDs, cookies, screenshots with visible accounts, or profile/session data.
- Do not delete or reset `.pw-profile` unless the user explicitly asks; it may contain the login session used for testing.
- Keep `output/` as local runtime data. It is ignored and should not be committed.
