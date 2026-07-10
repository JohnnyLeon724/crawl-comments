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

    def test_skill_declares_chrome_as_default_browser_workflow(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        for text in [
            "chrome:control-chrome",
            "default browser execution surface",
            "MCP/CDP",
            "fallback",
            "comment-dom-batch.json",
            "ai-comment-extraction.json",
            "normalized-comments.jsonl",
        ]:
            self.assertIn(text, skill + "\n" + workflow)

        self.assertRegex(
            skill,
            r"(?is)default browser execution surface.*chrome:control-chrome",
        )
        self.assertRegex(
            workflow,
            r"(?is)Chrome default per-task workflow.*Open a fresh tab",
        )
        self.assertRegex(
            workflow,
            r"(?is)login.*CAPTCHA.*verification.*user action",
        )

    def test_workflow_documents_douyin_modal_id_direct_video_handling(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        for text in [
            "user?...modal_id=...",
            "modal_id",
            "/video/<modal_id>",
            "short-video feed",
            "comment container",
        ]:
            self.assertIn(text, workflow)

        self.assertRegex(
            workflow,
            r"(?is)modal_id.*direct.*?/video/<modal_id>",
        )
        self.assertRegex(
            workflow,
            r"(?is)short-video feed.*scroll.*next video",
        )

    def test_workflow_documents_closing_accidental_profile_tabs(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        for text in [
            "tab cleanup guard",
            "browser.tabs.list",
            "commenter profile",
            "creator profile",
            "close the accidental tab",
        ]:
            self.assertIn(text, workflow)

        self.assertRegex(
            workflow,
            r"(?is)before.*after.*browser\.tabs\.list",
        )

    def test_skill_requires_full_delivery_by_default(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")
        combined = skill + "\n" + workflow

        for text in [
            "Default delivery mode is full completion",
            "Do not treat partial QA as complete",
            "qa-summary.status == \"ok\"",
            "failed_count == 0",
            "partial_count == 0",
            "resume_comment_project.py",
        ]:
            self.assertIn(text, combined)

        self.assertRegex(
            workflow,
            r"(?is)Completion gate.*qa-summary\.status == \"ok\".*partial_count == 0",
        )

    def test_workflow_allows_smoke_mode_only_when_explicit(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        for text in [
            "Smoke or sampling mode is allowed only when the user explicitly asks for it",
            "test artifact, not a complete delivery",
            "Do not use smoke limits in default delivery mode",
        ]:
            self.assertIn(text, workflow)

    def test_workflow_documents_elastic_capture_parameters(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        for text in [
            "Capture parameters are elastic",
            "expected_comment_count",
            "increase maxBatches, maxRounds, and maxRuntimeMs",
            "Reduce parameters only for explicit smoke mode",
        ]:
            self.assertIn(text, workflow)

    def test_mcp_cdp_is_documented_as_fallback_not_default(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        self.assertIn("MCP/CDP fallback", workflow)
        self.assertIn("expand_and_capture_comment_batches", workflow)
        self.assertIn("capture_comment_candidate_batch", workflow)
        self.assertIn("capture_comment_candidate_batches_until_idle", workflow)
        self.assertNotRegex(
            workflow,
            r"Use `expand_and_capture_comment_batches` as the default comment browser step",
        )

    def test_workflow_keeps_mcp_coordinate_click_details_in_fallback_section(self):
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")

        self.assertIn("Coordinate clicking remains the MCP fallback production interaction mode", workflow)
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

    def test_skill_requires_safe_scoped_chrome_comment_capture(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        workflow = (SKILL_DIR / "references" / "workflow.md").read_text(encoding="utf-8")
        combined = skill + "\n" + workflow

        for text in [
            "chrome-comment-capture.js",
            "exact visible text",
            "comment root",
            "收起",
            "read-only",
            "capture-state.json",
            "count_gap",
            "PLATFORM_PROFILES.douyin",
        ]:
            self.assertIn(text, combined)

        self.assertRegex(
            workflow,
            r"(?is)exact.*expand.*never.*收起",
        )


if __name__ == "__main__":
    unittest.main()
