import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[2]
PIPELINE_SRC = ROOT / "src" / "pipeline"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))


class MergeTaskBatchesTest(unittest.TestCase):
    def write_jsonl(self, path, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")

    def test_merges_batches_in_batch_order_and_dedupes_by_row_key(self):
        from merge_task_batches import merge_task_batch_comments, write_task_batch_merge

        with TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "runs" / "task_0001"
            self.write_jsonl(task_dir / "batches" / "batch_0002" / "normalized-comments.jsonl", [
                {"row_key": "r2", "text": "第二批"},
                {"row_key": "dup", "text": "重复第二批"},
            ])
            self.write_jsonl(task_dir / "batches" / "batch_0001" / "normalized-comments.jsonl", [
                {"row_key": "r1", "text": "第一批"},
                {"row_key": "dup", "text": "重复第一批"},
            ])

            rows = merge_task_batch_comments(task_dir)

            self.assertEqual([row["row_key"] for row in rows], ["r1", "dup", "r2"])
            self.assertEqual(rows[1]["text"], "重复第一批")

            summary = write_task_batch_merge(task_dir)
            output_path = task_dir / "normalized-comments.jsonl"
            summary_path = task_dir / "batch-merge-summary.json"
            self.assertEqual(summary["status"], "success")
            self.assertEqual(summary["batch_count"], 2)
            self.assertEqual(summary["row_count"], 3)
            self.assertEqual(summary["duplicate_count"], 1)
            self.assertTrue(output_path.exists())
            self.assertTrue(summary_path.exists())

            output_rows = [
                json.loads(line)
                for line in output_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual([row["row_key"] for row in output_rows], ["r1", "dup", "r2"])

    def test_missing_batch_normalized_file_is_reported_but_not_fatal(self):
        from merge_task_batches import write_task_batch_merge

        with TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "runs" / "task_0001"
            (task_dir / "batches" / "batch_0001").mkdir(parents=True)

            summary = write_task_batch_merge(task_dir)

            self.assertEqual(summary["status"], "success")
            self.assertEqual(summary["batch_count"], 1)
            self.assertEqual(summary["missing_batch_count"], 1)
            self.assertEqual(summary["row_count"], 0)
            self.assertEqual((task_dir / "normalized-comments.jsonl").read_text(encoding="utf-8"), "")

    def test_dedupes_matching_evidence_row_keys_from_model_batches(self):
        from merge_task_batches import merge_task_batch_comments, write_task_batch_merge

        with TemporaryDirectory() as tmp:
            task_dir = Path(tmp) / "runs" / "task_0001"
            self.write_jsonl(task_dir / "batches" / "model_002" / "normalized-comments.jsonl", [
                {"row_key": "weibo-evidence-row", "comment_id": "c-100", "text": "后写入的重复评论"},
            ])
            self.write_jsonl(task_dir / "batches" / "model_001" / "normalized-comments.jsonl", [
                {"row_key": "weibo-evidence-row", "comment_id": "c-100", "text": "证据评论"},
            ])

            rows = merge_task_batch_comments(task_dir)
            summary = write_task_batch_merge(task_dir)

            self.assertEqual(rows, [{"row_key": "weibo-evidence-row", "comment_id": "c-100", "text": "证据评论"}])
            self.assertEqual(summary["duplicate_count"], 1)
            self.assertEqual(summary["row_count"], 1)


if __name__ == "__main__":
    unittest.main()
