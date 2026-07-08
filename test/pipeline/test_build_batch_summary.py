import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[2]
PIPELINE_SRC = ROOT / "src" / "pipeline"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))


class BuildBatchSummaryTest(unittest.TestCase):
    def write_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def write_jsonl(self, path, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")

    def test_builds_project_batch_summary_with_actionable_statuses(self):
        from build_batch_summary import build_batch_summary, write_batch_summary

        with TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            self.write_json(project_dir / "crawl-tasks.json", {
                "tasks": [
                    {"task_id": "task_0001", "platform": "douyin"},
                ],
            })
            batch_root = project_dir / "runs" / "task_0001" / "batches"
            self.write_json(batch_root / "batch_0001" / "comment-dom-batch.json", {
                "batch_id": "batch_0001",
                "state": {"new_candidate_count": 2, "has_more": False},
                "candidates": [{"candidate_id": "c1"}, {"candidate_id": "c2"}],
            })
            self.write_json(batch_root / "batch_0001" / "ai-comment-extraction.json", {"rows": []})
            self.write_jsonl(batch_root / "batch_0001" / "normalized-comments.jsonl", [
                {"row_key": "r1"},
                {"row_key": "r2"},
            ])
            self.write_json(batch_root / "batch_0002" / "comment-dom-batch.json", {
                "batch_id": "batch_0002",
                "state": {"new_candidate_count": 1, "has_more": True},
                "candidates": [{"candidate_id": "c3"}],
            })
            self.write_json(batch_root / "batch_0003" / "comment-dom-batch.json", {
                "batch_id": "batch_0003",
                "state": {"new_candidate_count": 0, "has_more": False},
                "candidates": [],
            })

            summary = build_batch_summary(project_dir)

            self.assertEqual(summary["schema_version"], "comment-batch-summary-v1")
            self.assertEqual(summary["batch_count"], 3)
            self.assertEqual(summary["ok_batch_count"], 1)
            self.assertEqual(summary["pending_ai_batch_count"], 1)
            self.assertEqual(summary["empty_batch_count"], 1)
            self.assertEqual(summary["truncated_batch_count"], 1)
            self.assertEqual([batch["status"] for batch in summary["batches"]], [
                "ok",
                "pending_ai",
                "empty",
            ])
            self.assertEqual(summary["batches"][0]["normalized_row_count"], 2)

            saved = write_batch_summary(project_dir)
            output_path = project_dir / "batch-summary.json"
            self.assertEqual(saved["out"], str(output_path))
            self.assertTrue(output_path.exists())


if __name__ == "__main__":
    unittest.main()
