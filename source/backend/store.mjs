import {validateConversation} from '../frontend/src/ai-conversation-model.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, linkSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { validateLedger } from '../frontend/src/ledger-model.js';
import { validateTimetable } from '../frontend/src/timetable-model.js';

const scrypt = promisify(scryptCallback);
export const MAX_STATE_BYTES = 12 * 1024 * 1024;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
export class ApiError extends Error {
  constructor(status, code, detail = {}) { super(code); this.status = status; this.code = code; this.detail = detail; }
}
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function secretEqual(a, b) { return timingSafeEqual(Buffer.from(digest(String(a))), Buffer.from(digest(String(b)))); }
export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [salt, key] = (encoded || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const actual = await hashPassword(password, salt);
  return secretEqual(actual, `${salt}:${key}`);
}
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_@.-]{2,64}$/u.test(username)) throw new ApiError(400, 'invalid_username');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new ApiError(400, 'password_length_12_to_256');
}

/** Bounds are enforced before walking domain records. No submitted key is assigned to a prototype. */
export function validateWorkspace(state) {
  let nodes = 0;
  const blobs = new Set();
  const stack = [[state, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop();
    if (++nodes > 220000 || depth > 40) throw new ApiError(400, 'workspace_too_complex');
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') { if (value.length > 2_000_000) throw new ApiError(400, 'workspace_string_too_long'); continue; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new ApiError(400, 'invalid_number'); continue; }
    if (typeof value !== 'object') throw new ApiError(400, 'invalid_workspace');
    if (Array.isArray(value) && value.length > 100000) throw new ApiError(400, 'workspace_too_complex');
    const ids = Array.isArray(value) ? new Set() : null;
    for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key) || key.length > 512 || /[\u0000-\u001f]/.test(key)) throw new ApiError(400, 'invalid_workspace_key');
      if (key === 'blobId' || key === 'fileId' || key === 'audioId') {
        if (typeof item !== 'string' || !FILE_ID.test(item)) throw new ApiError(400, 'invalid_file_id');
        blobs.add(item);
      }
      if (ids && item && typeof item === 'object' && typeof item.id === 'string') {
        if (ids.has(item.id)) throw new ApiError(400, 'duplicate_record_id');
        ids.add(item.id);
      }
      stack.push([item, depth + 1]);
    }
  }
  if (!state || Array.isArray(state) || state.schema !== 1 || state.mode !== 'personal') throw new ApiError(400, 'personal_workspace_required');
  for (const key of ['courses', 'tasks', 'captures']) if (!Array.isArray(state[key])) throw new ApiError(400, 'invalid_workspace');
  for (const key of ['spaces', 'aiRequests']) if (state[key] !== undefined && !Array.isArray(state[key])) throw new ApiError(400, 'invalid_workspace');
  for (const key of ['profile', 'english']) if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) throw new ApiError(400, 'invalid_workspace');
  const recordList = (list, requiredStrings = ['id']) => {
    if (!Array.isArray(list)) throw new ApiError(400, 'invalid_workspace_records');
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, 'invalid_workspace_records');
      for (const key of requiredStrings) if (typeof item[key] !== 'string' || (key === 'id' && (!item[key] || item[key].length > 512))) throw new ApiError(400, 'invalid_workspace_records');
    }
  };
  recordList(state.tasks, ['id', 'title']); recordList(state.captures, ['id']); recordList(state.courses, ['id', 'title']);
  for (const group of [state.courses, state.spaces || []]) {
    recordList(group, ['id', 'title']);
    for (const container of group) {
      recordList(container.notes || [], ['id', 'title']); recordList(container.files || [], ['id', 'blobId', 'name']);
      for (const note of container.notes || []) {
        if (note.content !== undefined && typeof note.content !== 'string') throw new ApiError(400, 'invalid_note_content');
        if (note.revisions !== undefined) recordList(note.revisions, ['title']);
      }
    }
  }
  if (state.aiRequests !== undefined) {
    recordList(state.aiRequests, ['id', 'text']);
    for(const request of state.aiRequests)if(request.conversation!==undefined){try{validateConversation(request.conversation);}catch{throw new ApiError(400,'invalid_conversation');}}
    for (const request of state.aiRequests) if (request.files !== undefined) recordList(request.files, ['id', 'blobId', 'name']);
  }
  if (state.aiDraft !== undefined) {
    if (!state.aiDraft || typeof state.aiDraft !== 'object' || Array.isArray(state.aiDraft) || typeof state.aiDraft.text !== 'string') throw new ApiError(400, 'invalid_ai_draft');
    if (state.aiDraft.files !== undefined) recordList(state.aiDraft.files, ['id', 'blobId', 'name']);
  }
  for (const key of ['words', 'sessions', 'mistakes', 'attempts']) if (state.english[key] !== undefined) recordList(state.english[key]);
  if (state.ledger !== undefined) {
    try { validateLedger(state.ledger); }
    catch { throw new ApiError(400, 'invalid_ledger'); }
  }
  if (state.timetable !== undefined) {
    try { validateTimetable(state.timetable); }
    catch { throw new ApiError(400, 'invalid_timetable'); }
  }
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw new ApiError(413, 'workspace_too_large');
  return { serialized, blobs };
}

