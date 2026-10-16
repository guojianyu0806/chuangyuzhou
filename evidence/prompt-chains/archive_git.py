"""Export or verify selected real Git commits and scoped implementation diffs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
COMMITS = {
    "01": "0fcb7cf 646429d 847f38c b7a7f02 0cf9c2c f4297f3 68c569d e34b7af a484fa9 5ebe9da 27dd733 154e54e 85317a5 964a7c3 8e1ae7b".split(),
    "02": "b620b9d 6fe0529 7ed458f 6380a5b 8b64e1c c151a54 9b88757 86e650b 02dad36 a5edfeb b5b7e84 c67496d efe9436 d5b79d4".split(),
    "03": "d858a7c 2655406 909c221 9f5f572 c1a6f15 7040b79 7df647a 7e9970e 282a536 0d50627 aa67264 3903106 f35b87f 5debb70 86c03fe b64305a a17e3a8".split(),
}
DIFFS = {
    "154e54e": ["yuzhou/frontend/src/placement.js", "yuzhou/frontend/src/placement.css"],
    "964a7c3": ["yuzhou/frontend/src"],
    "9b88757": ["yuzhou/backend/hermes.mjs", "yuzhou/backend/workspace-queries.mjs"],
    "02dad36": ["yuzhou/backend"],
    "c67496d": ["yuzhou/frontend/src/workspace-actions-core.js", "yuzhou/frontend/src/workspace-actions.js"],
    "efe9436": ["yuzhou/backend"],
    "282a536": ["yuzhou/frontend/src/custom-blocks.js", "yuzhou/frontend/src/miniapp-runtime.js"],
    "3903106": ["yuzhou"],
    "f35b87f": ["yuzhou/backend/hermes.mjs", "yuzhou/backend/tests/miniapp-prompt.test.mjs"],
    "86c03fe": ["yuzhou/frontend/src/workspace-actions-custom-blocks.js", "yuzhou/frontend/tests/custom-blocks.test.mjs"],
}


def git(*args):
    return subprocess.check_output(["git", "-c", "core.quotepath=false", *args], cwd=ROOT)


def build():
    index = {"schema": 1, "note": "Selected historical commits; diffs compare the real first parent to each commit and include only listed paths. No dates or histories rewritten.", "chains": {}, "diffs": {}}
    outputs = {}
    for key, short_ids in COMMITS.items():
        entries = []
        for short in short_ids:
            full, parent, timestamp, subject = git("show", "-s", "--format=%H%n%P%n%cI%n%s", short).decode("utf8").strip().split("\n", 3)
            entries.append({"short": short, "commit": full, "parents": parent.split(), "committed_at": timestamp, "subject": subject})
        index["chains"][key] = entries
    for short, paths in DIFFS.items():
        data = git("diff", "--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", short + "^", short, "--", *paths)
        if not data or re.search(rb"sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}", data):
            raise ValueError("Empty or sensitive diff; requires review")
        path = f"diffs/{short}.patch"
        outputs[path] = data
        index["diffs"][short] = {"path": path, "path_filters": paths, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    outputs["git-index.json"] = (json.dumps(index, ensure_ascii=False, indent=2) + "\n").encode("utf8")
    return outputs, index


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "verify"])
    args = parser.parse_args()
    outputs, index = build()
    if args.action == "export":
        if any((BASE / name).exists() for name in outputs):
            raise FileExistsError("Refusing archive overwrite")
        for name, data in outputs.items():
            path = BASE / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(data)
    else:
        for name, data in outputs.items():
            if (BASE / name).read_bytes() != data:
                raise ValueError("Git evidence mismatch: " + name)
    print(json.dumps({"status": "passed", "action": args.action, "historical_commits": sum(len(v) for v in index["chains"].values()), "diffs": len(index["diffs"])}, ensure_ascii=False))
