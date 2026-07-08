import json
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[2] / "src" / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from qa_comment_delivery import build_qa_summary  # noqa: E402


class QaCommentDeliveryTest(unittest.TestCase):
    def test_builds_task_level_qa_summary(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            (project_dir / "crawl-tasks.json").write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "task_id": "task_0001",
                                "phase": "KOL",
                                "platform": "douyin",
                                "expected_comment_count": 3,
                            },
                            {
                                "task_id": "task_0002",
                                "phase": "KOL",
                                "platform": "xiaohongshu",
                                "expected_comment_count": 2,
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (project_dir / "all-normalized-comments.jsonl").write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "task_id": "task_0001",
                                "row_type": "level1",
                                "user_name": "用户A",
                                "text": "主评论",
                                "created_at": "3月前",
                                "ip_location": "江苏",
                            },
                            ensure_ascii=False,
                        ),
                        json.dumps(
                            {
                                "task_id": "task_0001",
                                "row_type": "level2",
                                "user_name": "",
                                "text": "回复",
                                "created_at": "",
                                "ip_location": "",
                            },
                            ensure_ascii=False,
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            summary = build_qa_summary(project_dir, out=project_dir / "qa-summary.json")

            self.assertEqual(summary["status"], "partial")
            self.assertEqual(summary["total_tasks"], 2)
            self.assertEqual(summary["ok_count"], 0)
            self.assertEqual(summary["partial_count"], 1)
            self.assertEqual(summary["failed_count"], 1)

            first_task = summary["tasks"][0]
            self.assertEqual(first_task["status"], "partial")
            self.assertEqual(first_task["actual_comment_count"], 2)
            self.assertEqual(first_task["missing_user_name_count"], 1)
            self.assertEqual(first_task["missing_time_or_location_count"], 1)
            self.assertIn("comment_count_below_threshold", first_task["issues"])
            self.assertIn("missing_user_name", first_task["issues"])

            second_task = summary["tasks"][1]
            self.assertEqual(second_task["status"], "failed")
            self.assertIn("no_comments_collected", second_task["issues"])

            saved = json.loads((project_dir / "qa-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["tasks"][0]["task_id"], "task_0001")

    def test_includes_batch_level_metrics_when_batches_exist(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            (project_dir / "crawl-tasks.json").write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "task_id": "task_0001",
                                "phase": "KOL",
                                "platform": "douyin",
                                "expected_comment_count": 1,
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (project_dir / "all-normalized-comments.jsonl").write_text(
                json.dumps(
                    {
                        "task_id": "task_0001",
                        "row_type": "level1",
                        "user_name": "用户A",
                        "text": "评论",
                        "created_at": "3月前",
                        "ip_location": "江苏",
                        "raw": {
                            "ai_row": {"source_chunk_id": "candidate_000001"},
                            "source_batch_id": "batch_0001",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            batch_root = project_dir / "runs" / "task_0001" / "batches"
            (batch_root / "batch_0001").mkdir(parents=True)
            (batch_root / "batch_0001" / "comment-dom-batch.json").write_text(
                json.dumps(
                    {
                        "schema_version": "comment-dom-batch-v1",
                        "batch_id": "batch_0001",
                        "state": {"new_candidate_count": 1, "has_more": True},
                        "candidates": [{"candidate_id": "candidate_000001"}],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            (batch_root / "batch_0001" / "ai-comment-extraction.json").write_text("{}\n", encoding="utf-8")
            (batch_root / "batch_0002").mkdir(parents=True)
            (batch_root / "batch_0002" / "comment-dom-batch.json").write_text(
                json.dumps(
                    {
                        "schema_version": "comment-dom-batch-v1",
                        "batch_id": "batch_0002",
                        "state": {"new_candidate_count": 0, "has_more": False},
                        "candidates": [],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            summary = build_qa_summary(project_dir)
            task = summary["tasks"][0]

            self.assertEqual(task["batch_count"], 2)
            self.assertEqual(task["empty_batch_count"], 1)
            self.assertEqual(task["missing_ai_extraction_batch_count"], 1)
            self.assertEqual(task["truncated_batch_count"], 1)
            self.assertEqual(summary["total_batch_count"], 2)


if __name__ == "__main__":
    unittest.main()
