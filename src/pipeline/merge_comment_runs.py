import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_NAME = "all-normalized-comments.jsonl"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped:
            rows.append(json.loads(stripped))
    return rows


def rows_to_jsonl(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)


def read_task_ids(project_dir: str | Path) -> list[str]:
    tasks_file = Path(project_dir) / "crawl-tasks.json"
    payload = read_json(tasks_file)
    tasks = payload.get("tasks") if isinstance(payload, dict) else []

    return [
        str(task.get("task_id"))
        for task in tasks
        if isinstance(task, dict) and task.get("task_id")
    ]


def merge_project_comments(project_dir: str | Path) -> list[dict[str, Any]]:
    root = Path(project_dir)
    seen = set()
    merged: list[dict[str, Any]] = []

    for task_id in read_task_ids(root):
        run_file = root / "runs" / task_id / "normalized-comments.jsonl"
        for row in read_jsonl(run_file):
            row_key = str(row.get("row_key") or "")
            if not row_key or row_key in seen:
                continue
            seen.add(row_key)
            merged.append(row)

    return merged


def build_summary(project_dir: Path, rows: list[dict[str, Any]], output_path: Path) -> dict[str, Any]:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    task_ids = read_task_ids(project_dir)
    return {
        "status": "success",
        "generated_at": now,
        "project_dir": str(project_dir),
        "task_count": len(task_ids),
        "row_count": len(rows),
        "out": str(output_path),
    }


def write_merged_comments(project_dir: str | Path, out: str | Path | None = None) -> dict[str, Any]:
    root = Path(project_dir)
    output_path = Path(out) if out else root / DEFAULT_OUTPUT_NAME
    rows = merge_project_comments(root)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rows_to_jsonl(rows), encoding="utf-8")

    return build_summary(root, rows, output_path)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge per-task normalized comment JSONL files.")
    parser.add_argument("--project-dir", required=True, help="Project directory containing crawl-tasks.json and runs/.")
    parser.add_argument("--out", default="", help=f"Output JSONL path. Defaults to {DEFAULT_OUTPUT_NAME}.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summary = write_merged_comments(args.project_dir, args.out or None)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
