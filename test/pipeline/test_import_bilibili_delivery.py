import json
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

PIPELINE_DIR = Path(__file__).resolve().parents[2] / "src" / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from import_bilibili_delivery import import_bilibili_delivery  # noqa: E402


class ImportBilibiliDeliveryTest(unittest.TestCase):
    def test_imports_bilibili_summary_and_detail_sheets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            workbook_path = root / "bilibili.xlsx"
            workbook = Workbook()
            summary = workbook.active
            summary.title = "B站汇总"
            summary.append([
                "阶段",
                "Excel行",
                "序号",
                "博主昵称",
                "平台",
                "页面链接",
                "B站互动量",
                "评论总数",
                "一级评论数",
                "回复数",
                "总评论行数",
                "评论点赞合计",
                "状态",
            ])
            summary.append([
                "Phase 1",
                14,
                12,
                "高转青年",
                "B站",
                "https://b23.tv/ehM0DoJ",
                726,
                2,
                1,
                1,
                2,
                19,
                "ok",
            ])
            detail = workbook.create_sheet("评论明细")
            detail.append([
                "阶段",
                "Excel行",
                "序号",
                "博主昵称",
                "平台",
                "页面链接",
                "B站互动量",
                "楼层信息",
                "评论类型",
                "父楼层",
                "回复序号",
                "评论人",
                "评论内容",
                "回复对象",
                "点赞数",
                "评论时间/地区",
            ])
            detail.append([
                "Phase 1",
                14,
                12,
                "高转青年",
                "B站",
                "https://b23.tv/ehM0DoJ",
                726,
                "1楼",
                "评论",
                "",
                "",
                "用户A",
                "主评论",
                "",
                17,
                "2026-04-03 17:20:30 / 广东",
            ])
            detail.append([
                "",
                14,
                12,
                "",
                "B站",
                "",
                "",
                "1楼-回复1",
                "回复",
                "1楼",
                1,
                "用户B",
                "回复内容",
                "用户A",
                2,
                "2026-04-03 18:47:20 / 辽宁",
            ])
            workbook.save(workbook_path)
            workbook.close()

            out_dir = root / "project"
            result = import_bilibili_delivery(workbook_path, out_dir)

            self.assertEqual(result["status"], "success")
            self.assertEqual(result["task_count"], 1)
            self.assertEqual(result["comment_count"], 2)

            tasks_payload = json.loads((out_dir / "crawl-tasks.json").read_text(encoding="utf-8"))
            task = tasks_payload["tasks"][0]
            self.assertEqual(task["platform"], "bilibili")
            self.assertEqual(task["creator_name"], "高转青年")
            self.assertEqual(task["source_url"], "https://b23.tv/ehM0DoJ")
            self.assertEqual(task["engagement_count"], 726)
            self.assertEqual(task["expected_comment_count"], 2)

            rows = [
                json.loads(line)
                for line in (out_dir / "all-normalized-comments.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(rows[0]["row_type"], "level1")
            self.assertEqual(rows[0]["created_at"], "2026-04-03 17:20:30")
            self.assertEqual(rows[0]["ip_location"], "广东")
            self.assertEqual(rows[1]["row_type"], "level2")
            self.assertEqual(rows[1]["reply_to_user_name"], "用户A")
            self.assertEqual(rows[1]["source_engagement_count"], 726)


if __name__ == "__main__":
    unittest.main()