export function createStore(dataDir, { sessionMs = 30 * 86400000, historyLimit = 20, storageLimitBytes = 10 * 1024 ** 3, now = Date.now } = {}) {
  const directory = resolve(dataDir);
  const filesDir = join(directory, 'files');
  const tempDir = join(directory, 'tmp');
  for (const dir of [directory, filesDir, tempDir]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); if (process.platform !== 'win32') chmodSync(dir, 0o700); }
  const databasePath = join(directory, 'workbench.sqlite');
  const db = new DatabaseSync(databasePath);
  if (process.platform !== 'win32') chmodSync(databasePath, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS account(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, state TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_history(revision INTEGER PRIMARY KEY, state TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts(key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, attempts INTEGER NOT NULL);
    INSERT OR IGNORE INTO workspace(id,revision,state,updated_at) VALUES(1,0,NULL,'');`);
  const account = () => db.prepare('SELECT username,password_hash FROM account WHERE id=1').get();
  const fileInfo = id => FILE_ID.test(id) ? (db.prepare('SELECT * FROM files WHERE id=?').get(id) || null) : null;
  const filePath = id => { if (!FILE_ID.test(id)) throw new ApiError(400, 'invalid_file_id'); return join(filesDir, id); };
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    directory, filesDir, tempDir, account, fileInfo, filePath,
    createAccount(username, passwordHash) {
      return transaction(() => {
        if (account()) throw new ApiError(409, 'setup_closed');
        db.prepare('INSERT INTO account VALUES(1,?,?,?)').run(username, passwordHash, new Date(now()).toISOString());
      });
    },
    createSession() {
      const token = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
      // Bound abandoned logins while keeping all of the user’s devices signed in.
      db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET 31)').run();
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), csrfToken, now() + sessionMs, now());
      return { token, csrfToken, expiresAt: now() + sessionMs };
    },
    getSession(token) {
      if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
      const row = db.prepare('SELECT csrf,expires_at FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), now());
      const user = row && account();
      return user ? { username: user.username, csrfToken: row.csrf, token, expiresAt: row.expires_at } : null;
    },
    revokeSession(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); },
    authAttempt(key, limit = 8, windowMs = 15 * 60000) {
      const stamp = now();
      db.prepare('DELETE FROM auth_attempts WHERE started_at<?').run(stamp - windowMs);
      const row = db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);
      if (row && row.attempts >= limit) throw new ApiError(429, 'too_many_attempts', { retryAfter: Math.ceil((row.started_at + windowMs - stamp) / 1000) });
      db.prepare('INSERT INTO auth_attempts VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').run(key, stamp);
    },
    clearAttempts(key) { db.prepare('DELETE FROM auth_attempts WHERE key=?').run(key); },
    getWorkspace(sinceRevision) {
      const row = sinceRevision === undefined
        ? db.prepare('SELECT revision,state,updated_at FROM workspace WHERE id=1').get()
        : db.prepare('SELECT revision,CASE WHEN revision=? THEN NULL ELSE state END AS state,updated_at FROM workspace WHERE id=1').get(sinceRevision);
      if (sinceRevision === row.revision) return { revision: row.revision, unchanged: true };
      return { revision: row.revision, state: row.state ? JSON.parse(row.state) : null, updatedAt: row.updated_at };
    },
    saveWorkspace(baseRevision, state) {
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new ApiError(400, 'invalid_base_revision');
      const { serialized, blobs } = validateWorkspace(state);
      return transaction(() => {
        const current = db.prepare('SELECT revision,state,updated_at FROM workspace WHERE id=1').get();
        if (current.revision !== baseRevision) throw new ApiError(409, 'revision_conflict', { revision: current.revision });
        // Older clients may discard fields they do not recognize when importing backups.
        // Require a refresh instead of accepting a workspace that would erase a populated ledger or timetable.
        if (state.ledger === undefined && current.state) {
          const previousLedger = JSON.parse(current.state).ledger;
          if (previousLedger?.entries?.length || previousLedger?.projects?.length) throw new ApiError(409, 'workspace_update_required');
        }
        if (state.timetable === undefined && current.state) {
          const previousTimetable = JSON.parse(current.state).timetable;
          if (previousTimetable?.terms?.length) throw new ApiError(409, 'workspace_update_required');
        }
        if(current.state){
          const incoming=new Map((state.aiRequests||[]).map(r=>[r.id,r]));
          for(const old of JSON.parse(current.state).aiRequests||[]){
            const next=incoming.get(old.id);
            if(next&&old.conversation?.messages?.length&&!next.conversation)throw new ApiError(409,'workspace_update_required');
          }
        }
        const missing = [...blobs].filter(id => !fileInfo(id) || !existsSync(filePath(id)));
        if (missing.length) throw new ApiError(409, 'missing_files', { fileIds: missing.slice(0, 100) });
        const updatedAt = new Date(now()).toISOString(); const revision = baseRevision + 1;
        if (current.state) db.prepare('INSERT INTO workspace_history VALUES(?,?,?)').run(current.revision, current.state, current.updated_at);
        db.prepare('UPDATE workspace SET revision=?,state=?,updated_at=? WHERE id=1').run(revision, serialized, updatedAt);
        db.prepare('DELETE FROM workspace_history WHERE revision NOT IN (SELECT revision FROM workspace_history ORDER BY revision DESC LIMIT ?)').run(historyLimit);
        return { revision, updatedAt };
      });
    },
    commitFile(id, temporaryPath, meta) {
      const previous = fileInfo(id);
      if (previous) {
        if (previous.sha256 !== meta.sha256 || previous.size !== meta.size) throw new ApiError(409, 'file_content_conflict');
        return { ...previous, existed: true };
      }
      const sum = db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM files').get().bytes;
      if (sum + meta.size > storageLimitBytes) throw new ApiError(413, 'storage_quota_exceeded');
      const path = filePath(id);
      let linked = false;
      try {
        return transaction(() => {
          try { linkSync(temporaryPath, path); linked = true; } catch (error) { if (error.code === 'EEXIST') throw new ApiError(409, 'file_content_conflict'); throw error; }
          const createdAt = new Date(now()).toISOString();
          db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?)').run(id, meta.name, meta.type, meta.size, meta.sha256, createdAt);
          return { id, ...meta, created_at: createdAt, existed: false };
        });
      } catch (error) { if (linked) unlinkSync(path); throw error; }
    },
    close() { db.close(); },
  };
}
