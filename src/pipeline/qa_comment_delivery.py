from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


COMMENT_COUNT_THRESHOLD = 0.8
WEIBO_STREAM_NAMES = ("hot", "time")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_json_if_exists(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return read_json(path)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped:
            rows.append(json.loads(stripped))
    return rows


def read_tasks(project_dir: Path) -> list[dict[str, Any]]:
    payload = read_json(project_dir / "crawl-tasks.json")
    tasks = payload.get("tasks") if isinstance(payload, dict) else []
    return [task for task in tasks if isinstance(task, dict)]


def group_comments_by_task(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        task_id = str(row.get("task_id") or "")
        if task_id:
            grouped[task_id].append(row)
    return grouped


def count_rows(rows: list[dict[str, Any]], row_type: str) -> int:
    return len([row for row in rows if row.get("row_type") == row_type])


def has_time_or_location(row: dict[str, Any]) -> bool:
    raw_ai_row = row.get("raw", {}).get("ai_row", {}) if isinstance(row.get("raw"), dict) else {}
    return bool(
        row.get("created_at")
        or row.get("ip_location")
        or raw_ai_row.get("created_at")
        or raw_ai_row.get("ip_location")
    )


def has_source_chunk(row: dict[str, Any]) -> bool:
    raw = row.get("raw", {}) if isinstance(row.get("raw"), dict) else {}
    ai_row = raw.get("ai_row", {}) if isinstance(raw.get("ai_row"), dict) else {}
    return bool(row.get("source_chunk_id") or ai_row.get("source_chunk_id"))


def requires_source_chunk(row: dict[str, Any]) -> bool:
    raw = row.get("raw", {}) if isinstance(row.get("raw"), dict) else {}
    return isinstance(raw.get("ai_row"), dict)


def source_chunk_identity_mode(row: dict[str, Any]) -> str:
    raw = row.get("raw", {}) if isinstance(row.get("raw"), dict) else {}
    source_chunk = raw.get("source_chunk", {}) if isinstance(raw.get("source_chunk"), dict) else {}
    return str(source_chunk.get("identity_mode") or "")


def is_weibo_stream_complete(stream: Any) -> bool:
    if not isinstance(stream, dict):
        return False
    return (
        bool(stream.get("verified"))
        and str(stream.get("stop_reason") or "") == "page_end"
        and int(stream.get("remaining_expand_count") or 0) == 0
    )


def build_weibo_qa_metrics(
    rows: list[dict[str, Any]],
    capture_observation: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    streams = capture_observation.get("streams") if isinstance(capture_observation.get("streams"), dict) else {}
    hot_complete = is_weibo_stream_complete(streams.get("hot"))
    time_complete = is_weibo_stream_complete(streams.get("time"))
    level1_rows = [row for row in rows if row.get("row_type") == "level1"]
    dom_id_rows = [
        row for row in level1_rows
        if source_chunk_identity_mode(row) == "dom_id" and str(row.get("comment_id") or "").strip()
    ]
    composite_rows = [
        row for row in level1_rows
        if source_chunk_identity_mode(row) == "composite_fingerprint"
    ]
    all_level1_rows_are_dom_id = bool(level1_rows) and len(dom_id_rows) == len(level1_rows)
    declared_level1_count = max(0, int(capture_observation.get("declared_comment_count") or 0))
    unique_dom_id_count = len({str(row.get("comment_id") or "").strip() for row in dom_id_rows})
    coverage = (
        unique_dom_id_count / declared_level1_count
        if all_level1_rows_are_dom_id and declared_level1_count
        else None
    )
    issues: list[str] = []

    if not hot_complete:
        issues.append("weibo_hot_stream_incomplete")
    if not time_complete:
        issues.append("weibo_time_stream_incomplete")
    if level1_rows and len(composite_rows) == len(level1_rows):
        issues.append("weibo_composite_identity_only")
    elif level1_rows and not all_level1_rows_are_dom_id:
        issues.append("weibo_missing_identity_evidence")
    if coverage is not None and coverage < COMMENT_COUNT_THRESHOLD:
        issues.append("weibo_level1_coverage_below_threshold")

    return {
        "weibo_hot_stream_complete": hot_complete,
        "weibo_time_stream_complete": time_complete,
        "weibo_declared_level1_count": declared_level1_count,
        "weibo_unique_dom_id_level1_count": unique_dom_id_count,
        "weibo_level1_coverage": coverage,
        "weibo_dual_sort_complete": (
            hot_complete
            and time_complete
            and all_level1_rows_are_dom_id
            and (coverage is None or coverage >= COMMENT_COUNT_THRESHOLD)
        ),
    }, issues


def build_notes(issues: list[str], metrics: dict[str, Any]) -> str:
    notes: list[str] = []
    if "no_comments_collected" in issues:
        notes.append("未采集到评论")
    elif "comment_count_below_threshold" in issues:
        notes.append(
            f"评论数低于客户表 80%：{metrics['actual_comment_count']}/{metrics['expected_comment_count']}"
        )
    if "empty_text" in issues:
        notes.append(f"{metrics['empty_text_count']} 条评论正文为空")
    if "missing_user_name" in issues:
        notes.append(f"{metrics['missing_user_name_count']} 条缺少用户名")
    if "missing_time_or_location" in issues:
        notes.append(f"{metrics['missing_time_or_location_count']} 条缺少时间或地区")
    if "missing_source_chunk" in issues:
        notes.append(f"{metrics['missing_source_chunk_count']} 条缺少 DOM chunk 证据")
    if "missing_ai_extraction_batch" in issues:
        notes.append(f"{metrics['missing_ai_extraction_batch_count']} 个 batch 缺少 AI 结构化输出")
    if "truncated_batch" in issues:
        notes.append(f"{metrics['truncated_batch_count']} 个 batch 达到候选上限")
    if "weibo_hot_stream_incomplete" in issues:
        notes.append("微博按热度排序流未完成")
    if "weibo_time_stream_incomplete" in issues:
        notes.append("微博按时间排序流未完成")
    if "weibo_composite_identity_only" in issues:
        notes.append("微博仅有复合指纹身份，仅可作部分交付，不作为双排序全量采集结论")
    if "weibo_missing_identity_evidence" in issues:
        notes.append("微博一级评论缺少可验证的 DOM 身份证据")
    if "weibo_level1_coverage_below_threshold" in issues:
        notes.append(
            "微博一级评论 DOM-ID 覆盖率低于 80%："
            f"{metrics['weibo_unique_dom_id_level1_count']}/{metrics['weibo_declared_level1_count']}"
        )
    if metrics.get("declared_comment_count", 0):
        notes.append(
            "平台展示 "
            f"{metrics['declared_comment_count']} 条，当前会话可读 "
            f"{metrics['rendered_comment_count']} 条，差异 "
            f"{metrics['rendered_count_gap']} 条"
        )
    return "；".join(notes)


def read_task_batch_metrics(project_dir: Path, task_id: str) -> dict[str, int]:
    batches_dir = project_dir / "runs" / task_id / "batches"
    if not batches_dir.exists():
        return {
            "batch_count": 0,
            "empty_batch_count": 0,
            "missing_ai_extraction_batch_count": 0,
            "truncated_batch_count": 0,
        }

    batch_dirs = sorted(path for path in batches_dir.iterdir() if path.is_dir())
    empty_batch_count = 0
    missing_ai_extraction_batch_count = 0
    truncated_batch_count = 0

    for batch_dir in batch_dirs:
        batch = read_json_if_exists(batch_dir / "comment-dom-batch.json")
        state = batch.get("state") if isinstance(batch.get("state"), dict) else {}
        candidates = batch.get("candidates") if isinstance(batch.get("candidates"), list) else []
        new_candidate_count = state.get("new_candidate_count")
        if new_candidate_count is None:
            new_candidate_count = len(candidates)

        if int(new_candidate_count or 0) == 0:
            empty_batch_count += 1
        if batch.get("batch_kind", "model") == "model" and not (batch_dir / "ai-comment-extraction.json").exists():
            missing_ai_extraction_batch_count += 1
        if state.get("has_more") or state.get("stop_reason") == "max_candidates":
            truncated_batch_count += 1

    return {
        "batch_count": len(batch_dirs),
        "empty_batch_count": empty_batch_count,
        "missing_ai_extraction_batch_count": missing_ai_extraction_batch_count,
        "truncated_batch_count": truncated_batch_count,
    }


def read_task_capture_observation(project_dir: Path, task_id: str) -> dict[str, Any]:
    state = read_json_if_exists(project_dir / "runs" / task_id / "capture-state.json")
    if not state:
        return {
            "declared_comment_count": 0,
            "rendered_comment_count": 0,
            "rendered_count_gap": 0,
            "capture_end_signal": "",
            "streams": {},
        }

    declared = max(0, int(state.get("declared_comment_count") or 0))
    rendered = max(0, int(state.get("captured_record_count") or 0))
    return {
        "declared_comment_count": declared,
        "rendered_comment_count": rendered,
        "rendered_count_gap": max(0, declared - rendered),
        "capture_end_signal": str(state.get("end_signal") or ""),
        "streams": state.get("streams") if isinstance(state.get("streams"), dict) else {},
    }


def build_task_qa(
    task: dict[str, Any],
    rows: list[dict[str, Any]],
    batch_metrics: dict[str, int] | None = None,
    capture_observation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    expected = int(task.get("expected_comment_count") or 0)
    actual = len(rows)
    batch_metrics = batch_metrics or {
        "batch_count": 0,
        "empty_batch_count": 0,
        "missing_ai_extraction_batch_count": 0,
        "truncated_batch_count": 0,
    }
    capture_observation = capture_observation or {
        "declared_comment_count": 0,
        "rendered_comment_count": 0,
        "rendered_count_gap": 0,
        "capture_end_signal": "",
        "streams": {},
    }
    empty_text_count = len([row for row in rows if not str(row.get("text") or "").strip()])
    missing_user_name_count = len([row for row in rows if not str(row.get("user_name") or "").strip()])
    missing_time_or_location_count = len([row for row in rows if not has_time_or_location(row)])
    missing_source_chunk_count = len([
        row for row in rows
        if requires_source_chunk(row) and not has_source_chunk(row)
    ])
    issues: list[str] = []

    if expected and actual == 0:
        issues.append("no_comments_collected")
    elif expected and actual / expected < COMMENT_COUNT_THRESHOLD:
        issues.append("comment_count_below_threshold")

    if empty_text_count:
        issues.append("empty_text")
    if missing_user_name_count:
        issues.append("missing_user_name")
    if missing_time_or_location_count:
        issues.append("missing_time_or_location")
    if missing_source_chunk_count:
        issues.append("missing_source_chunk")
    if batch_metrics["missing_ai_extraction_batch_count"]:
        issues.append("missing_ai_extraction_batch")
    if batch_metrics["truncated_batch_count"]:
        issues.append("truncated_batch")

    weibo_metrics: dict[str, Any] = {}
    if task.get("platform") == "weibo":
        weibo_metrics, weibo_issues = build_weibo_qa_metrics(rows, capture_observation)
        issues.extend(weibo_issues)

    if "no_comments_collected" in issues:
        status = "failed"
    elif issues:
        status = "partial"
    else:
        status = "ok"

    metrics = {
        "expected_comment_count": expected,
        "actual_comment_count": actual,
        "level1_count": count_rows(rows, "level1"),
        "level2_count": count_rows(rows, "level2"),
        "empty_text_count": empty_text_count,
        "missing_user_name_count": missing_user_name_count,
        "missing_time_or_location_count": missing_time_or_location_count,
        "missing_source_chunk_count": missing_source_chunk_count,
        **weibo_metrics,
        **batch_metrics,
        **capture_observation,
    }

    return {
        "task_id": str(task.get("task_id") or ""),
        "phase": task.get("phase", ""),
        "platform": task.get("platform", ""),
        "status": status,
        "issues": issues,
        "notes": build_notes(issues, metrics),
        **metrics,
    }


def project_status(status_counts: Counter[str], total_tasks: int) -> str:
    if total_tasks and status_counts.get("failed", 0) == total_tasks:
        return "failed"
    if status_counts.get("failed", 0) or status_counts.get("partial", 0):
        return "partial"
    return "ok"


def build_qa_summary(project_dir: str | Path, out: str | Path | None = None) -> dict[str, Any]:
    root = Path(project_dir)
    tasks = read_tasks(root)
    comments = read_jsonl(root / "all-normalized-comments.jsonl")
    comments_by_task = group_comments_by_task(comments)
    task_results = [
        build_task_qa(
            task,
            comments_by_task.get(str(task.get("task_id") or ""), []),
            read_task_batch_metrics(root, str(task.get("task_id") or "")),
            read_task_capture_observation(root, str(task.get("task_id") or "")),
        )
        for task in tasks
    ]
    status_counts = Counter(task["status"] for task in task_results)
    summary = {
        "schema_version": "comment-delivery-qa-v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": project_status(status_counts, len(task_results)),
        "total_tasks": len(task_results),
        "ok_count": status_counts.get("ok", 0),
        "partial_count": status_counts.get("partial", 0),
        "failed_count": status_counts.get("failed", 0),
        "total_expected_comment_count": sum(task["expected_comment_count"] for task in task_results),
        "total_actual_comment_count": sum(task["actual_comment_count"] for task in task_results),
        "total_batch_count": sum(task["batch_count"] for task in task_results),
        "total_empty_batch_count": sum(task["empty_batch_count"] for task in task_results),
        "total_missing_ai_extraction_batch_count": sum(
            task["missing_ai_extraction_batch_count"] for task in task_results
        ),
        "total_truncated_batch_count": sum(task["truncated_batch_count"] for task in task_results),
        "tasks": task_results,
    }

    if out:
        output_path = Path(out)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build project-level QA summary for normalized comment delivery.")
    parser.add_argument("--project-dir", required=True, help="Project directory containing crawl-tasks.json and all-normalized-comments.jsonl.")
    parser.add_argument("--out", default="", help="Output qa-summary.json path. Defaults to <project-dir>/qa-summary.json.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    out = args.out or str(Path(args.project_dir) / "qa-summary.json")
    summary = build_qa_summary(args.project_dir, out)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
