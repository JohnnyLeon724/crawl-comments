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

    def test_treats_existing_batches_as_partial_work_outputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            self.write_json(project_dir / "crawl-tasks.json", {
                "tasks": [
                    {"task_id": "task_0001", "platform": "douyin"},
                ]
            })
            batch_file = project_dir / "runs" / "task_0001" / "batches" / "batch_0001" / "comment-dom-batch.json"
            self.write_json(batch_file, {
                "schema_version": "comment-dom-batch-v1",
                "batch_id": "batch_0001",
            })

            plan = build_resume_plan(project_dir, resume_id="resume_test")
            task = plan["tasks"][0]

            self.assertEqual(task["status"], "partial")
            self.assertEqual(task["action"], "rerun")
            self.assertIn("batches/", task["existing_files"])

    def test_reprobes_dom_identity_for_a_complete_composite_only_weibo_task(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            source_url = "https://weibo.com/detail/123"
            profile_path = "output/weibo-profile-probe/weibo-comment-profile.json"
            self.write_json(project_dir / "crawl-tasks.json", {
                "tasks": [{
                    "task_id": "task_0001",
                    "platform": "weibo",
                    "source_url": source_url,
                }]
            })
            self.write_json(project_dir / "qa-summary.json", {
                "tasks": [{
                    "task_id": "task_0001",
                    "status": "partial",
                    "issues": ["weibo_composite_identity_only"],
                    "notes": "复合指纹身份",
                }]
            })
            self.write_json(project_dir / "runs" / "task_0001" / "capture-state.json", {
                "profile_path": profile_path,
                "streams": {
                    "hot": {"verified": True, "stop_reason": "page_end", "remaining_expand_count": 0},
                    "time": {"verified": True, "stop_reason": "page_end", "remaining_expand_count": 0},
                },
            })

            task = build_resume_plan(project_dir, resume_id="resume_test")["tasks"][0]

            self.assertEqual(task["action"], "reprobe_weibo_dom_identity")
            self.assertEqual(task["source_url"], source_url)
            self.assertEqual(task["profile_path"], profile_path)
            self.assertNotIn("api", json.dumps(task).lower())
            self.assertNotIn("mcp", json.dumps(task).lower())

    def test_resumes_only_the_incomplete_weibo_time_stream(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            project_dir = Path(tmpdir)
            source_url = "https://weibo.com/detail/456"
            profile_path = "output/weibo-profile-probe/weibo-comment-profile.json"
            self.write_json(project_dir / "crawl-tasks.json", {
                "tasks": [{
                    "task_id": "task_0001",
                    "platform": "weibo",
                    "source_url": source_url,
                }]
            })
            self.write_json(project_dir / "qa-summary.json", {
                "tasks": [{
                    "task_id": "task_0001",
                    "status": "partial",
                    "issues": ["weibo_time_stream_incomplete"],
                    "notes": "按时间未完成",
                }]
            })
            self.write_json(project_dir / "runs" / "task_0001" / "capture-state.json", {
                "profile_path": profile_path,
                "streams": {
                    "hot": {"verified": True, "stop_reason": "page_end", "remaining_expand_count": 0},
                    "time": {"verified": True, "stop_reason": "no_progress", "remaining_expand_count": 0},
                },
            })

            plan = build_resume_plan(project_dir, resume_id="resume_test")
            matching = [task for task in plan["tasks"] if task["task_id"] == "task_0001"]

            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0]["action"], "resume_weibo_time_stream")
            self.assertEqual(matching[0]["source_url"], source_url)
            self.assertEqual(matching[0]["profile_path"], profile_path)


if __name__ == "__main__":
    unittest.main()
