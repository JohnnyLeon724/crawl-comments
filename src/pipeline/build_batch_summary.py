import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_NAME = "batch-summary.json"


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl_count(path: Path) -> int:
    if not path.exists():
        return 0
    return len([line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()])


def read_tasks(project_dir: Path) -> list[dict[str, Any]]:
    payload = read_json(project_dir / "crawl-tasks.json")
    tasks = payload.get("tasks") if isinstance(payload, dict) else []
    return [task for task in tasks if isinstance(task, dict)]


def iter_batch_dirs(task_dir: Path) -> list[Path]:
    batches_dir = task_dir / "batches"
    if not batches_dir.exists():
        return []
    return sorted(path for path in batches_dir.iterdir() if path.is_dir())


def classify_batch(candidate_count: int, has_ai: bool, has_normalized: bool) -> str:
    if candidate_count == 0:
        return "empty"
    if not has_ai:
        return "pending_ai"
    if not has_normalized:
        return "pending_normalize"
    return "ok"


def build_batch_record(project_dir: Path, task: dict[str, Any], batch_dir: Path) -> dict[str, Any]:
    batch = read_json(batch_dir / "comment-dom-batch.json")
    state = batch.get("state") if isinstance(batch.get("state"), dict) else {}
    candidates = batch.get("candidates") if isinstance(batch.get("candidates"), list) else []
    candidate_count = state.get("new_candidate_count")
    if candidate_count is None:
        candidate_count = len(candidates)

    ai_file = batch_dir / "ai-comment-extraction.json"
    normalized_file = batch_dir / "normalized-comments.jsonl"
    has_ai = ai_file.exists()
    has_normalized = normalized_file.exists()
    normalized_row_count = read_jsonl_count(normalized_file)

    return {
        "task_id": str(task.get("task_id") or batch_dir.parent.parent.name),
        "platform": str(task.get("platform") or batch.get("platform") or ""),
        "batch_id": str(batch.get("batch_id") or batch_dir.name),
        "status": classify_batch(int(candidate_count or 0), has_ai, has_normalized),
        "candidate_count": int(candidate_count or 0),
        "normalized_row_count": normalized_row_count,
        "has_ai_extraction": has_ai,
        "has_normalized_comments": has_normalized,
        "has_more": bool(state.get("has_more")),
        "batch_dir": str(batch_dir),
        "batch_file": str(batch_dir / "comment-dom-batch.json"),
        "relative_batch_dir": str(batch_dir.relative_to(project_dir)),
    }


def build_batch_summary(project_dir: str | Path) -> dict[str, Any]:
    root = Path(project_dir)
    batch_records: list[dict[str, Any]] = []

    for task in read_tasks(root):
        task_id = str(task.get("task_id") or "")
        if not task_id:
            continue
        task_dir = root / "runs" / task_id
        for batch_dir in iter_batch_dirs(task_dir):
            batch_records.append(build_batch_record(root, task, batch_dir))

    status_counts = Counter(record["status"] for record in batch_records)
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": "comment-batch-summary-v1",
        "status": "success",
        "generated_at": generated_at,
        "project_dir": str(root),
        "batch_count": len(batch_records),
        "ok_batch_count": status_counts.get("ok", 0),
        "pending_ai_batch_count": status_counts.get("pending_ai", 0),
        "pending_normalize_batch_count": status_counts.get("pending_normalize", 0),
        "empty_batch_count": status_counts.get("empty", 0),
        "truncated_batch_count": len([record for record in batch_records if record["has_more"]]),
        "total_candidate_count": sum(record["candidate_count"] for record in batch_records),
        "total_normalized_row_count": sum(record["normalized_row_count"] for record in batch_records),
        "batches": batch_records,
    }


def write_batch_summary(project_dir: str | Path, out: str | Path | None = None) -> dict[str, Any]:
    root = Path(project_dir)
    output_path = Path(out) if out else root / DEFAULT_OUTPUT_NAME
    summary = build_batch_summary(root)
    summary["out"] = str(output_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build project-level comment batch summary.")
    parser.add_argument("--project-dir", required=True, help="Project directory containing crawl-tasks.json and runs/.")
    parser.add_argument("--out", default="", help=f"Output JSON path. Defaults to {DEFAULT_OUTPUT_NAME}.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summary = write_batch_summary(args.project_dir, args.out or None)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
