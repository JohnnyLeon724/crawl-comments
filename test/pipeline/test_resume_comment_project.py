import json
import sys
import tempfile
import unittest
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[2] / "src" / "pipeline"
sys.path.insert(0, str(PIPELINE_DIR))

from resume_comment_project import build_resume_plan  # noqa: E402


class ResumeCommentProjectTest(unittest.TestCase):
    def write_json(self, path: Path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def test_builds_resume_plan_without_overwriting_completed_runs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            self.write_json(project_dir / "crawl-tasks.json", {
                "tasks": [
                    {"task_id": "task_0001", "platform": "douyin"},
                    {"task_id": "task_0002", "platform": "xiaohongshu"},
                    {"task_id": "task_0003", "platform": "douyin"},
                ]
            })
            self.write_json(project_dir / "qa-summary.json", {
                "tasks": [
                    {"task_id": "task_0001", "status": "ok", "notes": ""},
                    {"task_id": "task_0002", "status": "failed", "notes": "未采集到评论"},
                ]
            })
            completed_file = project_dir / "runs" / "task_0001" / "normalized-comments.jsonl"
            completed_file.parent.mkdir(parents=True)
            completed_file.write_text('{"task_id":"task_0001"}\n', encoding="utf-8")
            failed_snapshot = project_dir / "runs" / "task_0002" / "comment-dom-snapshot.json"
            failed_snapshot.parent.mkdir(parents=True)
            failed_snapshot.write_text("{}\n", encoding="utf-8")

            plan = build_resume_plan(
                project_dir,
                resume_id="resume_test",
                out=project_dir / "resume-plan.json",
            )

            self.assertEqual(plan["status"], "ready")
            self.assertEqual(plan["total_tasks"], 3)
            self.assertEqual(plan["skip_count"], 1)
            self.assertEqual(plan["run_count"], 1)
            self.assertEqual(plan["rerun_count"], 1)

            first, second, third = plan["tasks"]
            self.assertEqual(first["action"], "skip")
            self.assertEqual(first["status"], "ok")
            self.assertEqual(first["suggested_out_dir"], "runs/task_0001")

            self.assertEqual(second["action"], "rerun")
            self.assertEqual(second["status"], "failed")
            self.assertEqual(second["suggested_out_dir"], "runs/task_0002/reruns/resume_test")

            self.assertEqual(third["action"], "run")
            self.assertEqual(third["status"], "pending")
            self.assertEqual(third["suggested_out_dir"], "runs/task_0003")

            self.assertTrue(completed_file.exists())
            saved = json.loads((project_dir / "resume-plan.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["tasks"][1]["task_id"], "task_0002")

    def test_treats_missing_qa_summary_as_pending_work(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            self.write_json(project_dir / "crawl-tasks.json", {
                "tasks": [
                    {"task_id": "task_0001", "platform": "douyin"},
                ]
            })
            task_file = project_dir / "runs" / "task_0001" / "task.json"
            task_file.parent.mkdir(parents=True)
            task_file.write_text("{}\n", encoding="utf-8")

            plan = build_resume_plan(project_dir, resume_id="resume_test")

            self.assertEqual(plan["tasks"][0]["status"], "pending")
            self.assertEqual(plan["tasks"][0]["action"], "run")
            self.assertEqual(plan["tasks"][0]["suggested_out_dir"], "runs/task_0001")


if __name__ == "__main__":
    unittest.main()
