"""Run only synthetic subprocess fixtures; no provider or original-project access."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
RUNTIME = BACKEND.parent / ".cu-runtime"


class CompetitionPythonCliTests(unittest.TestCase):
    def setUp(self):
        root = Path(tempfile.gettempdir()).resolve()
        self.assertTrue(root.is_relative_to(RUNTIME))
        self.temp = tempfile.TemporaryDirectory(prefix="cli-boundary-", dir=root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def run_cli(self, script, arguments=(), payload=None, env=None):
        result = subprocess.run([sys.executable, "-B", "-I", str(BACKEND / script), *arguments],
                                input=json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                                capture_output=True, text=True, encoding="utf-8", timeout=10,
                                cwd=BACKEND.parent, env={**os.environ, "PYTHONIOENCODING": "utf-8", **(env or {})})
        self.assertEqual(result.stderr, "")
        return result.returncode, json.loads(result.stdout)

    def request(self, directory):
        return {"hermesDir": str(directory), "settings": {"provider": "deepseek", "model": "deepseek-chat", "apiKey": "synthetic-not-a-real-key"}, "system": "fixture", "user": "fixture"}

    def test_extract_cli_reads_only_local_runtime_file(self):
        source = self.root / "input.txt"
        source.write_text("local synthetic text", encoding="utf-8")
        code, value = self.run_cli("extract.py", [str(source), "input.txt"])
        self.assertEqual(code, 0)
        self.assertEqual(value["units"][0]["text"], "local synthetic text")
        code, value = self.run_cli("extract.py", [str(BACKEND / "extract.py"), "input.txt"])
        self.assertEqual((code, value["code"]), (1, "COMPETITION_PATH_FORBIDDEN"))

    def test_extract_cli_rejects_hardlinks_and_preserves_original(self):
        source, linked = self.root / "original.txt", self.root / "linked.txt"
        source.write_text("must remain unchanged", encoding="utf-8")
        os.link(source, linked)
        code, value = self.run_cli("extract.py", [str(linked), "linked.txt"])
        self.assertEqual((code, value["code"]), (1, "COMPETITION_PATH_FORBIDDEN"))
        self.assertEqual(source.read_text(encoding="utf-8"), "must remain unchanged")

    def test_runner_rejects_external_and_hardlinked_engine_before_import(self):
        code, value = self.run_cli("hermes_runner.py", ["--probe"], self.request(BACKEND))
        self.assertEqual((code, value["code"]), (1, "COMPETITION_PATH_FORBIDDEN"))
        source = self.root / "source.py"
        source.write_text("raise RuntimeError('must never import')\n", encoding="utf-8")
        engine = self.root / "engine"
        engine.mkdir()
        os.link(source, engine / "run_agent.py")
        code, value = self.run_cli("hermes_runner.py", ["--probe"], self.request(engine))
        self.assertEqual((code, value["code"]), (1, "COMPETITION_PATH_FORBIDDEN"))

    def test_runner_probe_cleans_inherited_environment_before_engine_import(self):
        engine = self.root / "engine"
        engine.mkdir()
        (engine / "run_agent.py").write_text('''import json, os, sys
from pathlib import Path
class AIAgent:
    def __init__(self, **kwargs):
        assert "DEEPSEEK_API_KEY" not in os.environ
        assert "OLD_PROJECT_PRIVATE" not in os.environ
        assert sys.dont_write_bytecode
        home = Path(os.environ["HOME"])
        assert home == Path.cwd()
        assert all(Path(os.environ[key]) == home for key in ("TEMP", "TMP", "TMPDIR", "USERPROFILE", "HERMES_HOME"))
        assert home.name == "python-runner" and home.parent.name == ".cu-runtime"
        self.tools = []
        self.valid_tool_names = set()
    def run_conversation(self, **kwargs):
        raise AssertionError("probe must never call inference")
    def close(self):
        pass
''', encoding="utf-8")
        code, value = self.run_cli("hermes_runner.py", ["--probe"], self.request(engine),
                                   {"DEEPSEEK_API_KEY": "synthetic-inherited-secret", "OLD_PROJECT_PRIVATE": "synthetic-path", "HOME": "C:/not-authorized", "HERMES_HOME": "C:/not-authorized", "TEMP": "C:/not-authorized"})
        self.assertEqual(code, 0)
        self.assertTrue(value["ok"])
        self.assertFalse(value["inferenceCalled"])
        self.assertFalse((engine / "__pycache__").exists())


if __name__ == "__main__":
    unittest.main()
