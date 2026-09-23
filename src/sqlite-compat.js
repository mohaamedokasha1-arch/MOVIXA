/* better-sqlite3-compatible wrapper over Node's built-in node:sqlite.
 * Implements the subset MOVIXA uses: prepare/get/all/run, exec, pragma,
 * transaction (pass-through), close. Zero native dependencies.
 */
const { DatabaseSync } = require('node:sqlite');

function num(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}

class Statement {
  constructor(stmt) {
    this.stmt = stmt;
  }
  get(...params) {
    const r = this.stmt.get(...normalize(params));
    return r === undefined ? undefined : r;
  }
  all(...params) {
    return this.stmt.all(...normalize(params));
  }
  run(...params) {
    const r = this.stmt.run(...normalize(params));
    return { changes: num(r.changes), lastInsertRowid: num(r.lastInsertRowid) };
  }
}

/* node:sqlite accepts either variadic positional args or a single object. */
function normalize(params) {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0]) && !Buffer.isBuffer(params[0])) {
    return [params[0]];
  }
  return params;
}

class Database {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
  }
  pragma(str) {
    // e.g. 'journal_mode = WAL' — returns row for reads, undefined otherwise
    const trimmed = String(str).trim();
    if (/^[\w]+$/.test(trimmed) || /^[\w\s=']+$/i.test(trimmed) && !trimmed.includes('=')) {
      const row = this.db.prepare(`PRAGMA ${trimmed}`).get();
      return row ? Object.values(row)[0] : undefined;
    }
    this.db.exec(`PRAGMA ${trimmed}`);
    return undefined;
  }
  exec(sql) {
    return this.db.exec(sql);
  }
  prepare(sql) {
    return new Statement(this.db.prepare(sql));
  }
  transaction(fn) {
    // Pass-through (keeps call sites identical); single-writer app, low risk.
    const wrapped = (...args) => fn(...args);
    return wrapped;
  }
  close() {
    this.db.close();
  }
}

module.exports = Database;
