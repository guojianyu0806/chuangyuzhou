"""Build a new source ZIP from committed public files only; never read runtime data."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = "delivery/DEV-031/template/"
EXTRAS = {"scripts/test-yuzhou.mjs", "scripts/configure-yuzhou-extractor.mjs", "evidence/provenance/yuzhou-0.15.0-import.json"}
FORBIDDEN = re.compile(r"(^|/)(\.cu-runtime|\.runtime|\.private-cloud|node_modules|\.git|__pycache__)(/|$)|\.(db|sqlite|keystore|jks|pyc)$|(^|/)(setup-code\.txt|model-config\.json|\.env)$", re.I)
SECRET = re.compile(rb"sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")


def git(*args):
    return subprocess.check_output(["git", "-c", "core.quotepath=false", *args], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build(revision):
    commit = git("rev-parse", "--verify", revision + "^{commit}").decode().strip()
    rows = git("ls-tree", "-r", "-z", commit).split(b"\0")
    files, records = {}, []
    for raw in rows:
        if not raw:
            continue
        meta, raw_path = raw.split(b"\t", 1)
        mode, kind, oid = meta.decode().split()
        source = raw_path.decode("utf8")
        if not (source.startswith("yuzhou/") or source.startswith(TEMPLATE) or source in EXTRAS):
            continue
        target = source[len(TEMPLATE):] if source.startswith(TEMPLATE) else source
        if mode not in ("100644", "100755") or kind != "blob":
            raise ValueError("Linked or special source entry rejected: " + source)
        if FORBIDDEN.search(target) or PurePosixPath(target).is_absolute() or ".." in PurePosixPath(target).parts or "\\" in target:
            raise ValueError("Forbidden release path: " + target)
        if target in files:
            raise ValueError("Duplicate package path: " + target)
        data = git("cat-file", "blob", oid)
        if SECRET.search(data):
            raise ValueError("Potential credential found; value withheld: " + source)
        files[target] = data
        records.append({"path": target, "sourcePath": source, "gitBlob": oid, "bytes": len(data), "sha256": sha(data)})
    if not all(p in files for p in ("README.md", ".env.example", "tools/start.mjs", "yuzhou/start.mjs", "scripts/test-yuzhou.mjs")):
        raise ValueError("Incomplete committed release template")
    manifest = {"schemaVersion": 1, "release": "DEV-031", "sourceCommit": commit,
        "sourceBaseVersion": "0.15.0", "nodeMinimum": "22.13.0", "defaultPort": 4399,
        "privateRuntimeIncluded": False, "files": sorted(records, key=lambda row: row["path"])}
    files["SOURCE-MANIFEST.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf8")
    return files, manifest


def package(revision):
    files, manifest = build(revision)
    name = "yuzhou-dev031-" + manifest["sourceCommit"][:12]
    destination = ROOT / "releases" / name
    if destination.exists():
        raise FileExistsError("Release already exists; choose a new committed version")
    destination.mkdir(parents=True)
    if destination.resolve() != destination or destination.is_symlink():
        raise ValueError("Release directory must be an ordinary project path")
    archive = destination / (name + ".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for path, data in sorted(files.items()):
            entry = zipfile.ZipInfo(path, date_time=(2026, 10, 16, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            out.writestr(entry, data)
    with zipfile.ZipFile(archive) as opened:
        if set(opened.namelist()) != set(files) or opened.testzip() is not None:
            raise ValueError("ZIP roundtrip failed")
        for path, data in files.items():
            if opened.read(path) != data:
                raise ValueError("ZIP bytes differ: " + path)
    report = {"status": "passed", "createdAtUtc": datetime.now(timezone.utc).isoformat(),
        "sourceCommit": manifest["sourceCommit"], "archive": archive.relative_to(ROOT).as_posix(),
        "sha256": sha(archive.read_bytes()), "bytes": archive.stat().st_size,
        "payloadFiles": len(manifest["files"]), "applicationFiles": sum(p.startswith("yuzhou/") for p in files),
        "runtimeFiles": 0, "secretPatternMatches": 0, "zipRoundtrip": True,
        "limitations": "Current committed allowlist and known secret patterns only; not a full historical security audit."}
    for name, obj in (("package-report.json", report), ("SOURCE-MANIFEST.json", manifest)):
        with (destination / name).open("x", encoding="utf8", newline="\n") as stream:
            json.dump(obj, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default="HEAD")
    package(parser.parse_args().revision)
