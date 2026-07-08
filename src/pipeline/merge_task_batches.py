import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT_NAME = "normalized-comments.jsonl"
DEFAULT_SUMMARY_NAME = "batch-merge-summary.json"


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


def iter_batch_dirs(task_dir: str | Path) -> list[Path]:
    batches_dir = Path(task_dir) / "batches"
    if not batches_dir.exists():
        return []
    return sorted(path for path in batches_dir.iterdir() if path.is_dir())


def collect_task_batch_rows(task_dir: str | Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    root = Path(task_dir)
    seen = set()
    merged: list[dict[str, Any]] = []
    duplicate_count = 0
    missing_batch_count = 0
    batch_dirs = iter_batch_dirs(root)

    for batch_dir in batch_dirs:
        input_file = batch_dir / DEFAULT_OUTPUT_NAME
        if not input_file.exists():
            missing_batch_count += 1
            continue

        for row in read_jsonl(input_file):
            row_key = str(row.get("row_key") or "")
            if not row_key:
                continue
            if row_key in seen:
                duplicate_count += 1
                continue
            seen.add(row_key)
            merged.append(row)

    stats = {
        "batch_count": len(batch_dirs),
        "missing_batch_count": missing_batch_count,
        "duplicate_count": duplicate_count,
    }
    return merged, stats


def merge_task_batch_comments(task_dir: str | Path) -> list[dict[str, Any]]:
    rows, _stats = collect_task_batch_rows(task_dir)
    return rows


def build_summary(task_dir: Path, rows: list[dict[str, Any]], output_path: Path, stats: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "status": "success",
        "generated_at": now,
        "task_dir": str(task_dir),
        "batch_count": int(stats.get("batch_count") or 0),
        "missing_batch_count": int(stats.get("missing_batch_count") or 0),
        "duplicate_count": int(stats.get("duplicate_count") or 0),
        "row_count": len(rows),
        "out": str(output_path),
    }


def write_task_batch_merge(
    task_dir: str | Path,
    out: str | Path | None = None,
    summary_out: str | Path | None = None,
) -> dict[str, Any]:
    root = Path(task_dir)
    output_path = Path(out) if out else root / DEFAULT_OUTPUT_NAME
    summary_path = Path(summary_out) if summary_out else root / DEFAULT_SUMMARY_NAME
    rows, stats = collect_task_batch_rows(root)
    summary = build_summary(root, rows, output_path, stats)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(rows_to_jsonl(rows), encoding="utf-8")
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge per-batch normalized comment JSONL files for one task.")
    parser.add_argument("--task-dir", required=True, help="Task run directory containing batches/.")
    parser.add_argument("--out", default="", help=f"Output JSONL path. Defaults to {DEFAULT_OUTPUT_NAME}.")
    parser.add_argument("--summary-out", default="", help=f"Summary JSON path. Defaults to {DEFAULT_SUMMARY_NAME}.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    summary = write_task_batch_merge(args.task_dir, args.out or None, args.summary_out or None)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
