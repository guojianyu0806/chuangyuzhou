"""Export public dialogue only; preserve the source and refuse archive overwrites.

Run from this repository: python evidence/prompt-chains/archive_dialogues.py export SOURCE
Verify with original source: python evidence/prompt-chains/archive_dialogues.py verify SOURCE
Verify portable archive: python evidence/prompt-chains/archive_dialogues.py verify
No model calls, private runtime reads, reasoning, or tool arguments are exported.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

BASE = Path(__file__).resolve().parent
SOURCE_NAME = "rollout-2026-10-08T19-16-44-01a11b3a-db07-7f61-8309-5436b1b2b971.jsonl"
CHAINS = {
    "01": {"title": "从个人工作台到可视化搭建平台", "ranges": [[2413, 4226], [6019, 6521], [9494, 9837]]},
    "02": {"title": "AI 查询、修订、确认与撤销闭环", "ranges": [[12921, 14712]]},
    "03": {"title": "自定义方块与受控小程序创建", "ranges": [[4828, 5618], [14715, 15652]]},
}
LAST_LINE = 15652
SECRET = re.compile(r"sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(obj):
    return (json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf8")


def records(source):
    if source.name != SOURCE_NAME:
        raise ValueError("Unexpected source file; this export is tied to one verified session")
    result = {k: [] for k in CHAINS}
    excluded = {k: {} for k in CHAINS}
    prefix = hashlib.sha256()
    count = 0
    with source.open("rb") as stream:
        for number, line in enumerate(stream, 1):
            if number > LAST_LINE:
                break
            count = number
            prefix.update(line)
            keys = [k for k, v in CHAINS.items() if any(a <= number <= b for a, b in v["ranges"])]
            if not keys:
                continue
            record = json.loads(line)
            payload = record.get("payload", {})
            kind = payload.get("type", "")
            role = payload.get("role", "")
            text = None
            category = "message"
            parts = []
            if record.get("type") == "response_item" and kind == "message" and role in ("user", "assistant"):
                if payload.get("channel") not in (None, "commentary", "final"):
                    reason = "non_public_channel"
                else:
                    parts = payload.get("content", [])
                    text = "\n".join(c.get("text", "") for c in parts if c.get("type") in ("input_text", "output_text", "text"))
                    reason = "empty_text"
                    if any(tag in text for tag in ("<INSTRUCTIONS>", "<environment_context>", "<external_codex_apps_open_page>")):
                        text = None
                        reason = "client_context_not_dialogue"
            elif record.get("type") == "response_item" and kind == "function_call" and payload.get("name") == "request_user_input_async":
                # This tool renders the actual question/options to the user; no other tool arguments are exported.
                text = payload.get("arguments", "")
                category = "public_question"
                role = "assistant"
                reason = "empty_question"
            else:
                reason = "non_dialogue_" + (kind or record.get("type", "unknown"))
            if not text:
                for key in keys:
                    excluded[key][reason] = excluded[key].get(reason, 0) + 1
                continue
            safe, replacements = SECRET.subn("[REDACTED_SECRET]", text)
            entry = {
                "id": "L" + str(number), "source_line": number,
                "timestamp_utc": record.get("timestamp"), "role": role, "kind": category,
                "phase": payload.get("phase"), "source_record_sha256": digest(line),
                "source_text_sha256": digest(text.encode("utf8")),
                "export_text_sha256": digest(safe.encode("utf8")),
                "redactions": replacements,
                "non_text_content_types": [p.get("type") for p in parts if p.get("type") not in ("input_text", "output_text", "text")],
                "text": safe,
            }
            for key in keys:
                result[key].append(entry)
    if count != LAST_LINE:
        raise ValueError("Source is shorter than the fixed historical prefix")
    return result, excluded, prefix.hexdigest()


def readable(key, messages):
    text = [f"# 原始公开对话摘编 · 链 {key}\n",
            "以下为指定范围内的全部公开文本消息，按原顺序保留。不是润色后的 Prompt；历史结论不代表当前状态。客户端上下文包装保留在原文中，不视为用户指令。图片仅保留原消息中的引用，未重新导出像素；内部推理、工具执行正文及无关会话不在本文件内。\n"]
    for message in messages:
        text.append(f'<a id="{message["id"]}"></a>\n\n## {message["id"]} · {message["role"]} · {message["timestamp_utc"]} · {message["kind"]}\n')
        # Longer fences than any original fence keep the transcript inert and readable.
        fence = "`" * max(4, max((len(x) + 1 for x in re.findall(r"`+", message["text"])), default=4))
        text.append(f'{fence}text\n{message["text"]}\n{fence}\n')
    return ("\n".join(text) + "\n").encode("utf8")


def export(source):
    result, excluded, prefix = records(source)
    files = {}
    manifest = {
        "schema": 1, "prepared_date": "2026-10-16", "source_basename": SOURCE_NAME,
        "thread_id": "01a11b3a-db07-7f61-8309-5436b1b2b971",
        "source_prefix_last_line": LAST_LINE, "source_prefix_sha256": prefix,
        "scope": "All public textual user/assistant messages and public clarification questions within the listed thematic spans; not the whole session or internal reasoning. Source remains untouched.",
        "chains": {}, "files": {},
    }
    for key, messages in result.items():
        path = f"raw/chain-{key}.jsonl"
        files[path] = ("\n".join(json.dumps(x, ensure_ascii=False) for x in messages) + "\n").encode("utf8")
        files[f"raw/chain-{key}.md"] = readable(key, messages)
        manifest["chains"][key] = {**CHAINS[key], "public_records": len(messages),
            "user_messages": sum(x["role"] == "user" for x in messages),
            "assistant_messages": sum(x["role"] == "assistant" and x["kind"] == "message" for x in messages),
            "public_questions": sum(x["kind"] == "public_question" for x in messages),
            "redactions": sum(x["redactions"] for x in messages), "excluded_record_types": excluded[key]}
    for path, data in files.items():
        manifest["files"][path] = {"sha256": digest(data), "bytes": len(data)}
    files["manifest.json"] = encoded(manifest)
    if any((BASE / path).exists() for path in files):
        raise FileExistsError("Archive already exists; refusing to replace any artifact")
    for path, data in files.items():
        target = BASE / path
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as out:
            out.write(data)
    return {"files": len(files), "chains": manifest["chains"]}


def verify(source=None):
    manifest = json.loads((BASE / "manifest.json").read_text(encoding="utf8"))
    for name, info in manifest["files"].items():
        path = (BASE / name).resolve()
        if not path.is_relative_to(BASE):
            raise ValueError("Archive path escaped")
        data = path.read_bytes()
        if digest(data) != info["sha256"] or len(data) != info["bytes"]:
            raise ValueError("Archive hash mismatch: " + name)
        if SECRET.search(data.decode("utf8")):
            raise ValueError("Unredacted token pattern: " + name)
    actual = {}
    for key in CHAINS:
        actual[key] = [json.loads(line) for line in (BASE / f"raw/chain-{key}.jsonl").read_text(encoding="utf8").splitlines()]
        if readable(key, actual[key]) != (BASE / f"raw/chain-{key}.md").read_bytes():
            raise ValueError("Readable copy differs: " + key)
        for entry in actual[key]:
            if digest(entry["text"].encode("utf8")) != entry["export_text_sha256"]:
                raise ValueError("Message hash mismatch")
    if source:
        expected, excluded, prefix = records(source)
        if prefix != manifest["source_prefix_sha256"] or actual != expected:
            raise ValueError("Source content or selection does not match")
        for key in CHAINS:
            if excluded[key] != manifest["chains"][key]["excluded_record_types"]:
                raise ValueError("Selection exclusions changed")
    return {"status": "passed", "archive_files_verified": len(manifest["files"]),
            "source_verified": bool(source), "source_prefix_lines": LAST_LINE if source else None,
            "public_records": sum(len(v) for v in actual.values()),
            "redactions": sum(x["redactions"] for v in actual.values() for x in v)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "verify"])
    parser.add_argument("source", nargs="?", type=Path)
    args = parser.parse_args()
    if args.action == "export" and args.source is None:
        parser.error("export requires the original source path")
    print(json.dumps(export(args.source) if args.action == "export" else verify(args.source), ensure_ascii=False, indent=2))
