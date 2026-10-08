import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,scryptSync,timingSafeEqual,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {runtimePath} from './runtime.mjs';
import {createState,validateState} from './domain.mjs';

export class AppError extends Error{
  constructor(code,message,status=400){super(message);this.code=code;this.status=status;}
}
export const digest=value=>createHash('sha256').update(String(value)).digest('hex');
export function secretEqual(a,b){
  return typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
}
export function createStore(dataDir){
  for(const name of ['cu-workbench.sqlite','cu-workbench.sqlite-wal','cu-workbench.sqlite-shm'])runtimePath(resolve(dataDir,name));
  const db=new DatabaseSync(runtimePath(resolve(dataDir,'cu-workbench.sqlite')));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,status TEXT NOT NULL,data TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,data TEXT NOT NULL,created INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,receipt_id TEXT NOT NULL);");
  const get=key=>{const row=db.prepare('SELECT value FROM kv WHERE key=?').get(key);return row?JSON.parse(row.value):null;};
  const put=(key,value)=>db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  if(!get('state'))put('state',createState());
  validateState(get('state'));
  db.exec('CREATE TABLE IF NOT EXISTS ai_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL,created INTEGER NOT NULL)');
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  function getSession(token){
    if(typeof token!=='string'||token.length>128)return null;
    const row=db.prepare('SELECT csrf,expires FROM sessions WHERE token_hash=? AND expires>?').get(digest(token),Date.now());
    return row?{csrfToken:row.csrf,expiresAt:row.expires}:null;
  }
  function newSession(){
    const token=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url'),expiresAt=Date.now()+7*86400000;
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),csrfToken,expiresAt);
    return {token,csrfToken,expiresAt};
  }
  return {
    close:()=>db.close(),getState:()=>get('state'),hasAccount:()=>!!get('account'),
    initialize(password){
      return transaction(()=>{
        if(get('account'))throw new AppError('setup_closed','这个创宇宙实例已经初始化。',409);
        if(typeof password!=='string'||password.length<10||password.length>256)throw new AppError('password_invalid','密码需为10至256个字符。');
        const salt=randomBytes(24).toString('hex');
        put('account',{salt,hash:scryptSync(password,salt,64).toString('hex')});
      });
    },
    checkPassword(password){
      const account=get('account');
      if(!account||typeof password!=='string'||password.length>256)return false;
      return secretEqual(scryptSync(password,account.salt,64).toString('hex'),account.hash);
    },
    getSession,newSession,
    revokeSession:token=>{if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));},
    getModel:()=>get('model'),
    setModel:config=>put('model',config),
    pendingCount:()=>db.prepare("SELECT count(*) AS n FROM proposals WHERE status='pending'").get().n,
    recordAIRun(run){
      const record={id:randomUUID(),createdAt:new Date().toISOString(),...run};
      db.prepare('INSERT INTO ai_runs VALUES(?,?,?)').run(record.id,JSON.stringify(record),Date.now());
      return record;
    },
    aiRuns:()=>db.prepare('SELECT data FROM ai_runs ORDER BY created DESC,rowid DESC LIMIT 100').all().map(row=>JSON.parse(row.data)),
    addProposal(proposal){
      const rows=db.prepare("SELECT count(*) AS n FROM proposals WHERE status='pending'").get();
      if(rows.n>=30)throw new AppError('proposal_limit','待核对方案过多，请先处理已有方案。',409);
      db.prepare('INSERT INTO proposals VALUES(?,?,?,?)').run(proposal.id,'pending',JSON.stringify(proposal),Date.now());
    },
    getProposal(id){
      const row=db.prepare('SELECT status,data FROM proposals WHERE id=?').get(id);
      return row?{...JSON.parse(row.data),status:row.status}:null;
    },
    getProposalByRequestId(requestId){
      const row=db.prepare("SELECT status,data FROM proposals WHERE json_extract(data,'$.requestId')=? ORDER BY created DESC LIMIT 1").get(requestId);
      return row?{...JSON.parse(row.data),status:row.status}:null;
    },
    setProposalStatus:(id,status)=>db.prepare('UPDATE proposals SET status=? WHERE id=?').run(status,id),
    history(){
      const applied=db.prepare('SELECT data FROM receipts ORDER BY created DESC,rowid DESC LIMIT 100').all().map(row=>({...JSON.parse(row.data),kind:'receipt'}));
      const proposals=db.prepare("SELECT data,status FROM proposals WHERE status IN ('pending','stale') ORDER BY created DESC LIMIT 30").all().map(row=>{
        const {previewState,...data}=JSON.parse(row.data);return {...data,status:row.status,kind:'proposal'};
      });
      return [...proposals,...applied].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    },
    getReceipt(id){const row=db.prepare('SELECT data FROM receipts WHERE id=?').get(id);return row?JSON.parse(row.data):null;},
    request(id,fingerprint){
      const row=db.prepare('SELECT fingerprint,receipt_id FROM requests WHERE id=?').get(id);
      if(row&&row.fingerprint!==fingerprint)throw new AppError('request_conflict','此请求编号已用于其他操作，请刷新后重试。',409);
      return row?this.getReceipt(row.receipt_id):null;
    },
    commit({expectedRevision,state,receipt,requestId,fingerprint,proposalId,undoOf}){
      return transaction(()=>{
        const current=get('state');
        if(current.revision!==expectedRevision)throw new AppError('stale_revision','空间已发生变化，请重新核对后再执行。',409);
        validateState(state);
        if(state.revision!==expectedRevision+1)throw new AppError('revision_invalid','状态版本不连续。',500);
        const serialized=JSON.stringify(state);
        if(Buffer.byteLength(serialized)>8*1024*1024)throw new AppError('storage_limit','首版空间数据已达到8MB上限，请先导出整理。',413);
        // Undo returns the original domain receipt marked undone. Its new audit
        // entry is not itself an executable domain receipt or a redo action.
        const committed=undoOf?{id:randomUUID(),undoOf,status:'undone',workspaceId:receipt.workspaceId,changes:receipt.inverse,createdAt:new Date().toISOString(),appliedRevision:state.revision,message:'已撤销这次修改'}:{...receipt,id:receipt.id||randomUUID(),createdAt:receipt.createdAt||new Date().toISOString(),...(proposalId?{proposalId}:{})};
        if(undoOf){
          const original=this.getReceipt(undoOf);
          if(!original||original.undoneBy)throw new AppError('already_undone','这次修改已经撤销或无法找到。',409);
          db.prepare('UPDATE receipts SET data=? WHERE id=?').run(JSON.stringify({...original,status:'undone',undoneBy:committed.id}),undoOf);
        }
        put('state',state);
        db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(committed.id,JSON.stringify(committed),Date.now());
        db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestId,fingerprint,committed.id);
        if(proposalId)db.prepare("UPDATE proposals SET status='applied' WHERE id=?").run(proposalId);
        return committed;
      });
    }
  };
}
