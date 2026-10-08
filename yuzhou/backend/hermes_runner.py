#!/usr/bin/env python3
"""One isolated, tool-free Hermes turn. JSON stdin/stdout; credentials never in argv."""
import contextlib
import json
import os
import sys
import stat
from pathlib import Path


MAX_FINAL_CHARS = 100000
TRUNCATION_ERRORS = (
    "Response remained truncated after 4 continuation attempts",
    "Response truncated due to output length limit",
    "First response truncated due to output length limit",
)


class CompetitionPathError(Exception):
    pass


RUNTIME_ROOT = Path(__file__).resolve().parent.parent / ".cu-runtime"


def runtime_path(value):
    script = Path(os.path.abspath(__file__))
    target = Path(os.path.abspath(value))
    if not target.is_relative_to(RUNTIME_ROOT):
        raise CompetitionPathError()
    for path in [*reversed((script, *script.parents)), *reversed((target, *target.parents))]:
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if (stat.S_ISLNK(info.st_mode)
                or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
                or (stat.S_ISREG(info.st_mode) and info.st_nlink > 1)):
            raise CompetitionPathError()
    return target


def validate_engine(value):
    root = runtime_path(value)
    # Dependencies imported by run_agent.py must not bridge back to another project.
    if root.is_dir():
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                runtime_path(Path(directory) / name)
    runtime_path(root / "run_agent.py")
    return root


@contextlib.contextmanager
def isolated_runtime(hermes_dir):
    home = runtime_path(RUNTIME_ROOT / "python-runner")
    home.mkdir(parents=True, exist_ok=True)
    previous_env, previous_cwd, previous_path = dict(os.environ), os.getcwd(), list(sys.path)
    previous_bytecode = sys.dont_write_bytecode
    system = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "COMSPEC", "PATHEXT") if key in os.environ}
    try:
        os.environ.clear()
        os.environ.update({**system, "PATH": str(Path(sys.executable).parent),
                           "HOME": str(home), "USERPROFILE": str(home), "HERMES_HOME": str(home),
                           "TEMP": str(home), "TMP": str(home), "TMPDIR": str(home),
                           "PYTHONPATH": str(hermes_dir), "PYTHONDONTWRITEBYTECODE": "1",
                           "PYTHONIOENCODING": "utf-8", "HERMES_API_TIMEOUT": "120",
                           "HERMES_TELEMETRY_DISABLED": "1"})
        # Ignore inherited PYTHONPATH entries; retain the current interpreter's libraries.
        prefixes = (Path(sys.base_prefix), Path(sys.prefix))
        sys.path[:] = [str(hermes_dir)] + [entry for entry in previous_path if entry and
                     any(Path(os.path.abspath(entry)).is_relative_to(prefix) for prefix in prefixes)]
        sys.dont_write_bytecode = True
        os.chdir(home)
        yield
    finally:
        os.chdir(previous_cwd)
        os.environ.clear()
        os.environ.update(previous_env)
        sys.path[:] = previous_path
        sys.dont_write_bytecode = previous_bytecode


def model_output(response):
    """Transport the final text intact; only the parent validates the action schema."""
    if not isinstance(response, dict):
        return {"ok": False, "code": "MODEL_INCOMPLETE"}
    # Use explicit provider metadata when Hermes exposes it. Do not infer a
    # truncation from punctuation in user content or try to complete broken JSON.
    messages = response.get("messages")
    tail = messages[-1] if isinstance(messages, list) and messages else None
    tail_truncated = isinstance(tail, dict) and tail.get("role") == "assistant" and tail.get("finish_reason") == "length"
    if (response.get("finish_reason") in ("length", "max_tokens")
            or response.get("stop_reason") == "max_tokens"
            or tail_truncated
            or response.get("error") in TRUNCATION_ERRORS):
        return {"ok": False, "code": "MODEL_OUTPUT_TRUNCATED"}
    if response.get("completed") is False or response.get("partial") or response.get("failed") or response.get("interrupted") or response.get("error"):
        return {"ok": False, "code": "MODEL_INCOMPLETE"}
    final = response.get("final_response", "")
    if not isinstance(final, str) or not final.strip():
        return {"ok": False, "code": "INVALID_PROPOSAL"}
    if len(final) > MAX_FINAL_CHARS:
        return {"ok": False, "code": "MODEL_OUTPUT_TRUNCATED"}
    # Even fenced or invalid JSON is returned so the parent can perform its
    # bounded format correction without asking the user to resubmit the request.
    return {"ok": True, "output": final}


def emit(value, code=0):
    sys.stdout.write(json.dumps(value, ensure_ascii=False))
    sys.stdout.flush()
    raise SystemExit(code)


def main():
    agent = None
    try:
        for stream in (sys.stdout, sys.stderr):
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8", errors="strict")
        raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            emit({"ok": False, "code": "INVALID_PROPOSAL"}, 1)
        request = json.loads(raw)
        settings = request["settings"]
        if settings.get("provider") != "deepseek" or settings.get("model") not in ("deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner") or not settings.get("apiKey"):
            emit({"ok": False, "code": "MODEL_NOT_CONFIGURED"}, 1)
        hermes_dir = str(validate_engine(request["hermesDir"]))
        if not os.path.isfile(os.path.join(hermes_dir, "run_agent.py")):
            emit({"ok": False, "code": "ENGINE_UNAVAILABLE"}, 1)
        # Imports and provider exceptions may print request metadata. Suppress diagnostics
        # entirely; the parent receives only a fixed error code and the final proposal.
        with isolated_runtime(hermes_dir), open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            from run_agent import AIAgent
            agent = AIAgent(
                model=settings["model"],
                provider="deepseek",
                api_mode="chat_completions",
                api_key=settings["apiKey"],
                base_url="https://api.deepseek.com",
                enabled_toolsets=[],
                quiet_mode=True,
                save_trajectories=False,
                skip_context_files=True,
                skip_memory=True,
                skip_background_review=True,
                load_soul_identity=False,
                max_iterations=2,
                max_tokens=8192,
                request_overrides={"response_format": {"type": "json_object"}},
                run_budget_seconds=150,
            )
            if not hasattr(agent, "tools") or agent.tools or getattr(agent, "valid_tool_names", set()):
                result = {"ok": False, "code": "ENGINE_TOOLS_NOT_EMPTY"}
            elif "--probe" in sys.argv:
                result = {"ok": True, "toolCount": 0, "model": settings["model"], "provider": "deepseek", "inferenceCalled": False}
            else:
                def deny_tools(*_args, **_kwargs):
                    raise RuntimeError("Tool execution is disabled in the workbench adapter")
                # Defense in depth if a provider returns unsolicited tool calls.
                for method in dir(agent):
                    if method.startswith("_execute_") and "tool" in method and callable(getattr(agent, method, None)):
                        setattr(agent, method, deny_tools)
                response = agent.run_conversation(user_message=request["user"], system_message=request["system"])
                result = model_output(response)
            if callable(getattr(agent, "close", None)):
                agent.close()
        emit(result, 0 if result.get("ok") else 1)
    except (SystemExit, KeyboardInterrupt):
        raise
    except CompetitionPathError:
        emit({"ok": False, "code": "COMPETITION_PATH_FORBIDDEN"}, 1)
    except Exception as error:
        status = getattr(error, "status_code", None) or getattr(getattr(error, "response", None), "status_code", None)
        code = "MODEL_AUTH_FAILED" if status in (401, 403) else "MODEL_RATE_LIMIT" if status in (402, 429) else "MODEL_UNAVAILABLE"
        emit({"ok": False, "code": code}, 1)


if __name__ == "__main__":
    main()
