import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / ".codex" / "skills" / "comment-excel-delivery"


class CommentExcelDeliverySkillTest(unittest.TestCase):
    def test_skill_contains_workflow_instructions_without_template_todos(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")
        agent_yaml = (SKILL_DIR / "agents" / "openai.yaml").read_text(encoding="utf-8")

        self.assertNotIn("TODO", skill)
        self.assertRegex(skill, r"name:\s*comment-excel-delivery")
        self.assertRegex(skill, r"description: .*客户需求 Excel")
        self.assertIn("references/workflow.md", skill)

        for command in [
            "parse_client_requirements.py",
            "import_bilibili_delivery.py",
            "merge_task_batches.py",
            "merge_comment_runs.py",
            "qa_comment_delivery.py",
            "build_batch_summary.py",
            "build_client_comment_excel.py",
            "resume_comment_project.py",
        ]:
            self.assertIn(command, workflow)

        for batch_text in [
            "capture_comment_candidate_batch",
            "comment-candidate-batch-extraction.md",
            "comment-dom-batch.json",
            "--batch",
            "batches/<batch_id>",
        ]:
            self.assertIn(batch_text, workflow)

        self.assertTrue(re.search(r"display_name:\s*\"Comment Excel Delivery\"", agent_yaml))


if __name__ == "__main__":
    unittest.main()
