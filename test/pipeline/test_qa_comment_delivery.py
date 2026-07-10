import json
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[2] / "src" / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from qa_comment_delivery import build_qa_summary  # noqa: E402


class QaCommentDeliveryTest(unittest.TestCase):
    def write_weibo_project(self, project_dir, rows, streams, declared_comment_count, expected_comment_count):
        (project_dir / "crawl-tasks.json").write_text(
            json.dumps(
                {
                    "tasks": [
                        {
                            "task_id": "task_0001",
                            "phase": "KOL",
                            "platform": "weibo",
                            "expected_comment_count": expected_comment_count,
                        },
                    ]
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        (project_dir / "all-normalized-comments.jsonl").write_text(
            "".join(f"{json.dumps(row, ensure_ascii=False)}\n" for row in rows),
            encoding="utf-8",
        )
        state_path = project_dir / "runs" / "task_0001" / "capture-state.json"
        state_path.parent.mkdir(parents=True)
        state_path.write_text(
            json.dumps(
                {
                    "declared_comment_count": declared_comment_count,
                    "captured_record_count": len(rows),
                    "streams": streams,
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )

    def weibo_level1_row(self, index, identity_mode, comment_id=""):
        return {
            "task_id": "task_0001",
            "row_type": "level1",
            "user_name": f"用户{index}",
            "text": f"评论{index}",
            "created_at": "3月前",
            "ip_location": "江苏",
            "comment_id": comment_id,
            "raw": {"source_chunk": {"identity_mode": identity_mode}},
        }

    def complete_weibo_streams(self, unique_level1_count):
        return {
            "hot": {
                "verified": True,
                "stop_reason": "page_end",
                "remaining_expand_count": 0,
                "unique_level1_count": unique_level1_count,
            },
            "time": {
                "verified": True,
                "stop_reason": "page_end",
                "remaining_expand_count": 0,
                "unique_level1_count": unique_level1_count,
            },
        }

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
                        "batch_kind": "model",
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
                        "batch_kind": "model",
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

    def test_requires_ai_artifacts_only_for_model_batches_but_keeps_capture_truncation(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            (project_dir / "crawl-tasks.json").write_text(
                json.dumps(
                    {
                        "tasks": [
                            {
                                "task_id": "task_0001",
                                "phase": "KOL",
                                "platform": "weibo",
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
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            batch_root = project_dir / "runs" / "task_0001" / "batches"
            for batch_id, batch_kind, has_more in [
                ("capture_hot_001", "capture", True),
                ("model_001", "model", False),
            ]:
                batch_dir = batch_root / batch_id
                batch_dir.mkdir(parents=True)
                (batch_dir / "comment-dom-batch.json").write_text(
                    json.dumps(
                        {
                            "schema_version": "comment-dom-batch-v1",
                            "batch_id": batch_id,
                            "batch_kind": batch_kind,
                            "state": {"new_candidate_count": 1, "has_more": has_more},
                            "candidates": [{"candidate_id": batch_id}],
                        },
                        ensure_ascii=False,
                    )
                    + "\n",
                    encoding="utf-8",
                )

            task = build_qa_summary(project_dir)["tasks"][0]

            self.assertEqual(task["missing_ai_extraction_batch_count"], 1)
            self.assertEqual(task["truncated_batch_count"], 1)
            self.assertIn("missing_ai_extraction_batch", task["issues"])
            self.assertIn("truncated_batch", task["issues"])

    def test_treats_legacy_batches_without_batch_kind_as_model_batches(self):
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
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            batch_dir = project_dir / "runs" / "task_0001" / "batches" / "batch_0001"
            batch_dir.mkdir(parents=True)
            (batch_dir / "comment-dom-batch.json").write_text(
                json.dumps(
                    {
                        "schema_version": "comment-dom-batch-v1",
                        "batch_id": "batch_0001",
                        "state": {"new_candidate_count": 1, "has_more": False},
                        "candidates": [{"candidate_id": "candidate_000001"}],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            task = build_qa_summary(project_dir)["tasks"][0]

            self.assertEqual(task["missing_ai_extraction_batch_count"], 1)
            self.assertIn("missing_ai_extraction_batch", task["issues"])

    def test_marks_a_weibo_task_partial_when_the_time_stream_is_incomplete(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            streams = self.complete_weibo_streams(1)
            streams["time"] = {
                "verified": True,
                "stop_reason": "no_progress",
                "remaining_expand_count": 0,
                "unique_level1_count": 1,
            }
            self.write_weibo_project(
                project_dir,
                [self.weibo_level1_row(1, "dom_id", "comment-1")],
                streams,
                declared_comment_count=1,
                expected_comment_count=1,
            )

            task = build_qa_summary(project_dir)["tasks"][0]

            self.assertEqual(task["status"], "partial")
            self.assertIn("weibo_time_stream_incomplete", task["issues"])
            self.assertTrue(task["weibo_hot_stream_complete"])
            self.assertFalse(task["weibo_time_stream_complete"])

    def test_allows_weibo_ok_only_with_complete_dom_id_stream_coverage(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            self.write_weibo_project(
                project_dir,
                [self.weibo_level1_row(index, "dom_id", f"comment-{index}") for index in range(1, 9)],
                self.complete_weibo_streams(8),
                declared_comment_count=10,
                expected_comment_count=8,
            )

            task = build_qa_summary(project_dir)["tasks"][0]

            self.assertEqual(task["status"], "ok")
            self.assertEqual(task["weibo_level1_coverage"], 0.8)
            self.assertTrue(task["weibo_dual_sort_complete"])
            self.assertNotIn("weibo_level1_coverage_below_threshold", task["issues"])

    def test_keeps_complete_composite_only_weibo_capture_partial(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            self.write_weibo_project(
                project_dir,
                [self.weibo_level1_row(1, "composite_fingerprint")],
                self.complete_weibo_streams(1),
                declared_comment_count=1,
                expected_comment_count=1,
            )

            task = build_qa_summary(project_dir)["tasks"][0]

            self.assertEqual(task["status"], "partial")
            self.assertIn("weibo_composite_identity_only", task["issues"])
            self.assertFalse(task["weibo_dual_sort_complete"])
            self.assertNotIn("双排序全量完成", task["notes"])

    def test_reports_rendered_count_gap_without_turning_a_passing_task_partial(self):
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
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            state_path = project_dir / "runs" / "task_0001" / "capture-state.json"
            state_path.parent.mkdir(parents=True)
            state_path.write_text(
                json.dumps(
                    {
                        "declared_comment_count": 216,
                        "captured_record_count": 197,
                        "count_gap": 19,
                        "end_signal": "暂时没有更多评论",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            task = build_qa_summary(project_dir)["tasks"][0]

            self.assertEqual(task["status"], "ok")
            self.assertEqual(task["issues"], [])
            self.assertEqual(task["declared_comment_count"], 216)
            self.assertEqual(task["rendered_comment_count"], 197)
            self.assertEqual(task["rendered_count_gap"], 19)
            self.assertEqual(task["capture_end_signal"], "暂时没有更多评论")
            self.assertIn("平台展示 216 条，当前会话可读 197 条，差异 19 条", task["notes"])


if __name__ == "__main__":
    unittest.main()
