"""Time a fresh ZIP reproduction with normal authentication and isolated synthetic data.

No existing credential is read. A newly generated test setup code is provisioned
before startup; setup/login still use the unmodified application's public APIs.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.cookiejar
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def ordinary(path):
    if not path.absolute().is_relative_to(ROOT) or path.absolute() != path.resolve():
        raise ValueError("Verification path must stay in the ordinary competition tree")
    for parent in [path, *path.parents]:
        if parent.exists() and (parent.is_symlink() or (parent.is_file() and parent.stat().st_nlink > 1)):
            raise ValueError("Linked verification path rejected")
    return path


def main(archive, node, python):
    archive, node = ordinary(archive.absolute()), ordinary(node.absolute())
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    target = ordinary(ROOT / ".local" / ("dev045-clean-" + stamp))
    report_path = ordinary(ROOT / "evidence/engineering" / ("DEV-045-reproduction-" + stamp + ".json"))
    results = {"startedAtUtc": datetime.now(timezone.utc).isoformat(), "status": "running",
        "scope": "Same Windows host; fresh extracted directory, portable Node, empty account and sanitized child environment; not a fresh OS or independent human trial",
        "archive": archive.relative_to(ROOT).as_posix(), "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "directory": target.relative_to(ROOT).as_posix(), "modelRequests": 0,
        "syntheticSetup": "New random setup token prepared by harness, normal setup/login APIs; production credentials never read",
        "steps": []}
    started = time.perf_counter()
    process = None
    log = None
    origin = "http://127.0.0.1:4399"
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
    csrf = ""

    def step(name, **data):
        value = {"name": name, "elapsedSeconds": round(time.perf_counter()-started, 3), **data}
        results["steps"].append(value)
        print(json.dumps(value, ensure_ascii=False), flush=True)

    def request(path, method="GET", body=None, headers=None):
        nonlocal csrf
        actual = {"Origin": origin}
        if csrf:
            actual["X-CSRF-Token"] = csrf
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode("utf8")
            actual["Content-Type"] = "application/json"
        actual.update(headers or {})
        req = urllib.request.Request(origin+path, data=body, headers=actual, method=method)
        try:
            response = opener.open(req, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        data = json.loads(raw) if "application/json" in response.headers.get("Content-Type", "") else raw
        if isinstance(data, dict) and data.get("csrfToken"):
            csrf = data["csrfToken"]
        return response.status, data

    def checked(condition, code):
        if not condition:
            raise RuntimeError(code)

    def command(args, label, timeout=120):
        completed = subprocess.run(args, cwd=target, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout, creationflags=CREATE_NO_WINDOW)
        # These commands use no real credentials; stdout may be retained inside the ignored synthetic tree.
        (target / "yuzhou/.cu-runtime" / (label+".log")).write_bytes(completed.stdout)
        checked(completed.returncode == 0, label+"_failed")
        return completed.stdout

    def start():
        nonlocal process, log
        with socket.socket() as probe:
            probe.bind(("127.0.0.1",4399))
        log = (target / "yuzhou/.cu-runtime" / ("server-"+str(time.time_ns())+".log")).open("xb")
        process = subprocess.Popen([str(node), "tools/start.mjs"], cwd=target, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=CREATE_NO_WINDOW)
        for _ in range(120):
            if process.poll() is not None:
                raise RuntimeError("server_exited_before_ready")
            try:
                status, health = request("/api/health")
                if status == 200 and health.get("ok"):
                    return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(.25)
        raise RuntimeError("server_not_ready_within_30_seconds")

    def stop():
        nonlocal process, log
        if process and process.poll() is None:
            # Kill only the exact tree launched by this harness; never discover or stop an existing listener.
            if os.name == "nt":
                subprocess.run([os.path.join(os.environ["SystemRoot"],"System32","taskkill.exe"), "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, timeout=15)
            else:
                process.terminate()
            process.wait(timeout=15)
        process = None
        if log:
            log.close()
            log = None

    try:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1",4399))
        target.mkdir(parents=True)
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            checked(len(names) == len(set(names)), "duplicate_zip_paths")
            for entry in package.infolist():
                destination = ordinary(target / entry.filename)
                checked(destination.is_relative_to(target) and ".cu-runtime" not in destination.parts, "unsafe_archive_path")
                checked(not entry.is_dir(), "unexpected_directory_entry")
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("xb") as stream:
                    stream.write(package.read(entry))
        runtime = ordinary(target / "yuzhou/.cu-runtime")
        checked(not runtime.exists(), "runtime_in_archive")
        step("fresh_archive_extracted", files=len(names), existingRuntime=False)
        temp = runtime / "temp"
        temp.mkdir(parents=True)
        env = {key: os.environ[key] for key in ("SystemRoot","WINDIR","COMSPEC","PATHEXT") if key in os.environ}
        env.update({"PATH":str(node.parent)+os.pathsep+os.path.join(os.environ["SystemRoot"],"System32"), "TEMP":str(temp), "TMP":str(temp), "TMPDIR":str(temp), "PYTHONDONTWRITEBYTECODE":"1"})
        results["nodeVersion"] = command([str(node),"--version"],"node-version").decode().strip()
        command([str(node),"tools/verify-source.mjs"],"source-verification")
        # Reject unsupported fields without leaking their values or creating account data.
        config = target / ".env"
        for invalid in ("CZB_YUZHOU_HOST=0.0.0.0\n", "CZB_YUZHOU_PORT=80\n", "DATA_DIR=outside\n", "CZB_YUZHOU_PORT=4399\nCZB_YUZHOU_PORT=4398\n"):
            config.write_text(invalid, encoding="utf8")
            trial = subprocess.run([str(node),"tools/start.mjs","--check"],cwd=target,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=CREATE_NO_WINDOW)
            checked(trial.returncode != 0, "invalid_configuration_accepted")
        shutil.copyfile(target / ".env.example", config)
        # Poison only known synthetic values to verify the release launcher discards inherited application variables.
        env.update({"DATA_DIR":str(target/"outside-not-used"), "HOST":"0.0.0.0", "PORT":"4180", "SETUP_TOKEN":"synthetic-inherited-value-must-be-ignored", "SHIGUANG_HERMES_DIR":str(target/"outside-engine")})
        command([str(node),"tools/start.mjs","--check"],"preflight")
        checked(not (runtime/"data").exists(), "preflight_created_account_directory")
        step("source_configuration_and_environment_checks_passed", negativeConfigurations=4)
        setup = secrets.token_urlsafe(32)
        username, password = "reproduce045", secrets.token_urlsafe(24)
        (runtime / "data").mkdir()
        with (runtime / "data/setup-code.txt").open("x", encoding="utf8") as stream:
            stream.write(setup)
        start()
        status, instance = request("/api/instance")
        expected = hashlib.sha256((str(target/"yuzhou/frontend")+"\n"+str(runtime/"data")).encode()).hexdigest()
        checked(status==200 and instance.get("application")=="czb-yuzhou" and instance.get("instanceId")==expected,"wrong_instance")
        status, session = request("/api/auth/session")
        checked(status==200 and session.get("setupRequired") and not session.get("authenticated"),"not_fresh_account")
        checked(request("/api/workspace")[0]==401,"unauthenticated_workspace_read")
        for path in ["/","/src/app.js","/src/builder.js","/src/custom-blocks.js","/miniapp-runtime.html"]:
            checked(request(path)[0]==200,"missing_frontend_resource")
        step("entry_health_identity_and_initialization_page_ready")
        status, _ = request("/api/auth/setup","POST",{"username":username,"password":password,"setupToken":setup})
        checked(status==201,"normal_setup_failed")
        checked(request("/api/auth/setup","POST",{"username":username,"password":password,"setupToken":setup})[0]==409,"setup_not_closed")
        checked(request("/api/auth/logout","POST",{})[0]==200,"logout_failed")
        csrf=""
        checked(request("/api/auth/login","POST",{"username":username,"password":password})[0]==200,"normal_login_failed")
        status, workspace = request("/api/workspace")
        checked(status==200 and workspace.get("revision")==0,"new_workspace_not_empty")
        initial={"schema":1,"mode":"personal","profile":{"name":"复现核验"},"courses":[],"tasks":[],"captures":[],"english":{},"spaces":[],"aiRequests":[],"aiDraft":{"text":"","files":[],"targetId":"auto"}}
        initial["tasks"].append({"id":"dev045-task","title":"核对资料后完善计划","date":"","priority":"normal","description":"本轮独立复现记录","done":False})
        status, saved = request("/api/workspace","PUT",{"baseRevision":0,"state":initial})
        checked(status==200,"workspace_save_failed")
        status, readback = request("/api/workspace")
        checked(status==200 and readback.get("state")==initial,"workspace_readback_failed")
        status, model = request("/api/model/status")
        checked(status==200 and not model.get("configured"),"inherited_model_configuration")
        results["modelConfigured"] = False
        step("normal_account_login_save_and_readback_passed")
        stop()
        jar.clear();csrf=""
        start()
        status, session = request("/api/auth/session")
        checked(status==200 and not session.get("setupRequired"),"restart_reopened_setup")
        checked(request("/api/auth/login","POST",{"username":username,"password":password})[0]==200,"restart_login_failed")
        checked(request("/api/workspace")[1].get("state")==initial,"restart_lost_data")
        checked(not (target/"outside-not-used").exists() and not (target/"outside-engine").exists(),"inherited_path_used")
        results["coreElapsedSeconds"] = round(time.perf_counter()-started,3)
        results["coreWithinTenMinutes"] = results["coreElapsedSeconds"]<=600
        step("restart_persistence_passed", withinTenMinutes=results["coreWithinTenMinutes"])
        content=b"DEV-045 text extraction verified."
        checked(request("/api/files/dev045-text","PUT",content,{"Content-Type":"text/plain","X-File-Name":"source.txt"})[0]==201,"text_upload_failed")
        status, extracted = request("/api/files/dev045-text/text")
        checked(status==200 and "DEV-045" in json.dumps(extracted),"native_text_extraction_failed")
        step("native_text_extraction_passed")
        stop()
        if python:
            optional_started=time.perf_counter()
            venv=runtime/"extractor-venv"
            command([str(python),"-I","-m","venv",str(venv)],"create-venv",180)
            py=venv/"Scripts/python.exe"
            command([str(py),"-I","-m","pip","--isolated","install","--only-binary=:all:","--require-hashes","-r","requirements-extractor.txt","--cache-dir",str(runtime/"pip-cache")],"install-extractor",240)
            command([str(node),"scripts/configure-yuzhou-extractor.mjs","--python",str(py)],"configure-extractor")
            results["extractorVersions"]=command([str(py),"-I","-c","import json,sys,pypdf; print(json.dumps({'python':sys.version.split()[0],'pypdf':pypdf.__version__}))"],"extractor-versions").decode().strip()
            results["optionalSetupSeconds"]=round(time.perf_counter()-optional_started,3)
            step("optional_fresh_python_and_pinned_pdf_dependency_configured")
            jar.clear();csrf=""
            start()
            checked(request("/api/auth/login","POST",{"username":username,"password":password})[0]==200,"optional_restart_login_failed")
            marker="DEV-045 extraction fixture"
            docx=io.BytesIO()
            with zipfile.ZipFile(docx,"w") as sample:
                sample.writestr("word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+marker+'</w:t></w:r></w:p></w:body></w:document>')
            pptx=io.BytesIO()
            with zipfile.ZipFile(pptx,"w") as sample:
                sample.writestr("ppt/slides/slide1.xml",'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>'+marker+'</a:t></a:r></a:p></p:sld>')
            stream=("BT /F1 12 Tf 72 720 Td ("+marker+") Tj ET").encode()
            objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
            pdf=bytearray(b'%PDF-1.4\n');offsets=[0]
            for i,obj in enumerate(objects,1):
                offsets.append(len(pdf));pdf.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
            xref=len(pdf);pdf.extend(b'xref\n0 6\n0000000000 65535 f \n')
            for offset in offsets[1:]:pdf.extend(f'{offset:010d} 00000 n \n'.encode())
            pdf.extend(f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
            for suffix,payload in [("docx",docx.getvalue()),("pptx",pptx.getvalue()),("pdf",bytes(pdf))]:
                fileid="dev045-"+suffix
                checked(request("/api/files/"+fileid,"PUT",payload,{"Content-Type":"application/octet-stream","X-File-Name":"fixture."+suffix})[0]==201,"optional_upload_failed_"+suffix)
                status,text=request("/api/files/"+fileid+"/text")
                checked(status==200 and marker in json.dumps(text),"optional_extraction_failed_"+suffix)
                checked(request("/api/files/"+fileid)[1]==payload,"original_document_changed_"+suffix)
            results["optionalValidationSeconds"]=round(time.perf_counter()-optional_started,3)
            step("docx_pptx_pdf_actual_extraction_and_original_preservation_passed",fixtures="Minimal synthetic parsing fixtures, not full Office compatibility tests")
        results["status"]="passed"
    except Exception as error:
        results["status"]="failed"
        results["failureType"]=type(error).__name__
        results["failureCode"]=str(error) if isinstance(error, RuntimeError) else "inspect_local_synthetic_logs"
        step("verification_failed",failureType=results["failureType"],failureCode=results["failureCode"])
    finally:
        stop()
        results["totalElapsedSeconds"]=round(time.perf_counter()-started,3)
        results["finishedAtUtc"]=datetime.now(timezone.utc).isoformat()
        with socket.socket() as probe:
            results["ownedServerStopped"]=probe.connect_ex(("127.0.0.1",4399))!=0
        with report_path.open("x",encoding="utf8",newline="\n") as stream:
            json.dump(results,stream,ensure_ascii=False,indent=2);stream.write("\n")
        print(json.dumps({"status":results["status"],"report":str(report_path),"directory":str(target),"serverStopped":results["ownedServerStopped"]},ensure_ascii=False),flush=True)
    return 0 if results["status"]=="passed" else 1


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive",type=Path)
    parser.add_argument("--node",required=True,type=Path)
    parser.add_argument("--python",type=Path)
    args=parser.parse_args()
    raise SystemExit(main(args.archive,args.node,args.python))
