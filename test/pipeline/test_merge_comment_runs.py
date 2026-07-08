import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[2]
PIPELINE_SRC = ROOT / "src" / "pipeline"
if str(PIPELINE_SRC) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SRC))


class MergeCommentRunsTest(unittest.TestCase):
    def write_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def write_jsonl(self, path, rows):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")

    def test_merges_runs_in_task_order_and_dedupes_by_row_key(self):
        from merge_comment_runs import merge_project_comments, write_merged_comments

        with TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            self.write_json(project_dir / "crawl-tasks.json", {
                "schema_version": "crawl-tasks-v1",
                "tasks": [
                    {"task_id": "task_0002"},
                    {"task_id": "task_0001"},
                ],
            })
            self.write_jsonl(project_dir / "runs" / "task_0001" / "normalized-comments.jsonl", [
                {"row_key": "r1", "task_id": "task_0001", "text": "后出现"},
                {"row_key": "dup", "task_id": "task_0001", "text": "重复后出现"},
            ])
            self.write_jsonl(project_dir / "runs" / "task_0002" / "normalized-comments.jsonl", [
                {"row_key": "r2", "task_id": "task_0002", "text": "先出现"},
                {"row_key": "dup", "task_id": "task_0002", "text": "重复先出现"},
            ])

            rows = merge_project_comments(project_dir)

            self.assertEqual([row["row_key"] for row in rows], ["r2", "dup", "r1"])
            self.assertEqual(rows[1]["text"], "重复先出现")

            summary = write_merged_comments(project_dir)
            output_path = project_dir / "all-normalized-comments.jsonl"
            self.assertEqual(summary["row_count"], 3)
            self.assertTrue(output_path.exists())
            output_rows = [
                json.loads(line)
                for line in output_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual([row["row_key"] for row in output_rows], ["r2", "dup", "r1"])

    def test_missing_task_output_is_reported_but_not_fatal(self):
        from merge_comment_runs import merge_project_comments

        with TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            self.write_json(project_dir / "crawl-tasks.json", {
                "schema_version": "crawl-tasks-v1",
                "tasks": [{"task_id": "task_0001"}],
            })

            rows = merge_project_comments(project_dir)

            self.assertEqual(rows, [])

    def test_project_merge_falls_back_to_task_batches_when_task_output_is_missing(self):
        from merge_comment_runs import merge_project_comments, write_merged_comments

        with TemporaryDirectory() as tmp:
            project_dir = Path(tmp)
            self.write_json(project_dir / "crawl-tasks.json", {
                "schema_version": "crawl-tasks-v1",
                "tasks": [
                    {"task_id": "task_0001"},
                    {"task_id": "task_0002"},
                ],
            })
            self.write_jsonl(project_dir / "runs" / "task_0001" / "batches" / "batch_0002" / "normalized-comments.jsonl", [
                {"row_key": "r2", "task_id": "task_0001", "text": "第二批"},
            ])
            self.write_jsonl(project_dir / "runs" / "task_0001" / "batches" / "batch_0001" / "normalized-comments.jsonl", [
                {"row_key": "r1", "task_id": "task_0001", "text": "第一批"},
            ])
            self.write_jsonl(project_dir / "runs" / "task_0002" / "normalized-comments.jsonl", [
                {"row_key": "r3", "task_id": "task_0002", "text": "任务级输出"},
            ])

            rows = merge_project_comments(project_dir)

            self.assertEqual([row["row_key"] for row in rows], ["r1", "r2", "r3"])

            summary = write_merged_comments(project_dir)
            self.assertEqual(summary["row_count"], 3)
            self.assertEqual(summary["batch_task_count"], 1)


if __name__ == "__main__":
    unittest.main()
