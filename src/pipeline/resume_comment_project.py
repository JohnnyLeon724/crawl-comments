import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


RUN_OUTPUT_FILES = [
    "task.json",
    "comment-dom-snapshot.json",
    "ai-comment-extraction.json",
    "normalized-comments.jsonl",
    "qa.json",
]

WORK_OUTPUT_FILES = set(RUN_OUTPUT_FILES) - {"task.json"}


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def read_tasks(project_dir: Path) -> list[dict[str, Any]]:
    payload = read_json(project_dir / "crawl-tasks.json")
    tasks = payload.get("tasks") if isinstance(payload, dict) else []
    tasks = tasks or []
    return [task for task in tasks if isinstance(task, dict)]


def read_qa_by_task(project_dir: Path) -> dict[str, dict[str, Any]]:
    payload = read_json(project_dir / "qa-summary.json")
    tasks = payload.get("tasks") if isinstance(payload, dict) else []
    tasks = tasks or []
    return {
        str(task.get("task_id") or ""): task
        for task in tasks
        if isinstance(task, dict) and task.get("task_id")
    }


def existing_run_files(run_dir: Path) -> list[str]:
    if not run_dir.exists():
        return []
    return [name for name in RUN_OUTPUT_FILES if (run_dir / name).exists()]


def has_work_outputs(files: list[str]) -> bool:
    return any(name in WORK_OUTPUT_FILES for name in files)


def infer_status(qa: dict[str, Any], run_dir: Path, files: list[str]) -> str:
    if qa.get("status"):
        return str(qa["status"])

    normalized = run_dir / "normalized-comments.jsonl"
    if normalized.exists() and normalized.stat().st_size > 0:
        return "ok"
    if has_work_outputs(files):
        return "partial"
    return "pending"


def decide_action(status: str, files: list[str]) -> str:
    if status == "ok":
        return "skip"
    if status in {"failed", "partial"} and has_work_outputs(files):
        return "rerun"
    return "run"


def suggested_out_dir(task_id: str, action: str, resume_id: str) -> str:
    base = f"runs/{task_id}"
    if action == "rerun":
        return f"{base}/reruns/{resume_id}"
    return base


def build_task_plan(task: dict[str, Any], project_dir: Path, qa_by_task: dict[str, dict[str, Any]], resume_id: str) -> dict[str, Any]:
    task_id = str(task.get("task_id") or "")
    run_dir = project_dir / "runs" / task_id
    files = existing_run_files(run_dir)
    qa = qa_by_task.get(task_id, {})
    status = infer_status(qa, run_dir, files)
    action = decide_action(status, files)

    return {
        "task_id": task_id,
        "platform": task.get("platform", ""),
        "status": status,
        "action": action,
        "reason": qa.get("notes") or status,
        "run_dir": f"runs/{task_id}",
        "suggested_out_dir": suggested_out_dir(task_id, action, resume_id),
        "existing_files": files,
    }


def summarize_actions(tasks: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "skip_count": len([task for task in tasks if task["action"] == "skip"]),
        "run_count": len([task for task in tasks if task["action"] == "run"]),
        "rerun_count": len([task for task in tasks if task["action"] == "rerun"]),
    }


def build_resume_plan(
    project_dir: str | Path,
    resume_id: str | None = None,
    out: str | Path | None = None,
) -> dict[str, Any]:
    root = Path(project_dir)
    effective_resume_id = resume_id or datetime.now(UTC).strftime("resume_%Y%m%dT%H%M%SZ")
    qa_by_task = read_qa_by_task(root)
    task_plans = [
        build_task_plan(task, root, qa_by_task, effective_resume_id)
        for task in read_tasks(root)
    ]
    action_counts = summarize_actions(task_plans)
    plan = {
        "schema_version": "comment-project-resume-plan-v1",
        "status": "ready",
        "resume_id": effective_resume_id,
        "generated_at": datetime.now(UTC).isoformat(),
        "project_dir": str(root),
        "total_tasks": len(task_plans),
        **action_counts,
        "tasks": task_plans,
    }

    if out:
        output_path = Path(out)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return plan


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a safe resume plan for a comment delivery project.")
    parser.add_argument("--project-dir", required=True, help="Project directory containing crawl-tasks.json.")
    parser.add_argument("--resume-id", default="", help="Stable rerun id. Defaults to a UTC timestamp.")
    parser.add_argument("--out", default="", help="Output resume-plan.json path. Defaults to <project-dir>/resume-plan.json.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out = args.out or str(Path(args.project_dir) / "resume-plan.json")
    plan = build_resume_plan(args.project_dir, resume_id=args.resume_id or None, out=out)
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
