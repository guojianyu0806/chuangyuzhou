"""Build the AI Innovation track's portable source archive from a fixed Git tree."""
from argparse import ArgumentParser
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = "1d0f75fb37eb4faac15a634bad51c3a8dbb1420a"
OLD_TOOLS = "submission/创宇宙-v2"
REPORT = "evidence/engineering/DEV-053-tests-2026-11-15T09-58-55-753Z.tap"
HELPERS = ROOT / "scripts" / "ai-release"


def from_git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def archive_app():
    packed = from_git("archive", "--format=zip", SOURCE, "yuzhou")
    with ZipFile(BytesIO(packed)) as original:
        return {
            name: original.read(name)
            for name in original.namelist()
            if not name.endswith("/")
        }


def copy_helpers(files):
    common = [
        ".gitattributes", ".gitignore", "requirements-extractor.txt",
        "config/extractor-config.example.json", "config/model-settings.example.json",
        "tools/start.mjs", "tools/verify-source.mjs",
    ]
    for path in common:
        files[path] = from_git("show", f"{SOURCE}:{OLD_TOOLS}/{path}")
    files["启动宇宙完整副本.cmd"] = from_git("show", f"{SOURCE}:{OLD_TOOLS}/启动创宇宙.cmd")
    start = files["tools/start.mjs"]
    old_default = b"CZB_YUZHOU_PORT:'4399'"
    if start.count(old_default) != 1:
        raise ValueError("Expected a single default port")
    files["tools/start.mjs"] = start.replace(old_default, b"CZB_YUZHOU_PORT:'4397'")
    files[".env.example"] = b"CZB_YUZHOU_HOST=127.0.0.1\nCZB_YUZHOU_PORT=4397\n"
    files["README.md"] = (HELPERS / "README-提交源码.md").read_bytes()
    files["tools/review-demo.mjs"] = (HELPERS / "review-demo.mjs").read_bytes()
    files["scripts/test-yuzhou.mjs"] = from_git("show", f"{SOURCE}:scripts/test-yuzhou.mjs")
    files[REPORT] = (ROOT / REPORT).read_bytes()
    files["SOURCE-NOTICE.md"] = (
        "# 创宇宙 · 源码版本\n\n"
        f"应用源码提交 `{SOURCE}`。\n\n"
        "压缩包中的 `yuzhou/` 来自这个 Git 版本。外层包含环境配置、独立运行入口、"
        "合成样例启动器和回归记录。需要模型时请在本机配置自己的连接。\n"
    ).encode("utf-8")


def build(destination):
    files = archive_app()
    app_count = len(files)
    copy_helpers(files)
    for name in files:
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or ".cu-runtime" in path.parts:
            raise ValueError(f"Invalid source path: {name}")
    files["SOURCE-MANIFEST.json"] = (json.dumps({
        "version": "2026-11-16-ai-innovation",
        "sourceCommit": SOURCE,
        "applicationFiles": app_count,
        "files": [
            {"path": name, "bytes": len(data), "sha256": sha256(data).hexdigest()}
            for name, data in sorted(files.items())
        ],
    }, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    with ZipFile(destination, "x", ZIP_DEFLATED, compresslevel=7) as archive:
        for name, data in sorted(files.items()):
            archive.writestr(f"chuangyuzhou-ai/{name}", data)
    print(f"{app_count} application files, {len(files)} total files")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT) or not output.parent.is_dir():
        parser.error("Output parent must already exist inside this repository")
    build(output)
