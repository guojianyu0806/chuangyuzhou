"""Archive selected original 0.1.0 evidence without running any historical code.

The original session is read-only. No reconstructed source release is claimed.
All outputs are new files under the competition directory. Refuse overwrites.
"""
from pathlib import Path
import datetime, hashlib, json, re, subprocess, zipfile, shutil

ROOT = Path(__file__).resolve().parents[1]
LOG = Path(r'C:/Users/g2806/.codex/sessions/2026/09/19/rollout-2026-09-19T23-07-16-01a0ba35-1686-7b31-b2cd-2ee676a266b1.jsonl')
OUT = ROOT/'evidence/provenance/DEV-052'
PATCH_LINES = [133,487,497,508,524,562,662,677,696,741,786,795,806,847,861,904]
MESSAGE_LINES = [9,171,419,834,948,960,970,985,995]
RUNTIME_LINES = [562,786,806,847,869,883,890,897,904,914,933]
MAX_LINE = 995
TZ = datetime.timezone(datetime.timedelta(hours=8))

def sha(data): return hashlib.sha256(data).hexdigest()
def git(*args): return subprocess.check_output(['git',*args],cwd=ROOT)
def save(path, value):
    path = ROOT/path
    if not path.is_relative_to(ROOT): raise ValueError('Outside competition directory')
    path.parent.mkdir(parents=True,exist_ok=True)
    data=value if isinstance(value,bytes) else (value if isinstance(value,str) else json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    with path.open('xb') as f:f.write(data)
def mark(n, rows):
    raw,r=rows[n]
    return {'sourceLog':LOG.name,'sourceLine':n,'timestampUtc':r['timestamp'],
            'timestampBeijing':datetime.datetime.fromisoformat(r['timestamp'].replace('Z','+00:00')).astimezone(TZ).isoformat(),
            'sourceRecordSha256':sha(raw)}
def payload_text(q):
    return q.get('input') or q.get('arguments') or ''
def literals(raw, pattern):
    for match in re.finditer(pattern,raw):
        value,end=json.JSONDecoder().raw_decode(raw,match.start(1))
        yield value
def outputs(x):
    if isinstance(x,list):
        for y in x:yield from outputs(y)
    elif isinstance(x,dict):
        if 'exit_code' in x or 'session_id' in x:
            yield {'exitCode':x.get('exit_code'),'processStillRunning':x.get('session_id') is not None,'output':x.get('output','')}
        else:
            for key in ['output','text','content']:
                if key in x:yield from outputs(x[key])
    elif isinstance(x,str):
        try:yield from outputs(json.loads(x))
        except (ValueError,TypeError):
            if x.startswith('Script error:'):yield {'toolError':x}

def main():
    assert not OUT.exists(), 'Preserve older evidence'
    rows={};prefix=hashlib.sha256();prefix_size=0
    with LOG.open('rb') as f:
        for n,raw in enumerate(f,1):
            if n>MAX_LINE:break
            rows[n]=(raw,json.loads(raw));prefix.update(raw);prefix_size+=len(raw)
    assert len(rows)==MAX_LINE
    results={r['payload']['call_id']:n for n,(_,r) in rows.items()
             if r.get('type')=='response_item' and r.get('payload',{}).get('type') in ('custom_tool_call_output','function_call_output')}
    before={'main':git('rev-parse','HEAD').decode().strip(),'mainCommits':git('rev-list','HEAD').decode().splitlines(),
            'snapshotHead':git('rev-parse','codex/yuzhou-historical-snapshots').decode().strip(),
            'snapshotCommits':git('rev-list','codex/yuzhou-historical-snapshots').decode().splitlines(),
            'preservedFiles':{}}
    for base in ['evidence/provenance/DEV-047','evidence/prompt-chains','delivery/2026-10-19_创宇宙正式提交_v1','delivery/2026-10-19_创宇宙正式提交_v2','delivery/2026-10-19_创宇宙网盘提交_v1','delivery/2026-10-19_创宇宙网盘提交_v2']:
        for path in (ROOT/base).rglob('*'):
            if path.is_file():before['preservedFiles'][path.relative_to(ROOT).as_posix()]=sha(path.read_bytes())
    for path in [ROOT/'docs/创宇宙-早期开发与Git补录说明-v1.md',ROOT/'docs/创宇宙-早期开发与Git补录说明-v2.md',ROOT/'delivery/DEV-032/宇宙工作台-完整修订版-纯口播稿-未压缩-2026-10-17.txt']:
        before['preservedFiles'][path.relative_to(ROOT).as_posix()]=sha(path.read_bytes())
    before_path=ROOT/'.local/dev052/before.json'
    if before_path.exists():assert json.loads(before_path.read_text(encoding='utf-8'))==before
    else:save(Path('.local/dev052/before.json'),before)
    backup_path=ROOT/'docs/archive/README-0.1.0记录补充前-v1.md'
    if backup_path.exists():assert backup_path.read_bytes()==(ROOT/'README.md').read_bytes()
    else:save(backup_path.relative_to(ROOT),(ROOT/'README.md').read_bytes())

    patches=[];messages=[];runtime=[]
    for n in PATCH_LINES:
        q=rows[n][1]['payload'];raw=payload_text(q)
        values=list(literals(raw,r'tools\.apply_patch\s*\(\s*(")'))
        assert values,(n,'No patch')
        result_line=results[q['call_id']]
        result=rows[result_line][1]['payload']['output']
        parsed=list(outputs(result))
        state='attempt_failed' if any('toolError' in x for x in parsed) else 'tool_call_completed'
        if n==861:state='attempt_not_sufficient_later_script_missing'
        for part,patch in enumerate(values,1):
            assert patch.startswith('*** Begin Patch') and patch.endswith('*** End Patch')
            suffix=f'-{part:02}' if len(values)>1 else ''
            rel=f'patches/L{n:05}{suffix}.patch.txt'
            save(OUT.relative_to(ROOT)/rel,patch.encode('utf-8'))
            patches.append({**mark(n,rows),'patchPartInCall':part,'path':rel,'bytes':len(patch.encode('utf-8')),'sha256':sha(patch.encode('utf-8')),
                            'fileOperations':re.findall(r'^\*\*\* (?:Add|Update|Delete) File: (.+)$',patch,re.M),
                            'observedState':state,'result':mark(result_line,rows),
                            'scope':'Original patch text; selected root-conversation operation, not a runnable release.'})
    for n in MESSAGE_LINES:
        q=rows[n][1]['payload'];assert q['role']=='user'
        full='\n'.join(x.get('text','') for x in q['content'] if isinstance(x,dict))
        text=full.split('## My request:\n',1)[-1] if '## My request:\n' in full else full
        rel=f'messages/L{n:05}.txt';save(OUT.relative_to(ROOT)/rel,text.encode('utf-8'))
        messages.append({**mark(n,rows),'path':rel,'sha256':sha(text.encode('utf-8')),'extraction':'Verbatim user text; ambient UI context removed only where explicitly delimited.'})
    for n in RUNTIME_LINES:
        q=rows[n][1]['payload'];commands=list(literals(payload_text(q),r'\b(?:cmd|"cmd")\s*:\s*(")'))
        result_line=results[q['call_id']];items=list(outputs(rows[result_line][1]['payload']['output']))
        if n==847:
            # The preceding unrelated policy/source read is not exported.
            commands=[];items=[x for x in items if 'toolError' in x]
        row={**mark(n,rows),'commands':commands,'result':mark(result_line,rows),'capturedResults':items,
             'verificationScope':'Observed historical output; not rerun now.'}
        assert items,(n,'missing result')
        rel=f'runtime/L{n:05}.json';save(OUT.relative_to(ROOT)/rel,row)
        runtime.append({'path':rel,'callLine':n,'resultLine':result_line,'sha256':sha((OUT/rel).read_bytes())})
    assert 'Workbench 0.1.0 (local UI)' in (OUT/'runtime/L00562.json').read_text(encoding='utf-8')
    assert 'ReusedExistingProcess' in (OUT/'runtime/L00914.json').read_text(encoding='utf-8')
    assert '200' in (OUT/'runtime/L00933.json').read_text(encoding='utf-8')
    old_patches=json.loads((ROOT/'evidence/provenance/DEV-047/initial-patch-index.json').read_text(encoding='utf-8'))
    assert all(next(x for x in patches if x['sourceLine']==p['line'])['sha256']==p['sha256'] for p in old_patches)
    manifest={'schemaVersion':1,'product':'创宇宙','identity':'“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。',
              'recordedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'selected-historical-development-and-startup-evidence',
              'source':{'log':LOG.name,'prefixThroughLine':MAX_LINE,'prefixBytes':prefix_size,'prefixSha256':prefix.hexdigest(),'readOnly':True},
              'patches':patches,'messages':messages,'runtimeRecords':runtime,
              'limitations':['Selected original parent-conversation records only; historical subagent file creation is not fully exported.',
                             'No complete runnable 0.1.0 source snapshot or original early Git commits recovered.',
                             'Historical commands were archived as text and were not executed.',
                             'A startup banner and HTTP checks do not prove all features, cloud sync or real model behavior.',
                             'Git supplement commits use current actual dates; source-event dates remain metadata.']}
    save(OUT.relative_to(ROOT)/'manifest.json',manifest)
    readme=f'''# 创宇宙 0.1.0 · 早期开发与启动记录

整理日期：2026-10-20。“宇宙”是同一项目的早期名称，后更名为“创宇宙”并持续迭代。更早原型的界面文字“拾光”也按原文保留。

这里新增保存 {len(patches)} 份原始代码补丁、{len(messages)} 条用户需求，以及 {len(runtime)} 组历史运行/错误/验证记录。它们是依据原始会话整理的开发证据，不是新编写的演示对话或完整0.1.0源码包。

## 从起点开始阅读

| 阶段 | 原始记录 | 能确认的事实 |
| --- | --- | --- |
| 初始需求 | [L9](messages/L00009.txt)、[L171](messages/L00171.txt)、[L419](messages/L00419.txt) | 用户提出多设备个人工作台与AI整理需求，确认先完成界面 |
| 产品规格 | [L133](patches/L00133.patch.txt) | 首份产品规格写入；内容属于当时规划 |
| 首批界面文件 | [L487](patches/L00487.patch.txt)、[L497](patches/L00497.patch.txt)、[L508](patches/L00508.patch.txt)、[L524](patches/L00524.patch.txt) | HTML、图标、服务层、主程序和样式逐步创建；版本字段为0.1.0 |
| 首次启动 | [调用L562 / 输出L565](runtime/L00562.json) | `node server.mjs` 输出 `Workbench 0.1.0 (local UI): http://127.0.0.1:4173`，采集时进程仍在运行 |
| 功能与存储验证 | [L786 / L790](runtime/L00786.json)、[L806 / L810](runtime/L00806.json) | 当时命令输出含任务、附件、导入导出及存储冲突检查结果；不作为本次重测 |
| 次日访问反馈 | [L834](messages/L00834.txt) | 用户反馈127地址无法访问，请求恢复网页 |
| 修复尝试及失败 | [L847](runtime/L00847.json)、[L869](runtime/L00869.json)、[L883](runtime/L00883.json)、[L890](runtime/L00890.json)、[L897](runtime/L00897.json) | 保留补丁匹配失败、脚本不可用/缺失和检查输出；不把中间尝试算作最终成功 |
| Node启动器修复 | [L904补丁](patches/L00904.patch.txt)、[L904 / L908](runtime/L00904.json) | 新增launch.mjs，历史启动器命令返回ready |
| HTTP及复用检查 | [L914 / L917](runtime/L00914.json)、[L933 / L937](runtime/L00933.json) | 当时页面HTTP200、重复启动复用现有进程、启动文件存在 |
| 进入下一轮 | [L948](messages/L00948.txt)、[L960](messages/L00960.txt)、[L970](messages/L00970.txt)、[L985](messages/L00985.txt)、[L995](messages/L00995.txt) | 用户要求自由卡片画布、动态侧栏、AI入口和可自建工作区，并确认继续修改 |

## 时间与原文校验

每条记录在 [manifest.json](manifest.json) 中给出原日志文件名、行号、UTC和北京时间、原始行SHA-256及导出文件SHA-256。运行记录同时关联调用行和结果行；原日志只读且不整份公开。

原有DEV-047六份补丁与本次对应补丁逐字节一致。新增补丁含失败尝试，因此不能按文件顺序直接全部应用后宣称已复原旧程序。`frontend/src/app.js`引用的课程、英语、备份等模块并未在这些主对话补丁中完整覆盖。

0.1.0当时为本机界面阶段，真实模型、云端同步等不能因启动成功而算作已完成。本文只补充开发和启动证据，原始Git与25条快照分支保持原样。

后续衔接：[0.2.0—0.15.0完整留存包快照](../DEV-047/README.md) · [全项目发展时间线](../../../docs/创宇宙-早期开发与Git补录说明-v3.md) · [后期三条真实AI开发链](../../prompt-chains/README.md)
'''
    save(OUT.relative_to(ROOT)/'README.md',readme)
    save(OUT.relative_to(ROOT)/'.gitattributes','* -text whitespace=-blank-at-eof,cr-at-eol\n')
    print(json.dumps({'patches':len(patches),'messages':len(messages),'runtimeRecords':len(runtime),'originalSixPatchesMatch':True,'output':str(OUT)},ensure_ascii=False))

if __name__=='__main__':main()
