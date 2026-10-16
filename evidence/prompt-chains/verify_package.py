"""Read-only archive, reference, Git-byte and historical-result verification.

--report writes a new report using exclusive creation; it never replaces a report.
--source optionally checks the selected text against the original local session.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess
from datetime import datetime, timezone
from urllib.parse import unquote

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
BASELINE = "bab2890"
TEXTS = [BASE / n for n in ["README.md", "原始记录说明.md", "01-可视化搭建平台.md", "02-AI业务闭环.md", "03-自定义方块与小程序.md"]]
FINAL_TESTS = {
    "DEV-020-tests-2026-10-13T11-00-37-860Z.tap": {"tests": 653, "pass": 652, "fail": 0, "skipped": 1},
    "DEV-027-tests-2026-10-15T12-26-41-538Z.tap": {"tests": 785, "pass": 784, "fail": 0, "skipped": 1},
    "DEV-028-tests-2026-10-15T13-57-04-322Z.tap": {"tests": 810, "pass": 809, "fail": 0, "skipped": 1},
}
RED_GREEN = [
    ("DEV-027-board-undo-first-failure-2026-10-15.tap", "DEV-027-board-undo-targeted-2026-10-15.tap"),
    ("DEV-028-miniapp-lifecycle-red-2026-10-15T13-41-05-699Z.tap", "DEV-028-miniapp-lifecycle-green-2026-10-15T13-43-16-656Z.tap"),
    ("DEV-028-block-partial-undo-red-2026-10-15T13-53-37-656Z.tap", "DEV-028-block-partial-undo-green-2026-10-15T13-54-27-667Z.tap"),
]


def git(*args):
    return subprocess.check_output(["git", "-c", "core.quotepath=false", *args], cwd=ROOT)


def tap(name):
    text = (ROOT / "evidence/engineering" / name).read_text(encoding="utf8")
    return {key: int(re.findall(r"^# " + key + r" (\d+)$", text, re.M)[-1]) for key in ("tests", "pass", "fail", "skipped")}


def verify(source=None, report=None):
    if report and (not report.resolve().is_relative_to(BASE) or report.exists()):
        raise ValueError("Report must be new and inside this evidence package")
    dialogue = runpy.run_path(str(BASE / "archive_dialogues.py"))["verify"](source)
    outputs, index = runpy.run_path(str(BASE / "archive_git.py"))["build"]()
    for name, data in outputs.items():
        if data != (BASE / name).read_bytes():
            raise ValueError("Historical Git archive differs: " + name)
    links = 0
    anchors = 0
    for path in TEXTS + [ROOT / "evidence/dev/DEV-030.md"]:
        text = path.read_text(encoding="utf8")
        for link in re.findall(r"\]\(([^)\n]+)\)", text):
            if re.match(r"https?://", link):
                continue
            filename, _, fragment = unquote(link).partition("#")
            target = (path.parent / filename).resolve()
            if not target.is_relative_to(ROOT):
                raise ValueError("Documentation link escaped repository")
            if not target.exists() and not (report and target == report.resolve()):
                raise ValueError(f"Missing reference in {path.name}: {link}")
            if fragment:
                target_text = target.read_text(encoding="utf8")
                if f'id="{fragment}"' not in target_text:
                    raise ValueError(f"Missing dialogue anchor: {link}")
                anchors += 1
            links += 1
    results = {}
    for name, expected in FINAL_TESTS.items():
        results[name] = tap(name)
        if results[name] != expected:
            raise ValueError("Historical test statistics mismatch: " + name)
    for red, green in RED_GREEN:
        results[red], results[green] = tap(red), tap(green)
        if results[red]["fail"] < 1 or results[green]["fail"] != 0:
            raise ValueError("Failure-to-pass evidence mismatch")
    manifest = json.loads((BASE / "manifest.json").read_text(encoding="utf8"))
    stable = ["evidence/prompt-chains/" + p for p in manifest["files"]] + ["evidence/prompt-chains/" + d["path"] for d in index["diffs"].values()]
    for name in stable:
        data = (ROOT / name).read_bytes()
        if git("show", "HEAD:" + name) != data:
            raise ValueError("Committed evidence bytes mismatch")
        if git("-c", "core.autocrlf=true", "cat-file", "--filters", "HEAD:" + name) != data:
            raise ValueError("Windows checkout would change evidence bytes")
    old_changes = git("diff", "--name-only", BASELINE, "--", "app", "yuzhou", "evidence/dev", "evidence/provenance", "evidence/engineering").decode("utf8").splitlines()
    old_changes = [p for p in old_changes if p != "evidence/dev/DEV-030.md"]
    if old_changes:
        raise ValueError("Existing application/evidence modified: " + ", ".join(old_changes))
    secret = re.compile(rb"sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9_.-]{20,}")
    screened = 0
    for path in BASE.rglob("*"):
        if path.is_file() and path.suffix in (".md", ".json", ".jsonl", ".patch"):
            if secret.search(path.read_bytes()):
                raise ValueError("Potential secret in package; content not printed")
            screened += 1
    result = {"status": "passed", "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "kind": "documentation evidence checks; historical tests read, not rerun",
        "dialogue": dialogue, "historical_commits_verified": sum(len(v) for v in index["chains"].values()),
        "diffs_verified": len(index["diffs"]), "local_links_verified": links,
        "dialogue_anchors_verified": anchors, "git_and_windows_checkout_byte_checks": len(stable),
        "secret_pattern_files_checked": screened, "protected_app_and_old_evidence_changes": old_changes,
        "baseline_commit": git("rev-parse", BASELINE).decode().strip(),
        "historical_test_results": results,
        "limitations": ["No new software, browser, model or user trial test", "Selected public text spans only; original image pixels not re-exported", "Hashes establish comparison, not independent attestation", "Only listed credential patterns checked; no claim of a complete security audit"],
    }
    if report:
        with report.open("x", encoding="utf8", newline="\n") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.source, args.report), ensure_ascii=False, indent=2))
