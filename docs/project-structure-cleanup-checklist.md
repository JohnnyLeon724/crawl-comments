# 项目结构解耦与清理清单

更新时间：2026-07-08

## 已完成整理

| 类型 | 新位置 | 兼容入口 | 说明 |
|---|---|---|---|
| 浏览器展开与 Playwright 采集 | `src/browser/` | `script/` | 旧命令继续可用，MCP 直接读取 `src/browser/expand-comments-v1.js` 注入页面 |
| 评论归一化、AI 审阅、旧报表 | `src/normalize/` | `script/` | 保留 `node script/*.js` 调用方式 |
| 平台 adapter | `src/adapters/` | `adapters/` | 保留旧 `require('../adapters/*.js')` |
| 客户表到交付 Excel 流水线 | `src/pipeline/` | 无 | Python 脚本集中在 uv 初始化目录 |
| 手工 Console 展开脚本 | `docs/examples/manual-douyin-expand-comments-console.js` | 无 | 只作为历史参考，不再作为生产入口 |

## 保留但忽略的本地目录

| 路径 | 处理方式 | 原因 |
|---|---|---|
| `MediaCrawler/` | 保留本地、继续 `.gitignore` | 外部参考项目体量大，不纳入当前交付仓库 |
| `.pw-profile/` | 保留本地、继续 `.gitignore` | Playwright/Chrome 登录态目录，包含本机状态 |
| `output/` | 保留本地、继续 `.gitignore` | 采集输出和人工测试结果，按运行生成 |
| `.agents/` | 保留本地、继续 `.gitignore` | 本机技能配置，不属于项目交付代码 |

## 后续可清理候选

| 路径 | 建议 | 前置检查 |
|---|---|---|
| 历史演进文档 | 移入 `docs/archive/` | 确认当前计划不再引用 |
| 旧 handoff 文档 | 保留在 `docs/handoff/` 或归档 | 确认没有正在交接的任务依赖 |
| 临时 fixture 或输出样例 | 删除或移入 `test/fixtures/` | `rg` 检查没有测试引用 |

删除前必须先运行：

```bash
rg "文件名或核心函数名"
```

测试文件不按“写完功能就删”的方式处理。只有当测试覆盖重复、目标代码已删除、或测试只验证旧行为且会误导维护时，才合并或删除。
