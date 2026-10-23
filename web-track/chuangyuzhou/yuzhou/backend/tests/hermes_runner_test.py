"""No provider calls: exercise the isolated adapter with a mock Hermes module."""
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("hermes_runner", Path(__file__).resolve().parents[1] / "hermes_runner.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class HermesRunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "run_agent.py").write_text("# Only a file-existence fixture.\n", encoding="utf-8")
        self.key = "fake-provider-key-never-log"

    def run_adapter(self, response=None, *, settings=None, tools=None, valid_names=None,
                    probe=False, error=None, attempt_tools=False, missing_engine=False):
        calls = {"run": 0, "close": 0, "tool": 0, "denied": 0}
        secret = self.key

        class FakeAgent:
            def __init__(agent, **kwargs):
                calls["options"] = kwargs
                agent.tools = tools if tools is not None else []
                agent.valid_tool_names = valid_names if valid_names is not None else set()
                print("constructor diagnostics " + secret)
                print("constructor stderr " + secret, file=sys.stderr)

            def _execute_tool_calls(agent, *_args, **_kwargs):
                calls["tool"] += 1
                raise AssertionError("Tool execution must be replaced")

            def _execute_single_tool(agent, *_args, **_kwargs):
                calls["tool"] += 1
                raise AssertionError("Tool execution must be replaced")

            def run_conversation(agent, **kwargs):
                calls["run"] += 1
                calls["messages"] = kwargs
                print("provider diagnostics " + secret)
                print("provider stderr " + secret, file=sys.stderr)
                if attempt_tools:
                    for name in ("_execute_tool_calls", "_execute_single_tool"):
                        try:
                            getattr(agent, name)("pretend-tool")
                        except RuntimeError:
                            calls["denied"] += 1
                if error is not None:
                    raise error
                return response

            def close(agent):
                calls["close"] += 1
                print("close diagnostics " + secret)
                print("close stderr " + secret, file=sys.stderr)

        module = types.ModuleType("run_agent")
        module.AIAgent = FakeAgent
        request = {
            "settings": settings if settings is not None else {
                "provider": "deepseek", "model": "deepseek-chat", "apiKey": self.key,
            },
            "hermesDir": str(self.root / "missing") if missing_engine else str(self.root),
            "system": "Return one JSON object with a proposal or a question.",
            "user": "测试账单 12.30 元，先审核后确认。",
        }
        stdin = types.SimpleNamespace(buffer=io.BytesIO(json.dumps(request).encode("utf-8")))
        stdout, stderr = io.StringIO(), io.StringIO()
        argv = ["hermes_runner.py"] + (["--probe"] if probe else [])
        with patch.dict(sys.modules, {"run_agent": module}), \
                patch.object(sys, "stdin", stdin), patch.object(sys, "stdout", stdout), \
                patch.object(sys, "stderr", stderr), patch.object(sys, "argv", argv), \
                patch.object(sys, "path", list(sys.path)):
            with self.assertRaises(SystemExit) as exited:
                runner.main()
        output = stdout.getvalue()
        self.assertNotIn(self.key, output)
        self.assertEqual(stderr.getvalue(), "")
        result = json.loads(output)
        self.assertEqual(exited.exception.code, 0 if result["ok"] else 1)
        return result, calls

    def test_json_mode_tool_free_options_and_original_output(self):
        text = ' {"reply":"请先审核","proposal":{"ledgerEntries":[{"amount":"12.30"}]}}\n'
        result, calls = self.run_adapter({"completed": True, "final_response": text}, attempt_tools=True)
        self.assertEqual(result, {"ok": True, "output": text})
        options = calls["options"]
        self.assertEqual(options["request_overrides"], {"response_format": {"type": "json_object"}})
        self.assertEqual(options["enabled_toolsets"], [])
        self.assertEqual(options["api_mode"], "chat_completions")
        self.assertEqual(options["base_url"], "https://api.deepseek.com")
        self.assertTrue(options["quiet_mode"])
        for name in ("skip_context_files", "skip_memory", "skip_background_review"):
            self.assertTrue(options[name])
        self.assertFalse(options["load_soul_identity"])
        self.assertFalse(options["save_trajectories"])
        self.assertEqual((calls["run"], calls["close"], calls["tool"], calls["denied"]), (1, 1, 0, 2))
        self.assertNotIn(self.key, json.dumps(calls["messages"]))

    def test_fenced_invalid_and_schema_invalid_json_are_preserved_for_parent(self):
        for text in ('```json\n{"reply":"hello"}\n```', '{"reply": broken',
                     '{"amount":12.3001}', 'Just a normal answer.', '[1,2]', 'null'):
            with self.subTest(text=text):
                result, _ = self.run_adapter({"completed": True, "final_response": text})
                self.assertEqual(result, {"ok": True, "output": text})

    def test_empty_nonstring_and_oversize_outputs_are_fixed_errors(self):
        for value in (None, {}, [], 123, "", " \n\t"):
            with self.subTest(value=value):
                result, _ = self.run_adapter({"completed": True, "final_response": value})
                self.assertEqual(result, {"ok": False, "code": "INVALID_PROPOSAL"})
        result, _ = self.run_adapter({"completed": True, "final_response": "x" * (runner.MAX_FINAL_CHARS + 1)})
        self.assertEqual(result, {"ok": False, "code": "MODEL_OUTPUT_TRUNCATED"})
        value = "x" * runner.MAX_FINAL_CHARS
        result, _ = self.run_adapter({"completed": True, "final_response": value})
        self.assertEqual(result, {"ok": True, "output": value})

    def test_explicit_truncation_uses_fixed_code_without_returning_partial_content(self):
        variants = [
            {"finish_reason": "length"}, {"stop_reason": "max_tokens"},
            {"messages": [{"role": "assistant", "content": "partial", "finish_reason": "length"}]},
        ] + [{"error": text, "completed": False} for text in runner.TRUNCATION_ERRORS]
        for flags in variants:
            with self.subTest(flags=flags):
                result, _ = self.run_adapter({"final_response": '{"reply":"partial', **flags})
                self.assertEqual(result, {"ok": False, "code": "MODEL_OUTPUT_TRUNCATED"})

    def test_old_truncated_message_or_user_text_is_not_current_truncation(self):
        value = '{"reply":"length max_tokens Response truncated due to output length limit"}'
        result, _ = self.run_adapter({"completed": True, "final_response": value, "messages": [
            {"role": "assistant", "finish_reason": "length"},
            {"role": "assistant", "finish_reason": "stop", "content": value},
        ]})
        self.assertEqual(result, {"ok": True, "output": value})

    def test_incomplete_responses_cannot_become_proposals(self):
        for response in (None, [], "text", {"completed": False}, {"partial": True},
                         {"failed": True}, {"interrupted": True}, {"error": "sensitive-provider-error"}):
            with self.subTest(response=response):
                if isinstance(response, dict):
                    response = {"final_response": '{"reply":"looks valid"}', **response}
                result, _ = self.run_adapter(response)
                self.assertEqual(result, {"ok": False, "code": "MODEL_INCOMPLETE"})

    def test_unconfigured_or_unavailable_engine_never_calls_provider(self):
        settings_cases = [
            {}, {"provider": "deepseek", "model": "deepseek-chat"},
            {"provider": "other", "model": "deepseek-chat", "apiKey": self.key},
            {"provider": "deepseek", "model": "unapproved-model", "apiKey": self.key},
        ]
        for settings in settings_cases:
            with self.subTest(settings=settings):
                result, calls = self.run_adapter(settings=settings)
                self.assertEqual(result, {"ok": False, "code": "MODEL_NOT_CONFIGURED"})
                self.assertNotIn("options", calls)
        result, calls = self.run_adapter(missing_engine=True)
        self.assertEqual(result, {"ok": False, "code": "ENGINE_UNAVAILABLE"})
        self.assertNotIn("options", calls)

    def test_tool_registry_fails_closed_and_probe_has_no_inference(self):
        for flags in ({"tools": [{"name": "shell"}]}, {"valid_names": {"shell"}}):
            with self.subTest(flags=flags):
                result, calls = self.run_adapter(**flags)
                self.assertEqual(result, {"ok": False, "code": "ENGINE_TOOLS_NOT_EMPTY"})
                self.assertEqual((calls["run"], calls["close"]), (0, 1))
        result, calls = self.run_adapter(probe=True)
        self.assertEqual(result, {"ok": True, "toolCount": 0, "model": "deepseek-chat", "provider": "deepseek", "inferenceCalled": False})
        self.assertEqual((calls["run"], calls["close"]), (0, 1))

    def test_provider_exception_details_and_credentials_are_never_emitted(self):
        for status, code in ((401, "MODEL_AUTH_FAILED"), (403, "MODEL_AUTH_FAILED"),
                             (402, "MODEL_RATE_LIMIT"), (429, "MODEL_RATE_LIMIT"), (503, "MODEL_UNAVAILABLE")):
            with self.subTest(status=status):
                error = RuntimeError("secret provider request " + self.key)
                error.status_code = status
                result, _ = self.run_adapter(error=error)
                self.assertEqual(result, {"ok": False, "code": code})


if __name__ == "__main__":
    unittest.main()
