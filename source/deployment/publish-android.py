"""Publish an immutable signed APK and install page on the existing HTTPS host.

Usage: sudo python3 publish-android.py <apk> <sha256> <index.html> <icon.svg>
Does not read or change application databases, accounts, or model credentials.
"""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
import json

apk, expected, page, icon = sys.argv[1:]
apk, page, icon = [Path(value).resolve() for value in (apk, page, icon)]
if not re.fullmatch(r'yuzhou-android-[0-9A-Za-z.\-]+\.apk', apk.name):
    raise SystemExit('Unexpected APK filename')
if not re.fullmatch(r'[0-9a-f]{64}', expected) or hashlib.sha256(apk.read_bytes()).hexdigest() != expected:
    raise SystemExit('APK checksum mismatch')
site = Path('/etc/caddy/shiguang/workbench-ip.caddy')
public = Path('/opt/shiguang/mobile')
public.mkdir(mode=0o755, exist_ok=True)
destination = public / apk.name
if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() != expected:
    raise SystemExit('Refusing to replace an existing APK with different bytes')
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup = Path('/var/backups/shiguang') / ('android-downloads-' + stamp)
backup.mkdir(mode=0o700)
shutil.copy2(site, backup / 'workbench-ip.caddy')
for filename in ('index.html', 'icon.svg'):
    if (public / filename).exists():
        shutil.copy2(public / filename, backup / filename)
if not destination.exists():
    shutil.copy2(apk, destination)
    destination.chmod(0o644)
for source, filename in ((page, 'index.html'), (icon, 'icon.svg')):
    temporary = public / (filename + '.' + stamp + '.tmp')
    shutil.copy2(source, temporary)
    temporary.chmod(0o644)
    temporary.replace(public / filename)
original = site.read_text()
replacement = '''handle_path /apps/* {
        root * /opt/shiguang/mobile
        @apk path *.apk
        header @apk Content-Type application/vnd.android.package-archive
        header Cache-Control "no-cache"
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:4180
    }'''
try:
    if 'handle_path /apps/*' not in original:
        if original.count('reverse_proxy 127.0.0.1:4180') != 1:
            raise RuntimeError('Unexpected proxy configuration; inspect manually')
        temporary = site.with_name('workbench-ip.caddy.' + stamp + '.tmp')
        temporary.write_text(original.replace('reverse_proxy 127.0.0.1:4180', replacement))
        temporary.chmod(0o644)
        temporary.replace(site)
    elif 'root * /opt/shiguang/mobile' not in original:
        raise RuntimeError('An unrelated /apps route already exists')
    subprocess.run(['caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], check=True)
    subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
except Exception:
    shutil.copy2(backup / 'workbench-ip.caddy', site)
    for filename in ('index.html', 'icon.svg'):
        if (backup / filename).exists():
            shutil.copy2(backup / filename, public / filename)
    subprocess.run(['systemctl', 'reload', 'caddy'], check=False)
    raise
print(json.dumps({'apk':str(destination), 'sha256':expected, 'backup':str(backup), 'installPage':'https://203.195.191.239/apps/'}))
