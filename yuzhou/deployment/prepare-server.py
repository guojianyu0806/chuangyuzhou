"""Prepare isolated service directories and back up the existing proxy config.

Run as root through the already authenticated SSH connection. No credentials
are read or printed. Existing Hermes services and their configuration stay put.
"""
import datetime
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess

stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = Path('/var/backups/shiguang') / ('before-cloud-' + stamp)
backup.mkdir(parents=True, mode=0o700, exist_ok=False)
os.chmod(backup.parent, 0o700)
shutil.copy2('/etc/caddy/Caddyfile', backup / 'Caddyfile')
os.chmod(backup / 'Caddyfile', 0o600)
try:
    account = pwd.getpwnam('shiguang')
except KeyError:
    subprocess.run(['useradd', '--system', '--user-group', '--home-dir', '/var/lib/shiguang', '--shell', '/usr/sbin/nologin', 'shiguang'], check=True)
    account = pwd.getpwnam('shiguang')
for path in ('/var/lib/shiguang', '/var/lib/shiguang/agent-home', '/var/lib/shiguang/agent-home/.hermes'):
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(p, 0o700)
    os.chown(p, account.pw_uid, account.pw_gid)
for path in ('/opt/shiguang', '/opt/shiguang/releases', '/etc/shiguang', '/etc/caddy/shiguang'):
    Path(path).mkdir(parents=True, exist_ok=True, mode=0o755)
Path('/etc/shiguang').chmod(0o700)
(backup / 'manifest.json').write_text(json.dumps({'createdAt':stamp,'caddyConfig':'/etc/caddy/Caddyfile','existingWorkbench':Path('/opt/shiguang/current').exists()}, indent=2))
print(json.dumps({'backup':str(backup),'serviceUser':account.pw_name,'prepared':True}))
