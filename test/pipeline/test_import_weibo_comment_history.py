import json
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook


PIPELINE_DIR = Path(__file__).resolve().parents[2] / "src" / "pipeline"
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

from import_weibo_comment_history import import_weibo_comment_history  # noqa: E402


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class ImportWeiboCommentHistoryTest(unittest.TestCase):
    def test_imports_comments_with_inherited_task_and_reply_context(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            workbook_path = root / "weibo-history.xlsx"
            workbook = Workbook()
            summary = workbook.active
            summary.title = "微博汇总"
            summary.append([
                "阶段", "Excel行", "序号", "博主昵称", "平台", "页面链接", "微博互动量",
                "微博评论总数", "一级评论数", "回复数", "总评论行数", "评论点赞合计", "状态",
            ])
            summary.append([
                "Phase 1", 7, 2, "博主A", "微博", "https://weibo.com/1/A", 100,
                9, 1, 1, 2, 5, "success",
            ])

            detail = workbook.create_sheet("评论明细")
            detail.append([
                "阶段", "Excel行", "序号", "博主昵称", "平台", "页面链接", "微博互动量",
                "楼层信息", "评论类型", "父楼层", "回复序号", "评论人", "评论内容",
                "回复对象", "点赞数", "评论时间/地区",
            ])
            detail.append([
                "", "", "", "", "", "", "", "孤儿楼", "评论", "", "", "孤儿用户", "孤儿评论",
                "", 0, "2026-04-03 08:00:00 / 北京",
            ])
            main_row = [
                "Phase 1", 7, 2, "博主A", "微博", "https://weibo.com/1/A", 100,
                "1楼", "评论", "", "", "用户A", "主评论", "", 17,
                "2026-04-03 17:20:30 / 广东",
            ]
            detail.append(main_row)
            detail.append([
                "", "", "", "", "", "", "", "1楼-回复1", "回复", "1楼", 1,
                "用户B", "回复内容", "用户A", 2, "2026-04-03 18:47:20 / 辽宁",
            ])
            detail.append(main_row)
            workbook.save(workbook_path)
            workbook.close()

            out_dir = root / "project"
            result = import_weibo_comment_history(workbook_path, out_dir)

            self.assertEqual(result["status"], "success")
            self.assertEqual(result["task_count"], 1)
            self.assertEqual(result["comment_count"], 2)
            rows = read_jsonl(out_dir / "all-normalized-comments.jsonl")
            self.assertEqual(rows[0]["row_type"], "level1")
            self.assertEqual(rows[0]["root_text"], "主评论")
            self.assertEqual(rows[0]["raw"]["post_text"], "")
            self.assertEqual(rows[1]["row_type"], "level2")
            self.assertEqual(rows[1]["source_url"], "https://weibo.com/1/A")
            self.assertEqual(rows[1]["root_text"], "主评论")
            self.assertEqual(rows[1]["reply_to_user_name"], "用户A")
            self.assertNotEqual(rows[0]["row_key"], rows[1]["row_key"])

            summary_payload = json.loads((out_dir / "history-import-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary_payload["duplicate_row_count"], 1)
            self.assertEqual(summary_payload["orphan_row_count"], 1)

            task_payload = json.loads((out_dir / "runs" / "task_0001" / "task.json").read_text(encoding="utf-8"))
            self.assertEqual(task_payload["expected_comment_count"], 9)
            self.assertEqual(task_payload["engagement_count"], 100)


if __name__ == "__main__":
    unittest.main()
