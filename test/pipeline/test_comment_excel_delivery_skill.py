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
            "expand_and_capture_comment_batches",
            "capture_comment_candidate_batch",
            "comment-candidate-batch-extraction.md",
            "comment-dom-batch.json",
            "--batch",
            "batches/<batch_id>",
        ]:
            self.assertIn(batch_text, workflow)

        self.assertTrue(re.search(r"display_name:\s*\"Comment Excel Delivery\"", agent_yaml))

    def test_comment_excel_delivery_documents_coordinate_click_mode(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        self.assertIn("coordinate", skill)
        self.assertTrue(
            "DOM click fallback" in skill
            or "DOM-click fallback" in skill
            or "dom-click fallback" in skill
        )
        self.assertIn('"clickMode": "coordinate"', workflow)
        self.assertIn('"fallbackClickMode": "dom-click"', workflow)
        self.assertIn('"sourceUrl": "<task.source_url>"', workflow)
        self.assertIn('"postClickWaitMsMin": 800', workflow)
        self.assertIn('"postClickWaitMsMax": 1600', workflow)

    def test_workflow_uses_parameterized_client_requirement_workbook(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        self.assertIn("--input \"<client_requirements.xlsx>\"", workflow)
        self.assertIn("--phase \"<phase_name>\"", workflow)
        self.assertIn("The client workbook path is not fixed", workflow)

        parse_section = workflow.split("For an existing B站 delivery workbook", 1)[0]
        self.assertNotIn("docs/米其林评论区分析KOL link-0630.xlsx", parse_section)


if __name__ == "__main__":
    unittest.main()
