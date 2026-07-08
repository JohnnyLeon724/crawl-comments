import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from openpyxl import Workbook


ROOT = Path(__file__).resolve().parents[2]
PIPELINE_SRC = ROOT / "src" / "pipeline"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))


class ParseClientRequirementsTest(unittest.TestCase):
    def test_extract_first_url_from_share_text(self):
        from parse_client_requirements import extract_first_url

        self.assertEqual(
            extract_first_url("https://v.douyin.com/PLP7UJ1YqCU/ E@H.iP 09/17 :1pm eBG:/"),
            "https://v.douyin.com/PLP7UJ1YqCU/",
        )
        self.assertEqual(
            extract_first_url("看这里 https://www.xiaohongshu.com/explore/abc123?xsec_token=token&foo=1 复制链接"),
            "https://www.xiaohongshu.com/explore/abc123?xsec_token=token&foo=1",
        )

    def test_normalize_platform_names(self):
        from parse_client_requirements import normalize_platform

        self.assertEqual(normalize_platform("抖音"), "douyin")
        self.assertEqual(normalize_platform("小红书"), "xiaohongshu")
        self.assertEqual(normalize_platform("B站"), "bilibili")
        self.assertEqual(normalize_platform("微博"), "weibo")
        self.assertEqual(normalize_platform("未知平台"), "unknown")

    def test_parse_workbook_to_tasks_and_manifest(self):
        from parse_client_requirements import parse_workbook, write_project_files

        with TemporaryDirectory() as tmp:
            input_path = Path(tmp) / "client.xlsx"
            out_dir = Path(tmp) / "project"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "工作表1"
            sheet.append(["序号", "账户ID", "发布平台", "发布日期", "发布链接", "播放量/曝光", "互动总量", "评论数"])
            sheet.append([1, "DJ初仔大朋友", "抖音", "6.15", "https://v.douyin.com/PLP7UJ1YqCU/ E@H.iP", 4604000, 134000, 2922])
            sheet.append([2, "小红书达人", "小红书", "6.20", "https://www.xiaohongshu.com/explore/abc123?xsec_token=token 分享", 12000, 300, 42])
            workbook.save(input_path)

            tasks = parse_workbook(input_path, phase="KOL link-0630")

            self.assertEqual(len(tasks), 2)
            self.assertEqual(tasks[0]["task_id"], "task_0001")
            self.assertEqual(tasks[0]["source_excel_row"], 2)
            self.assertEqual(tasks[0]["platform"], "douyin")
            self.assertEqual(tasks[0]["creator_name"], "DJ初仔大朋友")
            self.assertEqual(tasks[0]["source_url"], "https://v.douyin.com/PLP7UJ1YqCU/")
            self.assertEqual(tasks[0]["expected_comment_count"], 2922)
            self.assertEqual(tasks[0]["status"], "pending")
            self.assertEqual(tasks[1]["platform"], "xiaohongshu")

            result = write_project_files(tasks, out_dir)

            tasks_path = out_dir / "crawl-tasks.json"
            manifest_path = out_dir / "run-manifest.json"
            task_dir = out_dir / "runs" / "task_0001"
            task_path = task_dir / "task.json"
            self.assertEqual(result["task_count"], 2)
            self.assertTrue(tasks_path.exists())
            self.assertTrue(manifest_path.exists())
            self.assertTrue(task_path.exists())
            self.assertEqual(json.loads(tasks_path.read_text(encoding="utf-8"))["tasks"][0]["task_id"], "task_0001")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "pending")
            self.assertEqual(manifest["tasks"][0]["task_id"], "task_0001")
            self.assertEqual(manifest["tasks"][0]["run_dir"], str(task_dir))
            self.assertEqual(json.loads(task_path.read_text(encoding="utf-8"))["task_id"], "task_0001")

    def test_crawl_task_schema_exists(self):
        schema_path = ROOT / "schemas" / "crawl-task.schema.json"

        self.assertTrue(schema_path.exists())
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        self.assertIn("task_id", schema["required"])
        self.assertIn("source_url", schema["required"])


if __name__ == "__main__":
    unittest.main()
