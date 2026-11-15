"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_crypto = require("node:crypto");
const node_fs = require("node:fs");
const promises = require("node:fs/promises");
const node_path = require("node:path");
const node_module = require("node:module");
const node_tls = require("node:tls");
const selfsigned = require("selfsigned");
const yazl = require("yazl");
const tesseract_js = require("tesseract.js");
const Database = require("better-sqlite3");
const genai = require("@google/genai");
const node_os = require("node:os");
const node_net = require("node:net");
const promises$1 = require("node:stream/promises");
const STAGES = [
  "New Request",
  "Documents Collection",
  "Documents Review",
  "Ready to Submit",
  "Submitted",
  "Under Process",
  "Additional Documents Required",
  "Approved",
  "Rejected",
  "Passport Returned / Closed"
];
const APP_MODULES = [
  "Dashboard",
  "My Attendance",
  "CRM",
  "Visa Pipeline",
  "Customers",
  "Human Resources",
  "DATA",
  "Documents",
  "Visa Types",
  "Countries",
  "Smart Scanner",
  "Reports",
  "Settings",
  "Gemini API"
];
function defaultModulesForRole(role) {
  return role === "visa" ? ["My Attendance", "Visa Pipeline", "DATA", "Visa Types", "Countries"] : [...APP_MODULES];
}
const roles = ["admin", "visa", "manager"];
const initialAccounts = [
  {
    username: "karam",
    displayName: "Karam",
    role: "admin",
    salt: "cabd4c9cb7673f76eda1fe7668e98866",
    hash: "4e61e2390d39a54cbb6cfccf923519555a0a6a3e91826953c495fb50a8014d64a5eef8322c30b7477194618b6ff7ec84635d04a366a7fd64ac15be7ecbf833e3"
  },
  {
    username: "hind",
    displayName: "Hind",
    role: "visa",
    salt: "4de6089476974c4e034e512be34236ce",
    hash: "61f941bb7d6554e586d2944664c972b9f382d2b788918c138359d525871e6ed0fe82115a4400b0b11bfdc3471ad05fd01b4e53bf5c2bd8ac50ca637e248f018b"
  },
  {
    username: "mustafa",
    displayName: "Mustafa",
    role: "manager",
    salt: "3fab56333fd6c2d32b93c40bd934c98c",
    hash: "5d9cff3238ccf5f990395ab3a8dbacbdafbb044aff3599f9b55c29bd0bd00767d63e4b0e65f1fe96b17e32f475348105350cd58539331f967d200259db31f2b6"
  }
];
function initializeAuthDatabase(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'visa', 'manager')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const migrateAndSeed = db.transaction(() => {
    const tableInfo = db.prepare("PRAGMA table_info(app_users)").all();
    const columns = new Set(tableInfo.map(({ name: name2 }) => name2));
    for (const column of ["id", "username", "display_name", "role"]) {
      if (column !== "id" && !columns.has(column)) {
        throw new Error(`Unsupported app_users schema: missing ${column} column.`);
      }
    }
    if (!columns.has("id")) db.exec("ALTER TABLE app_users ADD COLUMN id INTEGER");
    if (!columns.has("password_salt")) {
      db.exec("ALTER TABLE app_users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.has("password_hash")) {
      db.exec("ALTER TABLE app_users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.has("active")) db.exec("ALTER TABLE app_users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    if (columns.has("salt")) {
      db.exec("UPDATE app_users SET password_salt = salt WHERE password_salt = '' AND salt <> ''");
    }
    const idIsPrimaryKey = tableInfo.some(({ name: name2, pk }) => name2 === "id" && pk === 1);
    if (!idIsPrimaryKey) {
      db.exec(`UPDATE app_users SET id = rowid WHERE id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS app_users_id_unique ON app_users(id);
        CREATE TRIGGER IF NOT EXISTS app_users_assign_id AFTER INSERT ON app_users
        WHEN NEW.id IS NULL BEGIN
          UPDATE app_users SET id = NEW.rowid WHERE rowid = NEW.rowid;
        END;`);
    }
    const find = db.prepare(`SELECT id, password_salt AS passwordSalt, password_hash AS passwordHash
      FROM app_users WHERE username = ? COLLATE NOCASE`);
    const insert = columns.has("salt") ? db.prepare(`INSERT INTO app_users(username, display_name, role, salt, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)`) : db.prepare(`INSERT INTO app_users(username, display_name, role, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, 1)`);
    const updateCredentials = db.prepare(`UPDATE app_users SET password_salt = ?, password_hash = ?
      WHERE id = ?`);
    for (const account of initialAccounts) {
      const existing = find.get(account.username);
      if (!existing) {
        if (columns.has("salt")) {
          insert.run(account.username, account.displayName, account.role, account.salt, account.salt, account.hash);
        } else {
          insert.run(account.username, account.displayName, account.role, account.salt, account.hash);
        }
      } else if (!/^[\da-f]{32}$/i.test(existing.passwordSalt) || !/^[\da-f]{128}$/i.test(existing.passwordHash)) {
        updateCredentials.run(account.salt, account.hash, existing.id);
        if (columns.has("salt")) {
          db.prepare("UPDATE app_users SET salt = ? WHERE id = ?").run(account.salt, existing.id);
        }
      }
    }
  });
  migrateAndSeed();
  db.exec(`CREATE TABLE IF NOT EXISTS app_user_module_permissions (
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    module TEXT NOT NULL,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    PRIMARY KEY (user_id, module)
  )`);
  const insertPermission = db.prepare(`INSERT OR IGNORE INTO app_user_module_permissions(user_id, module, allowed)
    VALUES (?, ?, ?)`);
  const savedUserIds = new Set(db.prepare("SELECT DISTINCT user_id AS id FROM app_user_module_permissions").all().map(({ id: id2 }) => Number(id2)));
  for (const user of db.prepare("SELECT id, role FROM app_users").all()) {
    if (!savedUserIds.has(user.id)) {
      const defaults = new Set(defaultModulesForRole(user.role));
      for (const module2 of APP_MODULES) insertPermission.run(user.id, module2, Number(defaults.has(module2)));
    }
    insertPermission.run(user.id, "My Attendance", 1);
  }
}
function authenticate(db, username, password) {
  if (typeof username !== "string" || typeof password !== "string" || password.length > 256) return null;
  const name2 = username.trim();
  if (!name2) return null;
  const row = db.prepare(`SELECT id, username, display_name AS displayName, role,
    password_salt AS passwordSalt, password_hash AS passwordHash
    FROM app_users WHERE username = ? COLLATE NOCASE AND active = 1`).get(name2);
  if (!row || !roles.includes(row.role) || !/^[\da-f]{32}$/i.test(row.passwordSalt) || !/^[\da-f]{128}$/i.test(row.passwordHash)) return null;
  const actual = node_crypto.scryptSync(password, Buffer.from(row.passwordSalt, "hex"), 64);
  const expected = Buffer.from(row.passwordHash, "hex");
  if (!node_crypto.timingSafeEqual(actual, expected)) return null;
  return toAuthUser(db, row);
}
function listApplicationUsers(db) {
  const rows = db.prepare(`SELECT id, username, display_name AS displayName, role
    FROM app_users ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE`).all();
  return rows.map((row) => toAuthUser(db, row));
}
function createApplicationUser(db, input) {
  const user = parseUserInput(input, true);
  if (db.prepare("SELECT 1 FROM app_users WHERE username = ? COLLATE NOCASE").get(user.username)) {
    throw new Error("That username is already in use.");
  }
  const { salt, hash } = hashPassword$1(user.password);
  const create = db.transaction(() => {
    const result = hasLegacySaltColumn(db) ? db.prepare(`INSERT INTO app_users(username, display_name, role, salt, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)`).run(user.username, user.displayName, user.role, salt, salt, hash) : db.prepare(`INSERT INTO app_users(username, display_name, role, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, 1)`).run(user.username, user.displayName, user.role, salt, hash);
    const id22 = Number(result.lastInsertRowid);
    savePermissions(db, id22, user.permissions ?? defaultModulesForRole(user.role));
    return id22;
  });
  const id2 = create();
  return getApplicationUser(db, id2);
}
function updateApplicationUser(db, actorId, input) {
  const user = parseUserInput(input, false);
  const id2 = user.id;
  if (!id2) throw new Error("Invalid application user ID.");
  const previous = getApplicationUser(db, id2);
  if (id2 === actorId && user.role !== previous.role) {
    throw new Error("You cannot change your own application role while signed in.");
  }
  if (db.prepare("SELECT 1 FROM app_users WHERE username = ? COLLATE NOCASE AND id <> ?").get(user.username, id2)) {
    throw new Error("That username is already in use.");
  }
  const permissions = user.permissions ?? (user.role === previous.role ? previous.permissions : defaultModulesForRole(user.role));
  const update = db.transaction(() => {
    if (user.password) {
      const { salt, hash } = hashPassword$1(user.password);
      if (hasLegacySaltColumn(db)) {
        db.prepare(`UPDATE app_users SET username = ?, display_name = ?, role = ?, salt = ?, password_salt = ?,
          password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.username, user.displayName, user.role, salt, salt, hash, id2);
      } else {
        db.prepare(`UPDATE app_users SET username = ?, display_name = ?, role = ?, password_salt = ?,
          password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.username, user.displayName, user.role, salt, hash, id2);
      }
    } else {
      db.prepare(`UPDATE app_users SET username = ?, display_name = ?, role = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.username, user.displayName, user.role, id2);
    }
    savePermissions(db, id2, permissions);
  });
  update();
  return getApplicationUser(db, id2);
}
function deleteApplicationUser(db, actorId, id2) {
  if (!Number.isSafeInteger(id2) || id2 <= 0) throw new Error("Invalid application user ID.");
  if (id2 === actorId) throw new Error("You cannot delete the account you are currently using.");
  const user = getApplicationUser(db, id2);
  if (user.role === "admin") {
    const admins = db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin'").get();
    if (admins.count <= 1) throw new Error("The last administrator account cannot be deleted.");
  }
  db.prepare("DELETE FROM app_users WHERE id = ?").run(id2);
}
function parseUserInput(input, passwordRequired) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid application user details.");
  const value = input;
  const id2 = value.id;
  if (id2 !== void 0 && (!Number.isSafeInteger(id2) || Number(id2) <= 0)) throw new Error("Invalid application user ID.");
  if (passwordRequired && id2 !== void 0) throw new Error("Invalid new application user details.");
  if (typeof value.username !== "string" || typeof value.displayName !== "string" || typeof value.role !== "string" || !roles.includes(value.role)) {
    throw new Error("Enter a username, display name, and valid application role.");
  }
  const username = value.username.trim().toLowerCase();
  const displayName = value.displayName.trim();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error("Username must be 3–32 characters and use letters, numbers, dots, underscores, or hyphens.");
  }
  if (displayName.length < 1 || displayName.length > 80) throw new Error("Display name must be between 1 and 80 characters.");
  let password;
  if (typeof value.password === "string") password = value.password;
  else if (value.password !== void 0) throw new Error("Invalid application password.");
  if (passwordRequired && (!password || password.length < 8 || password.length > 256)) {
    throw new Error("Password must be between 8 and 256 characters.");
  }
  if (password && (password.length < 8 || password.length > 256)) throw new Error("Password must be between 8 and 256 characters.");
  let permissions;
  if (value.permissions !== void 0) {
    if (!Array.isArray(value.permissions) || value.permissions.some((module2) => typeof module2 !== "string" || !APP_MODULES.includes(module2))) {
      throw new Error("Invalid application module permissions.");
    }
    permissions = [...new Set(value.permissions)];
  }
  return {
    ...id2 === void 0 ? {} : { id: Number(id2) },
    username,
    displayName,
    role: value.role,
    ...password ? { password } : {},
    ...permissions ? { permissions } : {}
  };
}
function getApplicationUser(db, id2) {
  const row = db.prepare(`SELECT id, username, display_name AS displayName, role
    FROM app_users WHERE id = ?`).get(id2);
  if (!row) throw new Error("Application user not found.");
  return toAuthUser(db, row);
}
function toAuthUser(db, row) {
  const permissions = db.prepare(`SELECT module FROM app_user_module_permissions
    WHERE user_id = ? AND allowed = 1`).all(row.id);
  const savedModules = new Set(permissions.map(({ module: module2 }) => module2));
  savedModules.add("My Attendance");
  const savedPermissions = APP_MODULES.filter((module2) => savedModules.has(module2));
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    permissions: row.role === "admin" ? [...APP_MODULES] : savedPermissions
  };
}
function savePermissions(db, userId, permissions) {
  const allowed = new Set(permissions);
  if (allowed.size !== permissions.length || permissions.some((module2) => !APP_MODULES.includes(module2))) {
    throw new Error("Invalid application module permissions.");
  }
  const user = db.prepare("SELECT role FROM app_users WHERE id = ?").get(userId);
  allowed.add("My Attendance");
  if (user?.role === "admin") {
    allowed.clear();
    APP_MODULES.forEach((module2) => allowed.add(module2));
  }
  db.prepare("DELETE FROM app_user_module_permissions WHERE user_id = ?").run(userId);
  const insert = db.prepare(`INSERT INTO app_user_module_permissions(user_id, module, allowed)
    VALUES (?, ?, ?)`);
  for (const module2 of APP_MODULES) insert.run(userId, module2, Number(allowed.has(module2)));
}
function hasLegacySaltColumn(db) {
  return db.prepare("PRAGMA table_info(app_users)").all().some(({ name: name2 }) => name2 === "salt");
}
function hashPassword$1(password) {
  const salt = node_crypto.randomBytes(16);
  return { salt: salt.toString("hex"), hash: node_crypto.scryptSync(password, salt, 64).toString("hex") };
}
const employeeStatuses = /* @__PURE__ */ new Set(["Active", "On Leave", "Suspended", "Resigned", "Terminated"]);
const attendanceStatuses = /* @__PURE__ */ new Set(["Present", "Absent", "Late", "Half Day", "Early Leave", "Official Leave", "Holiday", "Day Off"]);
const leaveStatuses = /* @__PURE__ */ new Set(["Pending", "Approved", "Rejected", "Cancelled"]);
function initializeHrDatabase(db) {
  const employeeUserAssignmentsExist = Boolean(db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'hr_employee_user_assignments'`).get());
  const migrate = db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS hr_departments (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_employees (
      id INTEGER PRIMARY KEY,
      employee_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_id INTEGER REFERENCES hr_departments(id) ON DELETE SET NULL,
      job_title TEXT NOT NULL DEFAULT '',
      hire_date TEXT NOT NULL,
      employment_type TEXT NOT NULL DEFAULT 'Full-time',
      status TEXT NOT NULL DEFAULT 'Active',
      basic_salary INTEGER NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
      hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
      work_start TEXT,
      work_end TEXT,
      photo_path TEXT,
      archived_at TEXT,
      archived_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_employee_user_assignments (
      employee_id INTEGER PRIMARY KEY REFERENCES hr_employees(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_employees_name_idx ON hr_employees(full_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS hr_employees_department_idx ON hr_employees(department_id, status);
    CREATE TABLE IF NOT EXISTS hr_employee_code_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_value INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS hr_attendance (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      attendance_date TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      status TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, attendance_date)
    );
    CREATE INDEX IF NOT EXISTS hr_attendance_date_idx ON hr_attendance(attendance_date, status);
    CREATE TABLE IF NOT EXISTS hr_leave_balances (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      leave_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      allocated_days REAL NOT NULL CHECK (allocated_days >= 0),
      used_days REAL NOT NULL DEFAULT 0 CHECK (used_days >= 0),
      UNIQUE(employee_id, leave_type, year)
    );
    CREATE TABLE IF NOT EXISTS hr_leave_requests (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      total_days REAL NOT NULL CHECK (total_days > 0),
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pending',
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_leave_dates_idx ON hr_leave_requests(start_date, end_date, status);
    CREATE TABLE IF NOT EXISTS hr_payroll_periods (
      id INTEGER PRIMARY KEY,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
      status TEXT NOT NULL DEFAULT 'Draft',
      created_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(month, year)
    );
    CREATE TABLE IF NOT EXISTS hr_payroll_records (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      payroll_period_id INTEGER NOT NULL REFERENCES hr_payroll_periods(id),
      basic_salary INTEGER NOT NULL CHECK (basic_salary >= 0),
      hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
      worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
      total_bonuses INTEGER NOT NULL DEFAULT 0 CHECK (total_bonuses >= 0),
      total_allowances INTEGER NOT NULL DEFAULT 0 CHECK (total_allowances >= 0),
      total_deductions INTEGER NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
      total_advance_repayments INTEGER NOT NULL DEFAULT 0 CHECK (total_advance_repayments >= 0),
      net_salary INTEGER NOT NULL CHECK (net_salary >= 0),
      payment_status TEXT NOT NULL DEFAULT 'Unpaid',
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, payroll_period_id)
    );
    CREATE TABLE IF NOT EXISTS hr_payroll_items (
      id INTEGER PRIMARY KEY,
      payroll_record_id INTEGER NOT NULL REFERENCES hr_payroll_records(id),
      item_type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_employee_advances (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      advance_amount INTEGER NOT NULL CHECK (advance_amount > 0),
      outstanding_balance INTEGER NOT NULL CHECK (outstanding_balance >= 0),
      issue_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hr_advance_repayments (
      id INTEGER PRIMARY KEY,
      advance_id INTEGER NOT NULL REFERENCES hr_employee_advances(id),
      payroll_record_id INTEGER REFERENCES hr_payroll_records(id),
      amount INTEGER NOT NULL CHECK (amount > 0),
      repayment_date TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hr_employee_documents (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      document_name TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      issue_date TEXT,
      expiration_date TEXT,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_document_expiration_idx ON hr_employee_documents(expiration_date);
    CREATE TABLE IF NOT EXISTS hr_candidates (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_candidates_department_idx
      ON hr_candidates(department_id, is_starred DESC, full_name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS hr_audit_logs (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_security_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    if (!employeeUserAssignmentsExist) {
      db.exec(`INSERT OR IGNORE INTO hr_employee_user_assignments(employee_id, user_id)
        SELECT e.id, u.id FROM hr_employees e JOIN app_users u
          ON LOWER(TRIM(e.full_name)) = LOWER(TRIM(u.display_name))
        WHERE e.archived_at IS NULL AND e.status = 'Active'
          AND (SELECT COUNT(*) FROM hr_employees match_employee
            WHERE LOWER(TRIM(match_employee.full_name)) = LOWER(TRIM(u.display_name))
              AND match_employee.archived_at IS NULL AND match_employee.status = 'Active') = 1
          AND (SELECT COUNT(*) FROM app_users match_user
            WHERE LOWER(TRIM(match_user.display_name)) = LOWER(TRIM(e.full_name))) = 1`);
    }
    const seedDepartment = db.prepare("INSERT OR IGNORE INTO hr_departments(name) VALUES (?)");
    for (const name2 of ["VISA", "Operations", "Manager", "Office Boy", "Accountant", "CRM", "Media"]) seedDepartment.run(name2);
    db.prepare(`INSERT OR IGNORE INTO hr_employee_code_sequence(id, last_value)
      SELECT 1, COALESCE(MAX(CAST(substr(employee_code, 8) AS INTEGER)), 0)
      FROM hr_employees WHERE employee_code GLOB 'BL-EMP-[0-9]*'`).run();
    db.prepare(`UPDATE hr_employee_code_sequence SET last_value = MAX(last_value,
      (SELECT COALESCE(MAX(CAST(substr(employee_code, 8) AS INTEGER)), 0)
        FROM hr_employees WHERE employee_code GLOB 'BL-EMP-[0-9]*')) WHERE id = 1`).run();
    const employeeColumns = db.pragma("table_info(hr_employees)");
    if (!employeeColumns.some((column) => column.name === "archived_status")) {
      db.exec("ALTER TABLE hr_employees ADD COLUMN archived_status TEXT");
    }
    if (!employeeColumns.some((column) => column.name === "hourly_rate")) {
      db.exec("ALTER TABLE hr_employees ADD COLUMN hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0)");
    }
    if (!employeeColumns.some((column) => column.name === "work_start")) {
      db.exec("ALTER TABLE hr_employees ADD COLUMN work_start TEXT");
    }
    if (!employeeColumns.some((column) => column.name === "work_end")) {
      db.exec("ALTER TABLE hr_employees ADD COLUMN work_end TEXT");
    }
    if (!employeeColumns.some((column) => column.name === "photo_path")) {
      db.exec("ALTER TABLE hr_employees ADD COLUMN photo_path TEXT");
    }
    const payrollColumns = db.pragma("table_info(hr_payroll_records)");
    if (!payrollColumns.some((column) => column.name === "hourly_rate")) {
      db.exec("ALTER TABLE hr_payroll_records ADD COLUMN hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0)");
    }
    if (!payrollColumns.some((column) => column.name === "worked_minutes")) {
      db.exec("ALTER TABLE hr_payroll_records ADD COLUMN worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0)");
    }
  });
  migrate();
}
function audit(db, actor, type, id2, action, oldValue, newValue) {
  db.prepare(`INSERT INTO hr_audit_logs(user_id, entity_type, entity_id, action, old_values, new_values)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    actor,
    type,
    id2,
    action,
    oldValue === void 0 ? null : JSON.stringify(oldValue),
    newValue === void 0 ? null : JSON.stringify(newValue)
  );
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && (/* @__PURE__ */ new Date(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
}
function validTime(value) {
  return value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function actorName(actor) {
  const value = actor.trim();
  if (!value || value.length > 100) throw new Error("Invalid HR operator.");
  return value;
}
function listHrDepartments(db) {
  return db.prepare("SELECT id, name, description FROM hr_departments ORDER BY name COLLATE NOCASE").all();
}
function saveHrDepartment(db, actor, input) {
  const name2 = input.name.trim();
  const description = input.description.trim();
  if (name2.length < 2 || name2.length > 80 || description.length > 500) throw new Error("Department name must be 2–80 characters.");
  const save = db.transaction(() => {
    if (input.id === void 0) {
      const result = db.prepare("INSERT INTO hr_departments(name, description) VALUES (?, ?)").run(name2, description);
      audit(db, actorName(actor), "department", Number(result.lastInsertRowid), "created", void 0, { name: name2, description });
    } else {
      const previous = db.prepare("SELECT name, description FROM hr_departments WHERE id = ?").get(input.id);
      if (!previous) throw new Error("Department not found.");
      db.prepare("UPDATE hr_departments SET name = ?, description = ? WHERE id = ?").run(name2, description, input.id);
      audit(db, actorName(actor), "department", input.id, "updated", previous, { name: name2, description });
    }
  });
  save();
}
const employeeSelect = `SELECT e.id, e.employee_code AS employeeCode, e.full_name AS fullName,
  e.phone, e.email, e.department_id AS departmentId, COALESCE(d.name, '') AS departmentName,
  e.job_title AS jobTitle, e.hire_date AS hireDate, e.employment_type AS employmentType,
  e.status, e.hourly_rate AS hourlyRate, e.work_start AS workStart, e.work_end AS workEnd,
  e.archived_at AS archivedAt, e.photo_path AS photoPath,
  a.user_id AS appUserId, u.username AS appUsername, u.display_name AS appUserDisplayName
  FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
  LEFT JOIN hr_employee_user_assignments a ON a.employee_id = e.id
  LEFT JOIN app_users u ON u.id = a.user_id`;
function listHrEmployees(db, search = "", includeArchived = false) {
  if (typeof search !== "string" || search.length > 200) throw new Error("Invalid employee search.");
  const term = `%${search.trim()}%`;
  return db.prepare(`${employeeSelect} WHERE (? = 1 OR e.archived_at IS NULL)
    AND (e.full_name LIKE ? OR e.employee_code LIKE ? OR e.phone LIKE ? OR e.email LIKE ?)
    ORDER BY e.archived_at IS NOT NULL, e.full_name COLLATE NOCASE LIMIT 500`).all(includeArchived ? 1 : 0, term, term, term, term);
}
function saveHrEmployee(db, actor, input) {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const jobTitle = input.jobTitle.trim();
  if (fullName.length < 2 || fullName.length > 160 || phone.length > 40 || email.length > 254 || jobTitle.length > 100) {
    throw new Error("Enter a valid employee name, contact, and job title.");
  }
  if (!validDate(input.hireDate) || !employeeStatuses.has(input.status) || !Number.isSafeInteger(input.hourlyRate) || input.hourlyRate <= 0 || !["Full-time", "Part-time", "Contract", "Temporary"].includes(input.employmentType)) {
    throw new Error("Enter valid employment details and an hourly rate greater than zero.");
  }
  if (input.workStart === void 0 !== (input.workEnd === void 0)) {
    throw new Error("Set both scheduled work hours or leave both unset.");
  }
  if (input.workStart !== void 0 && input.workEnd !== void 0) {
    if (input.workStart === null !== (input.workEnd === null) || input.workStart !== null && input.workEnd !== null && (!validTime(input.workStart) || !validTime(input.workEnd) || input.workStart >= input.workEnd)) {
      throw new Error("Enter valid work hours with an end time later than the start time.");
    }
  }
  if (input.appUserId !== void 0 && input.appUserId !== null && (!Number.isSafeInteger(input.appUserId) || input.appUserId <= 0)) throw new Error("Select a valid application user.");
  const save = db.transaction(() => {
    if (input.departmentId !== null && !db.prepare("SELECT 1 FROM hr_departments WHERE id = ?").get(input.departmentId)) {
      throw new Error("Selected department does not exist.");
    }
    if (input.appUserId !== void 0 && input.appUserId !== null) {
      if (!db.prepare("SELECT 1 FROM app_users WHERE id = ?").get(input.appUserId)) throw new Error("Selected application user does not exist.");
      const currentAssignment = db.prepare("SELECT employee_id AS employeeId FROM hr_employee_user_assignments WHERE user_id = ?").get(input.appUserId);
      if (currentAssignment && currentAssignment.employeeId !== input.id) {
        throw new Error("This application user is already assigned to another employee.");
      }
    }
    if (input.id === void 0) {
      const sequence = Number(db.prepare("SELECT last_value AS value FROM hr_employee_code_sequence WHERE id = 1").get().value) + 1;
      db.prepare("UPDATE hr_employee_code_sequence SET last_value = ? WHERE id = 1").run(sequence);
      const employeeCode = `BL-EMP-${String(sequence).padStart(3, "0")}`;
      const result = db.prepare(`INSERT INTO hr_employees(employee_code, full_name, phone, email, department_id,
        job_title, hire_date, employment_type, status, basic_salary, hourly_rate, work_start, work_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(
        employeeCode,
        fullName,
        phone,
        email,
        input.departmentId,
        jobTitle,
        input.hireDate,
        input.employmentType,
        input.status,
        input.hourlyRate,
        input.workStart ?? null,
        input.workEnd ?? null
      );
      const id22 = Number(result.lastInsertRowid);
      saveHrEmployeeUserAssignment(db, id22, input.appUserId);
      audit(db, actorName(actor), "employee", id22, "created", void 0, input);
      return id22;
    }
    const previous = db.prepare(`SELECT e.*, a.user_id AS appUserId FROM hr_employees e
      LEFT JOIN hr_employee_user_assignments a ON a.employee_id = e.id WHERE e.id = ?`).get(input.id);
    if (!previous) throw new Error("Employee not found.");
    const workStart = input.workStart === void 0 ? previous.work_start : input.workStart;
    const workEnd = input.workEnd === void 0 ? previous.work_end : input.workEnd;
    db.prepare(`UPDATE hr_employees SET full_name = ?, phone = ?, email = ?, department_id = ?,
      job_title = ?, hire_date = ?, employment_type = ?, status = ?, basic_salary = 0, hourly_rate = ?,
      work_start = ?, work_end = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL`).run(
      fullName,
      phone,
      email,
      input.departmentId,
      jobTitle,
      input.hireDate,
      input.employmentType,
      input.status,
      input.hourlyRate,
      workStart,
      workEnd,
      input.id
    );
    saveHrEmployeeUserAssignment(db, input.id, input.appUserId);
    audit(db, actorName(actor), "employee", input.id, "updated", previous, input);
    return input.id;
  });
  const id2 = save();
  return db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id2);
}
function saveHrEmployeeUserAssignment(db, employeeId, userId) {
  if (userId === void 0) return;
  if (userId === null) {
    db.prepare("DELETE FROM hr_employee_user_assignments WHERE employee_id = ?").run(employeeId);
    return;
  }
  db.prepare(`INSERT INTO hr_employee_user_assignments(employee_id, user_id) VALUES (?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET user_id = excluded.user_id, assigned_at = CURRENT_TIMESTAMP`).run(employeeId, userId);
}
function getHrEmployeePhotoPath(db, id2) {
  const employee = db.prepare("SELECT photo_path AS photoPath FROM hr_employees WHERE id = ?").get(id2);
  if (!employee) throw new Error("Employee not found.");
  return employee.photoPath;
}
function getHrEmployeeStoredFilePaths(db, id2) {
  if (!Number.isSafeInteger(id2) || id2 <= 0) throw new Error("Invalid employee ID.");
  const employee = db.prepare("SELECT photo_path AS photoPath FROM hr_employees WHERE id = ?").get(id2);
  if (!employee) throw new Error("Employee not found.");
  const documents = db.prepare("SELECT file_path AS filePath FROM hr_employee_documents WHERE employee_id = ?").all(id2);
  return [...new Set([...documents.map(({ filePath }) => filePath), employee.photoPath].filter((path) => Boolean(path)))];
}
function setHrEmployeePhotoPath(db, actor, id2, photoPath) {
  if (!photoPath || photoPath.length > 1e3) throw new Error("Invalid employee photo path.");
  const update = db.transaction(() => {
    const employee = db.prepare("SELECT photo_path AS photoPath FROM hr_employees WHERE id = ?").get(id2);
    if (!employee) throw new Error("Employee not found.");
    db.prepare("UPDATE hr_employees SET photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(photoPath, id2);
    audit(
      db,
      actorName(actor),
      "employee",
      id2,
      "photo updated",
      { hasPhoto: Boolean(employee.photoPath) },
      { hasPhoto: true }
    );
  });
  update();
}
function getHrEmployeeProfileData(db, id2) {
  if (!Number.isSafeInteger(id2) || id2 <= 0) throw new Error("Invalid employee ID.");
  const employee = db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id2);
  if (!employee) throw new Error("Employee not found.");
  const attendance = db.prepare(`SELECT a.id, e.id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, COALESCE(d.name, '') AS departmentName,
    a.attendance_date AS attendanceDate, a.check_in AS checkIn, a.check_out AS checkOut,
    a.status, a.notes FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE a.employee_id = ? ORDER BY a.attendance_date DESC`).all(id2);
  const leaveRequests = db.prepare(`SELECT l.id, e.id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, COALESCE(d.name, '') AS departmentName, l.leave_type AS leaveType,
    l.start_date AS startDate, l.end_date AS endDate, l.total_days AS totalDays, l.reason, l.status,
    l.created_at AS createdAt, l.approved_by AS approvedBy, l.approved_at AS approvedAt
    FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE l.employee_id = ? ORDER BY l.created_at DESC`).all(id2);
  const leaveBalances = db.prepare(`SELECT b.employee_id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, b.leave_type AS leaveType, b.year,
    b.allocated_days AS allocatedDays, b.used_days AS usedDays,
    b.allocated_days - b.used_days AS remainingDays
    FROM hr_leave_balances b JOIN hr_employees e ON e.id = b.employee_id
    WHERE b.employee_id = ? ORDER BY b.year DESC, b.leave_type`).all(id2);
  const payroll = db.prepare(`SELECT r.id, p.month, p.year, p.status AS periodStatus,
    r.hourly_rate AS hourlyRate, r.worked_minutes AS workedMinutes,
    r.basic_salary AS basicSalary, r.total_bonuses AS totalBonuses,
    r.total_allowances AS totalAllowances, r.total_deductions AS totalDeductions,
    r.total_advance_repayments AS totalAdvanceRepayments,
    COALESCE((SELECT SUM(i.amount) FROM hr_payroll_items i
      WHERE i.payroll_record_id = r.id AND i.item_type = 'Other Adjustment'), 0) AS totalOtherAdjustments,
    r.net_salary AS netSalary
    FROM hr_payroll_records r JOIN hr_payroll_periods p ON p.id = r.payroll_period_id
    WHERE r.employee_id = ? ORDER BY p.year DESC, p.month DESC`).all(id2);
  const documents = listHrDocuments(db, id2);
  const activity = db.prepare(`SELECT l.id, l.user_id AS actor, l.entity_type AS entityType,
    l.entity_id AS entityId, l.action, l.created_at AS createdAt
    FROM hr_audit_logs l
    WHERE (l.entity_type = 'employee' AND l.entity_id = ?)
      OR (l.entity_type = 'attendance' AND l.entity_id = ?)
      OR (l.entity_type = 'leave_balance' AND l.entity_id = ?)
      OR (l.entity_type = 'leave' AND l.entity_id IN
        (SELECT id FROM hr_leave_requests WHERE employee_id = ?))
      OR (l.entity_type = 'employee_document' AND l.entity_id IN
        (SELECT id FROM hr_employee_documents WHERE employee_id = ?))
      OR (l.entity_type = 'payroll' AND l.entity_id IN
        (SELECT payroll_period_id FROM hr_payroll_records WHERE employee_id = ?))
      OR (l.entity_type = 'payroll_record' AND l.entity_id IN
        (SELECT id FROM hr_payroll_records WHERE employee_id = ?))
    ORDER BY l.created_at DESC LIMIT 500`).all(id2, id2, id2, id2, id2, id2, id2);
  return { employee, attendance, leaveRequests, leaveBalances, payroll, documents, activity };
}
function archiveHrEmployee(db, actor, id2, archived) {
  const update = db.transaction(() => {
    const employee = db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id2);
    if (!employee) throw new Error("Employee not found.");
    if (archived) {
      if (employee.archivedAt) return;
      db.prepare(`UPDATE hr_employees SET archived_status = status, status = 'Archived',
        archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id2);
    } else {
      if (!employee.archivedAt) return;
      db.prepare(`UPDATE hr_employees SET status = COALESCE(archived_status, 'Active'), archived_status = NULL,
        archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id2);
    }
    const updated = db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id2);
    audit(db, actorName(actor), "employee", id2, archived ? "archived" : "restored", employee, updated);
  });
  update();
}
function deleteHrEmployee(db, actor, id2) {
  if (!Number.isSafeInteger(id2) || id2 <= 0) throw new Error("Invalid employee ID.");
  const remove = db.transaction(() => {
    const employee = db.prepare("SELECT employee_code AS employeeCode, full_name AS fullName, department_id AS departmentId, job_title AS jobTitle, status, archived_at AS archivedAt FROM hr_employees WHERE id = ?").get(id2);
    if (!employee) throw new Error("Employee not found.");
    const filePaths = getHrEmployeeStoredFilePaths(db, id2);
    db.prepare(`DELETE FROM hr_advance_repayments
      WHERE advance_id IN (SELECT id FROM hr_employee_advances WHERE employee_id = ?)
        OR payroll_record_id IN (SELECT id FROM hr_payroll_records WHERE employee_id = ?)`).run(id2, id2);
    db.prepare("DELETE FROM hr_payroll_items WHERE payroll_record_id IN (SELECT id FROM hr_payroll_records WHERE employee_id = ?)").run(id2);
    db.prepare("DELETE FROM hr_employee_advances WHERE employee_id = ?").run(id2);
    db.prepare("DELETE FROM hr_employee_documents WHERE employee_id = ?").run(id2);
    db.prepare("DELETE FROM hr_payroll_records WHERE employee_id = ?").run(id2);
    db.prepare("DELETE FROM hr_leave_requests WHERE employee_id = ?").run(id2);
    db.prepare("DELETE FROM hr_leave_balances WHERE employee_id = ?").run(id2);
    db.prepare("DELETE FROM hr_attendance WHERE employee_id = ?").run(id2);
    db.prepare("DELETE FROM hr_employees WHERE id = ?").run(id2);
    audit(db, actorName(actor), "employee", id2, "deleted", employee);
    return filePaths;
  });
  return remove();
}
function getHrDashboard(db, date) {
  if (!validDate(date)) throw new Error("Invalid dashboard date.");
  const count = (sql, ...args) => Number(db.prepare(sql).get(...args).count);
  const totalEmployees = count("SELECT COUNT(*) AS count FROM hr_employees WHERE archived_at IS NULL");
  const activeEmployees = count("SELECT COUNT(*) AS count FROM hr_employees WHERE archived_at IS NULL AND status = 'Active'");
  const presentToday = count(`SELECT COUNT(*) AS count FROM hr_attendance
    WHERE attendance_date = ? AND status IN ('Present', 'Late', 'Half Day', 'Early Leave')`, date);
  const absentToday = count("SELECT COUNT(*) AS count FROM hr_attendance WHERE attendance_date = ? AND status = 'Absent'", date);
  const onLeaveToday = count(`SELECT COUNT(*) AS count FROM hr_leave_requests
    WHERE status = 'Approved' AND start_date <= ? AND end_date >= ?`, date, date);
  const pendingLeaveRequests = count("SELECT COUNT(*) AS count FROM hr_leave_requests WHERE status = 'Pending'");
  const month = Number(date.slice(5, 7));
  const year = Number(date.slice(0, 4));
  const payroll = db.prepare(`SELECT COALESCE(SUM(r.net_salary), 0) AS total FROM hr_payroll_records r
    JOIN hr_payroll_periods p ON p.id = r.payroll_period_id WHERE p.month = ? AND p.year = ? AND p.status <> 'Cancelled'`).get(month, year);
  return { totalEmployees, activeEmployees, presentToday, absentToday, onLeaveToday, pendingLeaveRequests, currentMonthPayrollTotal: Number(payroll.total) };
}
function listHrAttendance(db, date) {
  if (!validDate(date)) throw new Error("Invalid attendance date.");
  return db.prepare(`SELECT COALESCE(a.id, 0) AS id, e.id AS employeeId, e.employee_code AS employeeCode, e.full_name AS fullName,
    u.display_name AS appUserDisplayName, u.username AS appUsername,
    COALESCE(d.name, '') AS departmentName, COALESCE(a.attendance_date, ?) AS attendanceDate,
    a.check_in AS checkIn, a.check_out AS checkOut, COALESCE(a.status, 'Unmarked') AS status, COALESCE(a.notes, '') AS notes
    FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
    LEFT JOIN hr_attendance a ON a.employee_id = e.id AND a.attendance_date = ?
    LEFT JOIN hr_employee_user_assignments assignment ON assignment.employee_id = e.id
    LEFT JOIN app_users u ON u.id = assignment.user_id
    WHERE e.archived_at IS NULL AND e.status = 'Active' ORDER BY e.full_name COLLATE NOCASE`).all(date, date);
}
function listHrAttendanceCalendar(db, year, month, employeeId) {
  if (!Number.isSafeInteger(year) || year < 2e3 || year > 2200 || !Number.isSafeInteger(month) || month < 1 || month > 12) throw new Error("Invalid attendance calendar month.");
  if (employeeId !== void 0 && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) {
    throw new Error("Invalid attendance employee.");
  }
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
  if (employeeId !== void 0) {
    return db.prepare(`SELECT a.attendance_date AS date, 1 AS total,
      CASE WHEN a.check_in IS NOT NULL THEN 1 ELSE 0 END AS checkedIn,
      CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 1 ELSE 0 END AS checkedOut,
      CASE WHEN a.status = 'Day Off' THEN 1 ELSE 0 END AS dayOffCount,
      a.status, a.check_in AS checkIn, a.check_out AS checkOut
      FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
      WHERE a.employee_id = ? AND a.attendance_date BETWEEN ? AND ?
        AND e.archived_at IS NULL AND e.status = 'Active'
      ORDER BY a.attendance_date`).all(employeeId, start, end);
  }
  return db.prepare(`SELECT attendance_date AS date, COUNT(*) AS total,
    SUM(CASE WHEN check_in IS NOT NULL THEN 1 ELSE 0 END) AS checkedIn,
    SUM(CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL THEN 1 ELSE 0 END) AS checkedOut,
    SUM(CASE WHEN status = 'Day Off' THEN 1 ELSE 0 END) AS dayOffCount
    FROM hr_attendance WHERE attendance_date BETWEEN ? AND ?
    GROUP BY attendance_date ORDER BY attendance_date`).all(start, end);
}
function clockHrAttendance(db, actor, employeeId, action, at = /* @__PURE__ */ new Date()) {
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 || !["in", "out"].includes(action) || Number.isNaN(at.getTime())) {
    throw new Error("Invalid attendance clock action.");
  }
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const time = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const clock = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND archived_at IS NULL AND status = 'Active'").get(employeeId)) {
      throw new Error("Active employee not found.");
    }
    const previous = db.prepare(`SELECT * FROM hr_attendance WHERE employee_id = ? AND attendance_date = ?`).get(employeeId, date);
    const who = actorName(actor);
    if (action === "in") {
      if (previous?.check_in || previous?.check_out) throw new Error("This employee has already checked in today.");
      db.prepare(`INSERT INTO hr_attendance(employee_id, attendance_date, check_in, status, recorded_by, updated_by)
        VALUES (?, ?, ?, 'Present', ?, ?)
        ON CONFLICT(employee_id, attendance_date) DO UPDATE SET check_in = excluded.check_in,
          status = 'Present', updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`).run(employeeId, date, time, who, who);
    } else {
      if (!previous?.check_in) throw new Error("Check in before checking out.");
      if (previous.check_out) throw new Error("This employee has already checked out today.");
      if (time <= previous.check_in) throw new Error("Check-out must be later than check-in. Overnight shifts are not supported.");
      db.prepare(`UPDATE hr_attendance SET check_out = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ? AND attendance_date = ?`).run(time, who, employeeId, date);
    }
    const updated = db.prepare(`SELECT * FROM hr_attendance WHERE employee_id = ? AND attendance_date = ?`).get(employeeId, date);
    audit(db, who, "attendance", employeeId, action === "in" ? "clocked in" : "clocked out", previous, updated);
  });
  clock();
}
function findActiveEmployeeForUser(db, userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Invalid application user.");
  const assignment = db.prepare(`SELECT e.id, e.full_name AS fullName, e.status, e.archived_at AS archivedAt
    FROM hr_employee_user_assignments a JOIN hr_employees e ON e.id = a.employee_id
    WHERE a.user_id = ?`).get(userId);
  if (!assignment) throw new Error("No employee profile is assigned to this application user. Ask an administrator to assign one in Human Resources.");
  if (assignment.archivedAt || assignment.status !== "Active") {
    throw new Error("The employee profile assigned to this application user is not active.");
  }
  return assignment;
}
function getHrSelfAttendanceStatus(db, userId, date) {
  if (!validDate(date)) throw new Error("Invalid attendance date.");
  const employee = findActiveEmployeeForUser(db, userId);
  const record2 = db.prepare(`SELECT check_in AS checkIn, check_out AS checkOut, status FROM hr_attendance
    WHERE employee_id = ? AND attendance_date = ?`).get(employee.id, date);
  return {
    employeeName: employee.fullName,
    attendanceDate: date,
    checkIn: record2?.checkIn ?? null,
    checkOut: record2?.checkOut ?? null,
    shouldPrompt: !record2?.checkIn && record2?.status !== "Day Off"
  };
}
function getHrSelfAttendanceCalendar(db, userId, year, month) {
  const employee = findActiveEmployeeForUser(db, userId);
  return listHrAttendanceCalendar(db, year, month, employee.id);
}
function clockInHrAttendanceForUser(db, userId, actor, at = /* @__PURE__ */ new Date()) {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid attendance clock action.");
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const status = getHrSelfAttendanceStatus(db, userId, date);
  if (!status.shouldPrompt) return status;
  const employee = findActiveEmployeeForUser(db, userId);
  clockHrAttendance(db, actor, employee.id, "in", at);
  return getHrSelfAttendanceStatus(db, userId, date);
}
function clockOutHrAttendanceForUser(db, userId, actor, at = /* @__PURE__ */ new Date()) {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid attendance clock action.");
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const status = getHrSelfAttendanceStatus(db, userId, date);
  if (!status.checkIn) throw new Error("Check in before checking out.");
  if (status.checkOut) throw new Error("This employee has already checked out today.");
  const employee = findActiveEmployeeForUser(db, userId);
  clockHrAttendance(db, actor, employee.id, "out", at);
  return getHrSelfAttendanceStatus(db, userId, date);
}
function timeInMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error("Attendance contains an invalid clock time.");
  return Number(match[1]) * 60 + Number(match[2]);
}
function calculateHrPay(db, employeeId, startDate, endDate) {
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 || !validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error("Select a valid employee and date range.");
  }
  const employee = db.prepare("SELECT full_name AS employeeName, hourly_rate AS hourlyRate FROM hr_employees WHERE id = ?").get(employeeId);
  if (!employee) throw new Error("Employee not found.");
  if (employee.hourlyRate <= 0) throw new Error("Set this employee’s hourly rate before calculating pay.");
  const records = db.prepare(`SELECT check_in AS checkIn, check_out AS checkOut FROM hr_attendance
    WHERE employee_id = ? AND attendance_date BETWEEN ? AND ? AND check_in IS NOT NULL AND check_out IS NOT NULL`).all(employeeId, startDate, endDate);
  const workedMinutes = records.reduce((total, record2) => {
    const duration = timeInMinutes(record2.checkOut) - timeInMinutes(record2.checkIn);
    if (duration <= 0) throw new Error("Attendance contains a check-out that is not later than check-in.");
    return total + duration;
  }, 0);
  const grossPay = Math.round(employee.hourlyRate * workedMinutes / 60);
  if (!Number.isSafeInteger(grossPay)) throw new Error("Calculated pay is outside the supported range.");
  return { employeeId, employeeName: employee.employeeName, hourlyRate: employee.hourlyRate, workedMinutes, grossPay };
}
function saveHrAttendance(db, actor, input) {
  if (!validDate(input.attendanceDate) || !attendanceStatuses.has(input.status) || !validTime(input.checkIn) || !validTime(input.checkOut) || input.checkOut !== null && input.checkIn === null || input.checkIn !== null && input.checkOut !== null && input.checkOut < input.checkIn || typeof input.notes !== "string" || input.notes.length > 1e3) {
    throw new Error("Invalid attendance details. Check-out must not be earlier than check-in.");
  }
  const save = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND archived_at IS NULL AND status = 'Active'").get(input.employeeId)) {
      throw new Error("Active employee not found.");
    }
    const previous = db.prepare("SELECT * FROM hr_attendance WHERE employee_id = ? AND attendance_date = ?").get(input.employeeId, input.attendanceDate);
    db.prepare(`INSERT INTO hr_attendance(employee_id, attendance_date, check_in, check_out, status, notes, recorded_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, attendance_date) DO UPDATE SET check_in = excluded.check_in,
        check_out = excluded.check_out, status = excluded.status, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`).run(input.employeeId, input.attendanceDate, input.checkIn, input.checkOut, input.status, input.notes, actorName(actor), actorName(actor));
    audit(db, actorName(actor), "attendance", input.employeeId, previous ? "updated" : "created", previous, input);
  });
  save();
}
function markAllHrEmployeesPresent(db, actor, date) {
  if (!validDate(date)) throw new Error("Invalid attendance date.");
  const mark = db.transaction(() => {
    const candidates = db.prepare(`SELECT id FROM hr_employees WHERE status = 'Active' AND archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM hr_attendance WHERE employee_id = hr_employees.id AND attendance_date = ?)`).all(date);
    const result = db.prepare(`INSERT OR IGNORE INTO hr_attendance(employee_id, attendance_date, status, recorded_by, updated_by)
      SELECT id, ?, 'Present', ?, ? FROM hr_employees WHERE status = 'Active' AND archived_at IS NULL`).run(date, actorName(actor), actorName(actor));
    for (const candidate of candidates) {
      audit(db, actorName(actor), "attendance", candidate.id, "created", void 0, { date, status: "Present" });
    }
    return result.changes;
  });
  return mark();
}
function listHrLeaveRequests(db, status = "") {
  if (status && !leaveStatuses.has(status)) throw new Error("Invalid leave status.");
  return db.prepare(`SELECT l.id, e.id AS employeeId, e.employee_code AS employeeCode, e.full_name AS fullName,
    COALESCE(d.name, '') AS departmentName, l.leave_type AS leaveType, l.start_date AS startDate,
    l.end_date AS endDate, l.total_days AS totalDays, l.reason, l.status
    FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE (? = '' OR l.status = ?) ORDER BY l.created_at DESC LIMIT 500`).all(status, status);
}
function createHrLeaveRequest(db, actor, input) {
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate || !Number.isFinite(input.totalDays) || input.totalDays <= 0 || input.totalDays > 366 || input.leaveType.trim().length < 2 || input.leaveType.length > 80 || input.reason.length > 2e3) {
    throw new Error("Invalid leave request details.");
  }
  const create = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND archived_at IS NULL AND status = 'Active'").get(input.employeeId)) {
      throw new Error("Active employee not found.");
    }
    const result = db.prepare(`INSERT INTO hr_leave_requests(employee_id, leave_type, start_date, end_date, total_days, reason)
      VALUES (?, ?, ?, ?, ?, ?)`).run(input.employeeId, input.leaveType.trim(), input.startDate, input.endDate, input.totalDays, input.reason.trim());
    audit(db, actorName(actor), "leave", Number(result.lastInsertRowid), "submitted", void 0, input);
  });
  create();
}
function decideHrLeaveRequest(db, actor, id2, status) {
  const decide = db.transaction(() => {
    const request = db.prepare("SELECT * FROM hr_leave_requests WHERE id = ?").get(id2);
    if (!request || request.status !== "Pending") throw new Error("Only pending leave requests can be decided.");
    if (status === "Approved") {
      if (request.start_date.slice(0, 4) !== request.end_date.slice(0, 4)) {
        throw new Error("Split leave requests that cross calendar years so each year can use its configured balance.");
      }
      const overlap = db.prepare(`SELECT 1 FROM hr_leave_requests WHERE employee_id = ? AND id <> ?
        AND status = 'Approved' AND start_date <= ? AND end_date >= ? LIMIT 1`).get(request.employee_id, id2, request.end_date, request.start_date);
      if (overlap) throw new Error("This request overlaps another approved leave.");
      const year = Number(request.start_date.slice(0, 4));
      const balance = db.prepare(`SELECT allocated_days AS allocatedDays, used_days AS usedDays
        FROM hr_leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?`).get(request.employee_id, request.leave_type, year);
      if (balance && balance.usedDays + request.total_days > balance.allocatedDays) {
        throw new Error("The employee does not have enough remaining leave balance.");
      }
      if (balance) db.prepare(`UPDATE hr_leave_balances SET used_days = used_days + ?
        WHERE employee_id = ? AND leave_type = ? AND year = ?`).run(request.total_days, request.employee_id, request.leave_type, year);
    }
    db.prepare("UPDATE hr_leave_requests SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, actorName(actor), id2);
    audit(db, actorName(actor), "leave", id2, status.toLowerCase(), request, { status });
  });
  decide();
}
function listHrLeaveBalances(db, year) {
  if (!Number.isSafeInteger(year) || year < 2e3 || year > 2200) throw new Error("Invalid leave-balance year.");
  return db.prepare(`SELECT b.employee_id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, b.leave_type AS leaveType, b.year,
    b.allocated_days AS allocatedDays, b.used_days AS usedDays,
    b.allocated_days - b.used_days AS remainingDays
    FROM hr_leave_balances b JOIN hr_employees e ON e.id = b.employee_id
    WHERE b.year = ? ORDER BY e.full_name COLLATE NOCASE, b.leave_type`).all(year);
}
function saveHrLeaveBalance(db, actor, input) {
  const leaveType = input.leaveType.trim();
  if (!Number.isSafeInteger(input.employeeId) || input.employeeId <= 0 || !Number.isSafeInteger(input.year) || input.year < 2e3 || input.year > 2200 || !Number.isFinite(input.allocatedDays) || input.allocatedDays < 0 || input.allocatedDays > 366 || leaveType.length < 2 || leaveType.length > 80) throw new Error("Invalid leave-balance details.");
  const save = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ?").get(input.employeeId)) throw new Error("Employee not found.");
    const previous = db.prepare(`SELECT allocated_days AS allocatedDays, used_days AS usedDays
      FROM hr_leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?`).get(input.employeeId, leaveType, input.year);
    if (previous && input.allocatedDays < previous.usedDays) throw new Error("Allocated days cannot be lower than days already used.");
    db.prepare(`INSERT INTO hr_leave_balances(employee_id, leave_type, year, allocated_days, used_days)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(employee_id, leave_type, year) DO UPDATE SET allocated_days = excluded.allocated_days`).run(input.employeeId, leaveType, input.year, input.allocatedDays);
    audit(db, actorName(actor), "leave_balance", input.employeeId, "configured", previous, input);
  });
  save();
}
function listHrDocuments(db, employeeId) {
  if (employeeId !== void 0 && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) throw new Error("Invalid employee ID.");
  return db.prepare(`SELECT d.id, d.employee_id AS employeeId, e.full_name AS employeeName,
    d.document_name AS documentName, d.document_type AS documentType,
    d.issue_date AS issueDate, d.expiration_date AS expirationDate, d.created_at AS uploadedAt
    FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id
    WHERE (? IS NULL OR d.employee_id = ?) ORDER BY d.created_at DESC LIMIT 1000`).all(employeeId ?? null, employeeId ?? null);
}
function addHrDocument(db, actor, input) {
  const documentName2 = input.documentName.trim();
  const documentType = input.documentType.trim();
  const issueDate = input.issueDate?.trim() || null;
  const expirationDate = input.expirationDate?.trim() || null;
  if (!Number.isSafeInteger(input.employeeId) || input.employeeId <= 0 || documentName2.length < 1 || documentName2.length > 200 || documentType.length < 2 || documentType.length > 80 || !input.filePath || input.filePath.length > 1e3 || issueDate !== null && !validDate(issueDate) || expirationDate !== null && !validDate(expirationDate)) throw new Error("Invalid employee document details.");
  const add = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ?").get(input.employeeId)) throw new Error("Employee not found.");
    const result = db.prepare(`INSERT INTO hr_employee_documents(employee_id, document_name, document_type,
      file_path, issue_date, expiration_date, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.employeeId, documentName2, documentType, input.filePath, issueDate, expirationDate, actorName(actor));
    const id22 = Number(result.lastInsertRowid);
    audit(db, actorName(actor), "employee_document", id22, "uploaded", void 0, {
      employeeId: input.employeeId,
      documentName: documentName2,
      documentType,
      issueDate,
      expirationDate
    });
    return id22;
  });
  const id2 = add();
  return db.prepare(`SELECT d.id, d.employee_id AS employeeId, e.full_name AS employeeName,
    d.document_name AS documentName, d.document_type AS documentType,
    d.issue_date AS issueDate, d.expiration_date AS expirationDate, d.created_at AS uploadedAt
    FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id WHERE d.id = ?`).get(id2);
}
function getHrDocumentPath(db, id2) {
  const row = db.prepare("SELECT file_path AS filePath FROM hr_employee_documents WHERE id = ?").get(id2);
  if (!row) throw new Error("Employee document not found.");
  return row.filePath;
}
function validateHrCandidate(input) {
  const candidate = {
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    departmentId: input.departmentId,
    notes: input.notes.trim()
  };
  if (candidate.fullName.length < 2 || candidate.fullName.length > 120 || candidate.phone.length > 50 || candidate.email.length > 200 || candidate.notes.length > 2e3 || !Number.isSafeInteger(candidate.departmentId) || candidate.departmentId <= 0) {
    throw new Error("Invalid candidate details.");
  }
  return candidate;
}
const hrCandidateSelect = `SELECT c.id, c.full_name AS fullName, c.phone, c.email,
  c.department_id AS departmentId, d.name AS departmentName, c.notes,
  c.file_name AS fileName, c.is_starred AS isStarred, c.created_at AS createdAt
  FROM hr_candidates c JOIN hr_departments d ON d.id = c.department_id`;
function listHrCandidates(db) {
  const rows = db.prepare(`${hrCandidateSelect}
    ORDER BY c.department_id, c.is_starred DESC, c.full_name COLLATE NOCASE`).all();
  return rows.map((row) => ({ ...row, isStarred: row.isStarred === 1 }));
}
function purgeHrCandidatesFromDepartments(db, actor) {
  const migrationName = "remove-office-boy-manager-cv-candidates";
  const purge = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM hr_migrations WHERE name = ?").get(migrationName)) return [];
    const candidates = db.prepare(`SELECT c.id, c.full_name AS fullName, c.file_name AS fileName,
      c.file_path AS filePath, d.name AS departmentName
      FROM hr_candidates c JOIN hr_departments d ON d.id = c.department_id
      WHERE lower(trim(d.name)) IN ('office boy', 'manager')`).all();
    for (const candidate of candidates) {
      audit(db, actor, "candidate", candidate.id, "deleted", {
        fullName: candidate.fullName,
        fileName: candidate.fileName,
        departmentName: candidate.departmentName
      });
      db.prepare("DELETE FROM hr_candidates WHERE id = ?").run(candidate.id);
    }
    db.prepare("INSERT INTO hr_migrations(name) VALUES (?)").run(migrationName);
    return candidates.map(({ filePath }) => filePath);
  });
  return purge();
}
function listHrCandidatePathsForDepartmentPurge(db) {
  const migrationName = "remove-office-boy-manager-cv-candidates";
  if (db.prepare("SELECT 1 FROM hr_migrations WHERE name = ?").get(migrationName)) return [];
  return db.prepare(`SELECT c.file_path AS filePath
    FROM hr_candidates c JOIN hr_departments d ON d.id = c.department_id
    WHERE lower(trim(d.name)) IN ('office boy', 'manager')`).all().map(({ filePath }) => filePath);
}
function addHrCandidate(db, actor, input, fileName, filePath) {
  const candidate = validateHrCandidate(input);
  const name2 = fileName.trim();
  if (!name2 || name2.length > 255 || !filePath || filePath.length > 1e3) throw new Error("Invalid candidate file.");
  const add = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_departments WHERE id = ?").get(candidate.departmentId)) {
      throw new Error("Department not found.");
    }
    const result = db.prepare(`INSERT INTO hr_candidates(
      full_name, phone, email, department_id, notes, file_name, file_path, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      candidate.fullName,
      candidate.phone,
      candidate.email,
      candidate.departmentId,
      candidate.notes,
      name2,
      filePath,
      actorName(actor)
    );
    const id22 = Number(result.lastInsertRowid);
    audit(db, actor, "candidate", id22, "created", void 0, { ...candidate, fileName: name2 });
    return id22;
  });
  const id2 = add();
  return listHrCandidateById(db, id2);
}
function listHrCandidateById(db, id2) {
  const row = db.prepare(`${hrCandidateSelect} WHERE c.id = ?`).get(id2);
  if (!row) throw new Error("Candidate not found.");
  return { ...row, isStarred: row.isStarred === 1 };
}
function updateHrCandidate(db, actor, input) {
  if (!Number.isSafeInteger(input.id) || input.id <= 0) throw new Error("Invalid candidate ID.");
  const candidate = validateHrCandidate(input);
  const update = db.transaction(() => {
    const previous = db.prepare(`SELECT full_name AS fullName, phone, email,
      department_id AS departmentId, notes FROM hr_candidates WHERE id = ?`).get(input.id);
    if (!previous) throw new Error("Candidate not found.");
    if (!db.prepare("SELECT 1 FROM hr_departments WHERE id = ?").get(candidate.departmentId)) {
      throw new Error("Department not found.");
    }
    db.prepare(`UPDATE hr_candidates SET full_name = ?, phone = ?, email = ?,
      department_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(candidate.fullName, candidate.phone, candidate.email, candidate.departmentId, candidate.notes, input.id);
    audit(db, actor, "candidate", input.id, "updated", previous, candidate);
  });
  update();
  return listHrCandidateById(db, input.id);
}
function setHrCandidateStarred(db, actor, id2, starred) {
  if (!Number.isSafeInteger(id2) || id2 <= 0 || typeof starred !== "boolean") throw new Error("Invalid candidate star setting.");
  const update = db.transaction(() => {
    const previous = db.prepare("SELECT is_starred AS isStarred FROM hr_candidates WHERE id = ?").get(id2);
    if (!previous) throw new Error("Candidate not found.");
    if (previous.isStarred === 1 === starred) return;
    db.prepare("UPDATE hr_candidates SET is_starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(Number(starred), id2);
    audit(db, actor, "candidate", id2, starred ? "starred" : "unstarred", previous, { isStarred: Number(starred) });
  });
  update();
}
function getHrCandidateFilePath(db, id2) {
  if (!Number.isSafeInteger(id2) || id2 <= 0) throw new Error("Invalid candidate ID.");
  const row = db.prepare("SELECT file_path AS filePath FROM hr_candidates WHERE id = ?").get(id2);
  if (!row) throw new Error("Candidate not found.");
  return row.filePath;
}
function listHrPayrollPeriods(db) {
  return db.prepare(`SELECT p.id, p.month, p.year, p.status,
    COUNT(r.id) AS employeeCount, COALESCE(SUM(r.net_salary), 0) AS totalNet
    FROM hr_payroll_periods p LEFT JOIN hr_payroll_records r ON r.payroll_period_id = p.id
    GROUP BY p.id ORDER BY p.year DESC, p.month DESC LIMIT 100`).all();
}
function listHrPayrollRecords(db, periodId) {
  if (!Number.isSafeInteger(periodId) || periodId <= 0) throw new Error("Invalid payroll period.");
  return db.prepare(`SELECT r.id, e.id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, COALESCE(d.name, '') AS departmentName, r.basic_salary AS basicSalary,
    r.hourly_rate AS hourlyRate, r.worked_minutes AS workedMinutes,
    r.total_bonuses AS totalBonuses, r.total_allowances AS totalAllowances,
    r.total_deductions AS totalDeductions, r.total_advance_repayments AS totalAdvanceRepayments,
    COALESCE((SELECT SUM(i.amount) FROM hr_payroll_items i
      WHERE i.payroll_record_id = r.id AND i.item_type = 'Other Adjustment'), 0) AS totalOtherAdjustments,
    r.net_salary AS netSalary FROM hr_payroll_records r
    JOIN hr_employees e ON e.id = r.employee_id LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE r.payroll_period_id = ? ORDER BY e.full_name COLLATE NOCASE`).all(periodId);
}
function addHrPayrollItem(db, actor, recordId, input) {
  const itemTypes = /* @__PURE__ */ new Set(["Bonus", "Allowance", "Deduction", "Advance Repayment", "Other Adjustment"]);
  const description = input.description.trim();
  const validAmount = Number.isSafeInteger(input.amount) && (input.itemType === "Other Adjustment" ? input.amount !== 0 : input.amount > 0);
  if (!Number.isSafeInteger(recordId) || recordId <= 0 || !itemTypes.has(input.itemType) || description.length < 2 || description.length > 200 || !validAmount) {
    throw new Error("Invalid payroll item details.");
  }
  const add = db.transaction(() => {
    const record2 = db.prepare(`SELECT r.*, p.status AS period_status FROM hr_payroll_records r
      JOIN hr_payroll_periods p ON p.id = r.payroll_period_id WHERE r.id = ?`).get(recordId);
    if (!record2 || record2.period_status !== "Draft") throw new Error("Payroll items can only be changed in draft payroll.");
    const bonus = record2.total_bonuses + (input.itemType === "Bonus" ? input.amount : 0);
    const allowance = record2.total_allowances + (input.itemType === "Allowance" ? input.amount : 0);
    const deduction = record2.total_deductions + (input.itemType === "Deduction" ? input.amount : 0);
    const advanceRepayment = record2.total_advance_repayments + (input.itemType === "Advance Repayment" ? input.amount : 0);
    const otherAdjustment = Number(db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM hr_payroll_items
      WHERE payroll_record_id = ? AND item_type = 'Other Adjustment'`).get(recordId).total) + (input.itemType === "Other Adjustment" ? input.amount : 0);
    const netSalary = record2.basic_salary + bonus + allowance - deduction - advanceRepayment + otherAdjustment;
    if (!Number.isSafeInteger(netSalary) || netSalary < 0) throw new Error("Payroll item would make net salary invalid.");
    db.prepare(`INSERT INTO hr_payroll_items(payroll_record_id, item_type, description, amount, created_by)
      VALUES (?, ?, ?, ?, ?)`).run(recordId, input.itemType, description, input.amount, actorName(actor));
    db.prepare(`UPDATE hr_payroll_records SET total_bonuses = ?, total_allowances = ?,
      total_deductions = ?, total_advance_repayments = ?, net_salary = ? WHERE id = ?`).run(bonus, allowance, deduction, advanceRepayment, netSalary, recordId);
    audit(db, actorName(actor), "payroll_record", recordId, "item added", void 0, input);
  });
  add();
}
function generateHrPayroll(db, actor, month, year) {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(year) || year < 2e3 || year > 2200) {
    throw new Error("Select a valid payroll month and year.");
  }
  const generate = db.transaction(() => {
    if (db.prepare("SELECT 1 FROM hr_payroll_periods WHERE month = ? AND year = ?").get(month, year)) {
      throw new Error("A payroll period already exists for that month.");
    }
    const employees = db.prepare(`SELECT id, hourly_rate AS hourlyRate FROM hr_employees
      WHERE status = 'Active' AND archived_at IS NULL ORDER BY id`).all();
    if (employees.length === 0) throw new Error("No active employees are eligible for payroll.");
    if (employees.some((employee) => employee.hourlyRate <= 0)) throw new Error("Set an hourly rate for every active employee before generating payroll.");
    const result = db.prepare("INSERT INTO hr_payroll_periods(month, year, created_by) VALUES (?, ?, ?)").run(month, year, actorName(actor));
    const periodId = Number(result.lastInsertRowid);
    const insert = db.prepare(`INSERT INTO hr_payroll_records(employee_id, payroll_period_id, basic_salary, hourly_rate,
      worked_minutes, net_salary) VALUES (?, ?, ?, ?, ?, ?)`);
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
    for (const employee of employees) {
      const calculation = calculateHrPay(db, employee.id, startDate, endDate);
      insert.run(employee.id, periodId, calculation.grossPay, employee.hourlyRate, calculation.workedMinutes, calculation.grossPay);
    }
    audit(db, actorName(actor), "payroll", periodId, "generated", void 0, { month, year });
  });
  generate();
}
function approveHrPayroll(db, actor, id2) {
  const approve = db.transaction(() => {
    const period = db.prepare("SELECT status FROM hr_payroll_periods WHERE id = ?").get(id2);
    if (!period || period.status !== "Draft") throw new Error("Only draft payroll can be approved.");
    db.prepare("UPDATE hr_payroll_periods SET status = 'Approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?").run(actorName(actor), id2);
    audit(db, actorName(actor), "payroll", id2, "approved", period, { status: "Approved" });
  });
  approve();
}
function markHrPayrollPaid(db, actor, id2) {
  const markPaid = db.transaction(() => {
    const period = db.prepare("SELECT status FROM hr_payroll_periods WHERE id = ?").get(id2);
    if (!period || period.status !== "Approved") throw new Error("Only approved payroll can be marked paid.");
    db.prepare("UPDATE hr_payroll_records SET payment_status = 'Paid', paid_at = CURRENT_TIMESTAMP WHERE payroll_period_id = ?").run(id2);
    db.prepare("UPDATE hr_payroll_periods SET status = 'Paid' WHERE id = ?").run(id2);
    audit(db, actorName(actor), "payroll", id2, "marked paid", period, { status: "Paid" });
  });
  markPaid();
}
function buildHrCsvReport(db, type) {
  const reports = {
    employees: {
      columns: ["Employee ID", "Full Name", "Department", "Job Title", "Phone", "Email", "Hire Date", "Employment Type", "Status", "Hourly Rate IQD"],
      sql: `SELECT e.employee_code, e.full_name, COALESCE(d.name, ''), e.job_title, e.phone, e.email,
        e.hire_date, e.employment_type, e.status, e.hourly_rate
        FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
        ORDER BY e.full_name COLLATE NOCASE`
    },
    attendance: {
      columns: ["Date", "Name", "Check In", "Check Out", "Overtime (minutes)", "Deduction (minutes)"],
      sql: `SELECT a.attendance_date, e.full_name, a.check_in, a.check_out, e.work_start, e.work_end
        FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
        ORDER BY a.attendance_date DESC, e.full_name COLLATE NOCASE`,
      transform: ([date, name2, checkIn, checkOut, workStart, workEnd]) => [
        date,
        name2,
        checkIn,
        checkOut,
        typeof checkIn === "string" && typeof checkOut === "string" && typeof workStart === "string" && typeof workEnd === "string" ? Math.max(0, timeInMinutes(checkOut) - timeInMinutes(workEnd)) : "",
        typeof checkIn === "string" && typeof workStart === "string" ? Math.max(0, timeInMinutes(checkIn) - timeInMinutes(workStart)) : ""
      ]
    },
    leaves: {
      columns: ["Employee ID", "Employee", "Department", "Leave Type", "Start Date", "End Date", "Days", "Reason", "Status", "Approved By"],
      sql: `SELECT e.employee_code, e.full_name, COALESCE(d.name, ''), l.leave_type, l.start_date,
        l.end_date, l.total_days, l.reason, l.status, COALESCE(l.approved_by, '')
        FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
        LEFT JOIN hr_departments d ON d.id = e.department_id ORDER BY l.created_at DESC`
    },
    payroll: {
      columns: ["Year", "Month", "Status", "Employees", "Net Payroll IQD", "Created By", "Approved By"],
      sql: `SELECT p.year, p.month, p.status, COUNT(r.id), COALESCE(SUM(r.net_salary), 0),
        p.created_by, COALESCE(p.approved_by, '')
        FROM hr_payroll_periods p LEFT JOIN hr_payroll_records r ON r.payroll_period_id = p.id
        GROUP BY p.id ORDER BY p.year DESC, p.month DESC`
    },
    documents: {
      columns: ["Employee", "Document Name", "Document Type", "Issue Date", "Expiration Date", "Uploaded By", "Uploaded At"],
      sql: `SELECT e.full_name, d.document_name, d.document_type, d.issue_date, d.expiration_date,
        d.uploaded_by, d.created_at FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id
        ORDER BY d.expiration_date, e.full_name COLLATE NOCASE`
    },
    activity: {
      columns: ["Date", "User", "Entity", "Record ID", "Action", "Old Values", "New Values"],
      sql: `SELECT created_at, user_id, entity_type, entity_id, action, old_values, new_values
        FROM hr_audit_logs ORDER BY created_at DESC LIMIT 10000`
    }
  };
  const report = reports[type];
  if (!report) throw new Error("Unsupported HR report.");
  const sourceRows = db.prepare(report.sql).raw().all();
  const rows = report.transform ? sourceRows.map(report.transform) : sourceRows;
  const escape = (value) => {
    let text2 = String(value ?? "");
    if (/^[\t\r ]*[=+\-@]/.test(text2)) text2 = `'${text2}`;
    return `"${text2.replace(/"/g, '""')}"`;
  };
  return `\uFEFF${[report.columns, ...rows].map((row) => row.map(escape).join(",")).join("\r\n")}`;
}
const today = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
function initializeDatabase(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '', nationality TEXT NOT NULL DEFAULT '',
      passport_number TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS customers_passport_unique
      ON customers(passport_number) WHERE passport_number <> '';
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY, application_id TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      country TEXT NOT NULL, visa_type TEXT NOT NULL, status TEXT NOT NULL REFERENCES pipeline_stages(name),
      employee TEXT NOT NULL DEFAULT '', application_date TEXT NOT NULL,
      follow_up_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
    CREATE INDEX IF NOT EXISTS applications_follow_up_idx ON applications(follow_up_date);
    CREATE TABLE IF NOT EXISTS application_activities (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id),
      activity_type TEXT NOT NULL, description TEXT NOT NULL,
      previous_value TEXT, new_value TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL DEFAULT 'Blue Line Team'
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id),
      category TEXT NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `);
  migrateDatabase(db);
  initializeAuthDatabase(db);
  initializeHrDatabase(db);
  const insertStage = db.prepare("INSERT OR IGNORE INTO pipeline_stages(name, sort_order) VALUES (?, ?)");
  STAGES.forEach((stage, index) => insertStage.run(stage, index));
  db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('companyName', 'Blue Line Travel')").run();
  db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('language', 'en')").run();
  db.prepare("INSERT OR IGNORE INTO pipelines(id, name, sort_order) VALUES (1, ?, 0)").run("Visa Applications");
  db.prepare(`INSERT OR IGNORE INTO pipeline_stage_definitions(pipeline_id, name, sort_order)
    SELECT 1, name, sort_order FROM pipeline_stages ORDER BY sort_order`).run();
  db.exec(`INSERT OR IGNORE INTO visa_types(name, active)
    SELECT DISTINCT trim(visa_type), 1 FROM applications WHERE trim(visa_type) <> '';
    INSERT OR IGNORE INTO countries(name, active)
    SELECT DISTINCT trim(country), 1 FROM applications WHERE trim(country) <> '';`);
  db.pragma("user_version = 3");
  return db;
}
function migrateDatabase(db) {
  const addColumn = (table, column, declaration) => {
    const columns = db.pragma(`table_info(${table})`);
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  };
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS pipeline_stage_definitions (
        id INTEGER PRIMARY KEY, pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(pipeline_id, name)
      );
      CREATE TABLE IF NOT EXISTS visa_types (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS countries (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS customer_documents (
        id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        application_record_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL, file_path TEXT NOT NULL, document_type TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, legacy_document_id INTEGER UNIQUE
      );
      CREATE INDEX IF NOT EXISTS customer_documents_customer_idx ON customer_documents(customer_id, uploaded_at);
      CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(full_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);
    `);
    for (const [column, declaration] of [
      ["date_of_birth", "TEXT NOT NULL DEFAULT ''"],
      ["gender", "TEXT NOT NULL DEFAULT ''"],
      ["address", "TEXT NOT NULL DEFAULT ''"],
      ["passport_issue_date", "TEXT NOT NULL DEFAULT ''"],
      ["passport_expiry_date", "TEXT NOT NULL DEFAULT ''"],
      ["photo_path", "TEXT NOT NULL DEFAULT ''"]
    ]) addColumn("customers", column, declaration);
    addColumn("applications", "pipeline_id", "INTEGER NOT NULL DEFAULT 1");
    addColumn("applications", "deleted_at", "TEXT");
    addColumn("application_activities", "created_by", "TEXT NOT NULL DEFAULT 'Blue Line Team'");
    addColumn("customer_documents", "legacy_document_id", "INTEGER");
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS customer_documents_legacy_idx
      ON customer_documents(legacy_document_id) WHERE legacy_document_id IS NOT NULL;
      INSERT OR IGNORE INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type, uploaded_at, legacy_document_id)
        SELECT a.customer_id, d.application_id, d.file_name, d.file_path, d.category, d.added_at, d.id
        FROM documents d JOIN applications a ON a.id = d.application_id;
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS applications_pipeline_idx ON applications(pipeline_id);
      CREATE INDEX IF NOT EXISTS customers_passport_search_idx ON customers(upper(passport_number));`);
  });
  migrate();
}
function openDatabase(filePath) {
  node_fs.mkdirSync(node_path.dirname(filePath), { recursive: true });
  return initializeDatabase(new Database(filePath));
}
function mapApplication(row) {
  return {
    id: Number(row.id),
    applicationId: String(row.application_id),
    customerId: Number(row.customer_id),
    customerName: String(row.customer_name),
    phone: String(row.phone),
    country: String(row.country),
    visaType: String(row.visa_type),
    status: String(row.status),
    employee: String(row.employee),
    applicationDate: String(row.application_date),
    followUpDate: row.follow_up_date ? String(row.follow_up_date) : null,
    pipelineId: Number(row.pipeline_id ?? 1),
    updatedAt: String(row.updated_at)
  };
}
const appSelect = `
  SELECT a.*, c.full_name AS customer_name, c.phone FROM applications a
  JOIN customers c ON c.id = a.customer_id`;
function assertPassportAvailable(db, passportNumber, exceptCustomerId) {
  if (!passportNumber) return;
  const existing = db.prepare(`SELECT id FROM customers
    WHERE upper(passport_number) = ? AND (? IS NULL OR id <> ?) LIMIT 1`).get(passportNumber, exceptCustomerId ?? null, exceptCustomerId ?? null);
  if (existing) throw new Error("That passport number is already assigned to another customer.");
}
function listApplications(db) {
  return db.prepare(`${appSelect} WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC`).all().map(mapApplication);
}
function getDashboard(db) {
  const total = Number(db.prepare("SELECT COUNT(*) AS count FROM applications WHERE deleted_at IS NULL").get().count);
  const statuses = db.prepare("SELECT status, COUNT(*) AS count FROM applications WHERE deleted_at IS NULL GROUP BY status").all();
  const byStatus = Object.fromEntries(statuses.map((row) => [row.status, Number(row.count)]));
  const overdue = Number(db.prepare("SELECT COUNT(*) AS count FROM applications WHERE deleted_at IS NULL AND follow_up_date < ? AND status NOT IN ('Approved', 'Rejected', 'Passport Returned / Closed')").get(today()).count);
  const recent = db.prepare(`${appSelect} WHERE a.deleted_at IS NULL ORDER BY a.updated_at DESC LIMIT 6`).all().map(mapApplication);
  const countries = db.prepare("SELECT country, COUNT(*) AS count FROM applications WHERE deleted_at IS NULL GROUP BY country ORDER BY count DESC LIMIT 6").all();
  return { total, byStatus, overdue, recent, countries };
}
function createApplication(db, input, passportStoragePath) {
  const stringFields = [
    "fullName",
    "phone",
    "email",
    "nationality",
    "passportNumber",
    "country",
    "visaType",
    "employee",
    "followUpDate",
    "dateOfBirth",
    "gender",
    "address",
    "passportIssueDate",
    "passportExpiryDate"
  ];
  for (const field of stringFields) {
    if (input[field] !== void 0 && typeof input[field] !== "string") throw new Error(`Invalid ${field} value.`);
  }
  const fullName = input.fullName.trim();
  const phone = input.phone?.trim() ?? "";
  const country = input.country.trim();
  const visaType = input.visaType.trim();
  if (!fullName || !country || !visaType) throw new Error("Name, country, and visa type are required.");
  const pipelineId = input.pipelineId === void 0 ? 1 : Number(input.pipelineId);
  if (!Number.isSafeInteger(pipelineId) || !db.prepare("SELECT 1 FROM pipelines WHERE id = ?").get(pipelineId)) throw new Error("Invalid pipeline.");
  const create = db.transaction(() => {
    const passportNumber = input.passportNumber?.trim().toUpperCase() ?? "";
    let customer = passportNumber ? db.prepare("SELECT id FROM customers WHERE upper(passport_number) = ?").get(passportNumber) : void 0;
    if (!customer && phone) {
      customer = db.prepare(`SELECT id FROM customers WHERE lower(full_name) = lower(?) AND phone = ? LIMIT 1`).get(fullName, phone);
    }
    if (!customer) {
      const result2 = db.prepare(`INSERT INTO customers
        (full_name, phone, email,                 nationality, passport_number, date_of_birth, gender, address, passport_issue_date, passport_expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        fullName,
        phone,
        input.email?.trim() ?? "",
        input.nationality?.trim() ?? "",
        passportNumber,
        input.dateOfBirth?.trim() ?? "",
        input.gender?.trim() ?? "",
        input.address?.trim() ?? "",
        input.passportIssueDate?.trim() ?? "",
        input.passportExpiryDate?.trim() ?? ""
      );
      customer = { id: Number(result2.lastInsertRowid) };
    } else {
      db.prepare(`UPDATE customers SET
        full_name = ?, phone = CASE WHEN ? <> '' THEN ? ELSE phone END, email = CASE WHEN ? <> '' THEN ? ELSE email END,
        nationality = CASE WHEN ? <> '' THEN ? ELSE nationality END,
        passport_number = CASE WHEN ? <> '' THEN ? ELSE passport_number END,
        date_of_birth = CASE WHEN ? <> '' THEN ? ELSE date_of_birth END,
        gender = CASE WHEN ? <> '' THEN ? ELSE gender END,
        address = CASE WHEN ? <> '' THEN ? ELSE address END,
        passport_issue_date = CASE WHEN ? <> '' THEN ? ELSE passport_issue_date END,
        passport_expiry_date = CASE WHEN ? <> '' THEN ? ELSE passport_expiry_date END
        WHERE id = ?`).run(
        fullName,
        phone,
        phone,
        input.email?.trim() ?? "",
        input.email?.trim() ?? "",
        input.nationality?.trim() ?? "",
        input.nationality?.trim() ?? "",
        passportNumber,
        passportNumber,
        input.dateOfBirth?.trim() ?? "",
        input.dateOfBirth?.trim() ?? "",
        input.gender?.trim() ?? "",
        input.gender?.trim() ?? "",
        input.address?.trim() ?? "",
        input.address?.trim() ?? "",
        input.passportIssueDate?.trim() ?? "",
        input.passportIssueDate?.trim() ?? "",
        input.passportExpiryDate?.trim() ?? "",
        input.passportExpiryDate?.trim() ?? "",
        customer.id
      );
    }
    if (passportStoragePath) {
      db.prepare(`INSERT INTO customer_documents(customer_id, file_name, file_path, document_type)
        VALUES (?, ?, ?, 'Passport image')`).run(customer.id, node_path.basename(passportStoragePath), passportStoragePath);
    }
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const seq = Number(db.prepare("SELECT COALESCE(MAX(CAST(substr(application_id, 9) AS INTEGER)), 0) AS n FROM applications WHERE application_id LIKE ?").get(`BL-${year}-%`).n) + 1;
    const applicationId = `BL-${year}-${String(seq).padStart(4, "0")}`;
    const firstStage = db.prepare(`SELECT name FROM pipeline_stage_definitions
      WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order, id LIMIT 1`).get(pipelineId);
    if (!firstStage) throw new Error("The selected pipeline has no active stages.");
    const result = db.prepare(`INSERT INTO applications
      (application_id, customer_id, country, visa_type, status, employee, application_date, follow_up_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      applicationId,
      customer.id,
      country,
      visaType,
      firstStage.name,
      input.employee.trim(),
      today(),
      input.followUpDate || null
    );
    db.prepare("UPDATE applications SET pipeline_id = ? WHERE id = ?").run(pipelineId, Number(result.lastInsertRowid));
    const id2 = Number(result.lastInsertRowid);
    db.prepare(`INSERT INTO application_activities(application_id, activity_type, description, new_value)
      VALUES (?, 'Application Created', 'Application created', ?)`).run(id2, applicationId);
    return id2;
  });
  return mapApplication(db.prepare(`${appSelect} WHERE a.id = ?`).get(create()));
}
function moveApplication(db, id2, status) {
  const transition = db.transaction(() => {
    const row = db.prepare("SELECT status, pipeline_id FROM applications WHERE id = ? AND deleted_at IS NULL").get(id2);
    if (!row) throw new Error("Application not found.");
    if (!db.prepare("SELECT 1 FROM pipeline_stage_definitions WHERE pipeline_id = ? AND name = ? AND active = 1").get(row.pipeline_id, status)) throw new Error("Invalid pipeline stage.");
    if (row.status === status) return;
    db.prepare("UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id2);
    db.prepare(`INSERT INTO application_activities(application_id, activity_type, description, previous_value, new_value)
      VALUES (?, 'Status Changed', ?, ?, ?)`).run(id2, `Status changed from ${row.status} to ${status}`, row.status, status);
  });
  transition();
}
function listCustomers(db, search = "") {
  const term = `%${search.trim()}%`;
  return db.prepare(`SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.nationality,
      c.passport_number AS passportNumber, c.created_at AS createdAt,
      c.date_of_birth AS dateOfBirth, c.gender, c.address,
      c.passport_issue_date AS passportIssueDate, c.passport_expiry_date AS passportExpiryDate,
        (SELECT COUNT(*) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS applications,
        (SELECT max(application_date) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS lastApplicationDate
      FROM customers c WHERE upper(c.passport_number) = upper(?) OR c.full_name LIKE ? OR c.phone LIKE ? OR c.passport_number LIKE ? OR c.email LIKE ?
      ORDER BY CASE WHEN upper(c.passport_number) = upper(?) THEN 0 ELSE 1 END, c.created_at DESC LIMIT 500`).all(search.trim(), term, term, term, term, search.trim());
}
function getCustomerProfile(db, id2) {
  const row = db.prepare(`SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.nationality,
      c.passport_number AS passportNumber, c.created_at AS createdAt,
      c.date_of_birth AS dateOfBirth, c.gender, c.address,
      c.passport_issue_date AS passportIssueDate, c.passport_expiry_date AS passportExpiryDate,
      (SELECT COUNT(*) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS applications,
      (SELECT max(application_date) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS lastApplicationDate
    FROM customers c WHERE c.id = ?`).get(id2);
  if (!row) throw new Error("Customer not found.");
  const applications = db.prepare(`${appSelect} WHERE a.customer_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`).all(id2).map(mapApplication);
  const documents = db.prepare(`SELECT cd.id, a.application_id AS applicationId, cd.document_type AS category,
      cd.file_name AS fileName, cd.uploaded_at AS addedAt, cd.application_record_id AS applicationRecordId, 'customer' AS storage
    FROM customer_documents cd LEFT JOIN applications a ON a.id = cd.application_record_id
    WHERE cd.customer_id = ?
    ORDER BY addedAt DESC`).all(id2);
  const activities = db.prepare(`SELECT activity.id, a.application_id AS applicationId,
      activity.activity_type AS activityType, activity.description,
      activity.previous_value AS previousValue, activity.new_value AS newValue,
      activity.created_by AS createdBy, activity.created_at AS createdAt
    FROM application_activities activity
    JOIN applications a ON a.id = activity.application_id
    WHERE a.customer_id = ? AND a.deleted_at IS NULL
    ORDER BY activity.created_at DESC, activity.id DESC`).all(id2);
  return { customer: row, applications, documents, activities };
}
function listAllDocuments(db) {
  return db.prepare(`SELECT * FROM (
      SELECT d.id, a.application_id AS applicationId, d.category, d.file_name AS fileName,
        d.added_at AS addedAt, c.full_name AS customerName, 'application' AS storage
      FROM documents d JOIN applications a ON a.id = d.application_id
      JOIN customers c ON c.id = a.customer_id
      WHERE a.deleted_at IS NULL
      UNION ALL
      SELECT cd.id, a.application_id AS applicationId, cd.document_type AS category,
        cd.file_name AS fileName, cd.uploaded_at AS addedAt, c.full_name AS customerName, 'customer' AS storage
      FROM customer_documents cd JOIN customers c ON c.id = cd.customer_id
      LEFT JOIN applications a ON a.id = cd.application_record_id AND a.deleted_at IS NULL
      WHERE cd.legacy_document_id IS NULL
    ) ORDER BY addedAt DESC, id DESC`).all();
}
function listApplicationActivities(db, id2) {
  if (!db.prepare("SELECT 1 FROM applications WHERE id = ? AND deleted_at IS NULL").get(id2)) throw new Error("Application not found.");
  return db.prepare(`SELECT activity.id, a.application_id AS applicationId,
      activity.activity_type AS activityType, activity.description,
      activity.previous_value AS previousValue, activity.new_value AS newValue,
      activity.created_by AS createdBy, activity.created_at AS createdAt
    FROM application_activities activity
    JOIN applications a ON a.id = activity.application_id
    WHERE activity.application_id = ?
    ORDER BY activity.created_at DESC, activity.id DESC`).all(id2);
}
function addApplicationActivity(db, id2, input) {
  const allowedTypes = /* @__PURE__ */ new Set(["Internal Note", "Customer Call", "Customer Message", "Follow-up"]);
  const description = input.description.trim();
  if (!allowedTypes.has(input.activityType) || !description || description.length > 2e3) {
    throw new Error("Activity type and a description of 1–2,000 characters are required.");
  }
  const result = db.prepare(`INSERT INTO application_activities(application_id, activity_type, description, created_by)
    SELECT id, ?, ?, 'Blue Line Team' FROM applications WHERE id = ? AND deleted_at IS NULL`).run(input.activityType, description, id2);
  if (result.changes === 0) throw new Error("Application not found.");
}
function getCustomerPhotoPath(db, id2) {
  const row = db.prepare("SELECT photo_path FROM customers WHERE id = ?").get(id2);
  if (!row) throw new Error("Customer not found.");
  return row.photo_path;
}
function setCustomerPhotoPath(db, id2, path) {
  const result = db.prepare("UPDATE customers SET photo_path = ? WHERE id = ?").run(path, id2);
  if (result.changes === 0) throw new Error("Customer not found.");
}
function updateCustomer(db, id2, input) {
  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  const passportNumber = input.passportNumber.trim().toUpperCase();
  if (!fullName || !phone) throw new Error("Customer name and phone are required.");
  const update = db.transaction(() => {
    assertPassportAvailable(db, passportNumber, id2);
    const result = db.prepare(`UPDATE customers SET full_name = ?, passport_number = ?, date_of_birth = ?,
      nationality = ?, gender = ?, phone = ?, email = ?, address = ?,
      passport_issue_date = ?, passport_expiry_date = ? WHERE id = ?`).run(
      fullName,
      passportNumber,
      input.dateOfBirth?.trim() ?? "",
      input.nationality?.trim() ?? "",
      input.gender?.trim() ?? "",
      phone,
      input.email.trim(),
      input.address?.trim() ?? "",
      input.passportIssueDate?.trim() ?? "",
      input.passportExpiryDate?.trim() ?? "",
      id2
    );
    if (result.changes === 0) throw new Error("Customer not found.");
  });
  update();
}
function updateApplication(db, id2, input) {
  const fullName = input.fullName.trim();
  const phone = input.phone?.trim() ?? "";
  const country = input.country.trim();
  const visaType = input.visaType.trim();
  if (!fullName || !phone || !country || !visaType) throw new Error("Name, phone, country, and visa type are required.");
  const update = db.transaction(() => {
    const application = db.prepare("SELECT customer_id FROM applications WHERE id = ? AND deleted_at IS NULL").get(id2);
    if (!application) throw new Error("Application not found.");
    const passportNumber = input.passportNumber?.trim().toUpperCase() ?? "";
    if (passportNumber) assertPassportAvailable(db, passportNumber, application.customer_id);
    db.prepare(`UPDATE customers SET full_name = ?, phone = ?,
      email = CASE WHEN ? <> '' THEN ? ELSE email END,
      nationality = CASE WHEN ? <> '' THEN ? ELSE nationality END,
      passport_number = CASE WHEN ? <> '' THEN ? ELSE passport_number END
      WHERE id = ?`).run(
      fullName,
      phone,
      input.email?.trim() ?? "",
      input.email?.trim() ?? "",
      input.nationality?.trim() ?? "",
      input.nationality?.trim() ?? "",
      passportNumber,
      passportNumber,
      application.customer_id
    );
    db.prepare(`UPDATE applications SET country = ?, visa_type = ?, employee = ?,
      follow_up_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      country,
      visaType,
      input.employee.trim(),
      input.followUpDate || null,
      id2
    );
    db.prepare(`INSERT INTO application_activities(application_id, activity_type, description)
      VALUES (?, 'Application Updated', 'Application details updated')`).run(id2);
  });
  update();
}
function deleteApplication(db, id2) {
  const result = db.prepare(`UPDATE applications SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL`).run(id2);
  if (result.changes === 0) throw new Error("Application not found.");
}
function listPipelines(db) {
  return db.prepare(`SELECT p.id, p.name, p.sort_order AS sortOrder,
      (SELECT COUNT(*) FROM applications a WHERE a.pipeline_id = p.id AND a.deleted_at IS NULL) AS applications
    FROM pipelines p ORDER BY p.sort_order, p.id`).all().map((pipeline2) => ({
    ...pipeline2,
    stages: db.prepare(`SELECT name FROM pipeline_stage_definitions
        WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order, id`).all(pipeline2.id).map((stage) => stage.name)
  }));
}
function savePipeline(db, input) {
  const name2 = input.name.trim();
  const stages = input.stages.map((stage) => stage.trim());
  if (name2.length < 2 || name2.length > 80) throw new Error("Pipeline names must be between 2 and 80 characters.");
  if (stages.length === 0 || stages.length > 30 || stages.some((stage) => !stage || stage.length > 80) || new Set(stages.map((stage) => stage.toLocaleLowerCase())).size !== stages.length) {
    throw new Error("A pipeline must have 1–30 uniquely named stages.");
  }
  const save = db.transaction(() => {
    if (input.id === void 0) {
      const order = Number(db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM pipelines").get().n) + 1;
      const result = db.prepare("INSERT INTO pipelines(name, sort_order) VALUES (?, ?)").run(name2, order);
      input.id = Number(result.lastInsertRowid);
    } else {
      if (!db.prepare("SELECT 1 FROM pipelines WHERE id = ?").get(input.id)) throw new Error("Pipeline not found.");
      db.prepare("UPDATE pipelines SET name = ? WHERE id = ?").run(name2, input.id);
    }
    const pipelineId = input.id;
    const previous = db.prepare("SELECT name FROM pipeline_stage_definitions WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order, id").all(pipelineId);
    const removed = previous.map((item) => item.name).filter((stage) => !stages.includes(stage));
    const added = stages.filter((stage) => !previous.some((item) => item.name === stage));
    const fallback = stages[0];
    for (const stage of stages) {
      db.prepare("INSERT OR IGNORE INTO pipeline_stages(name, sort_order) VALUES (?, ?)").run(stage, stages.indexOf(stage));
      db.prepare(`INSERT INTO pipeline_stage_definitions(pipeline_id, name, sort_order, active) VALUES (?, ?, ?, 1)
        ON CONFLICT(pipeline_id, name) DO UPDATE SET sort_order = excluded.sort_order, active = 1`).run(pipelineId, stage, stages.indexOf(stage));
    }
    const renamed = /* @__PURE__ */ new Set();
    if (removed.length === added.length) {
      if (removed.length === 1) {
        db.prepare("UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ? AND status = ?").run(added[0], pipelineId, removed[0]);
        renamed.add(removed[0]);
      }
      for (let index = 0; index < previous.length; index += 1) {
        const oldName = previous[index].name;
        const newName = stages[index];
        if (removed.length > 1 && removed.includes(oldName) && added.includes(newName)) {
          db.prepare("UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ? AND status = ?").run(newName, pipelineId, oldName);
          renamed.add(oldName);
        }
      }
    }
    for (const stage of removed) {
      if (!renamed.has(stage)) {
        db.prepare("UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ? AND status = ?").run(fallback, pipelineId, stage);
      }
      db.prepare("UPDATE pipeline_stage_definitions SET active = 0 WHERE pipeline_id = ? AND name = ?").run(pipelineId, stage);
    }
    const unused = db.prepare(`SELECT name FROM pipeline_stages
      WHERE name IN (${removed.map(() => "?").join(",") || "''"})
      AND NOT EXISTS (SELECT 1 FROM applications WHERE status = pipeline_stages.name)`).all(...removed);
    for (const item of unused) db.prepare("DELETE FROM pipeline_stages WHERE name = ?").run(item.name);
  });
  save();
}
function deletePipeline(db, id2) {
  if (id2 === 1) throw new Error("The default pipeline cannot be deleted.");
  const remove = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM pipelines WHERE id = ?").get(id2)) throw new Error("Pipeline not found.");
    const fallback = db.prepare(`SELECT id FROM pipelines WHERE id <> ? ORDER BY sort_order, id LIMIT 1`).get(id2);
    if (!fallback) throw new Error("Create another pipeline before deleting the last pipeline.");
    const firstStage = db.prepare("SELECT name FROM pipeline_stage_definitions WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order LIMIT 1").get(fallback.id);
    if (!firstStage) throw new Error("The default pipeline needs at least one active stage.");
    db.prepare("UPDATE applications SET pipeline_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ?").run(fallback.id, firstStage.name, id2);
    db.prepare("DELETE FROM pipelines WHERE id = ?").run(id2);
  });
  remove();
}
function listCatalog(db, kind) {
  const table = kind === "visaType" ? "visa_types" : "countries";
  return db.prepare(`SELECT id, name, active FROM ${table} ORDER BY name COLLATE NOCASE`).all().map((row) => ({ ...row, active: Boolean(row.active) }));
}
function saveCatalogItem(db, kind, item) {
  const table = kind === "visaType" ? "visa_types" : "countries";
  const name2 = item.name.trim();
  if (name2.length < 2 || name2.length > 100) throw new Error("Catalog names must be between 2 and 100 characters.");
  if (item.id === void 0) db.prepare(`INSERT INTO ${table}(name, active) VALUES (?, ?)`).run(name2, Number(item.active));
  else db.prepare(`UPDATE ${table} SET name = ?, active = ? WHERE id = ?`).run(name2, Number(item.active), item.id);
}
function deleteCatalogItem(db, kind, id2) {
  const table = kind === "visaType" ? "visa_types" : "countries";
  const name2 = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id2);
  if (!name2) throw new Error("Catalog item not found.");
  const column = kind === "visaType" ? "visa_type" : "country";
  const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM applications WHERE ${column} = ?`).get(name2.name).count);
  if (count) throw new Error(`This ${kind === "visaType" ? "visa type" : "country"} is used by ${count} application(s). Disable it instead to preserve history.`);
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id2);
}
function hashPassword(password, salt) {
  return node_crypto.scryptSync(password, salt, 64);
}
function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 256) {
    throw new Error("The HR password must be between 8 and 256 characters.");
  }
}
function isHrPasswordConfigured(db) {
  return Boolean(db.prepare("SELECT 1 FROM hr_security_settings WHERE id = 1").get());
}
function setInitialHrPassword(db, actor, password) {
  validatePassword(password);
  const salt = node_crypto.randomBytes(16);
  const result = db.prepare(`INSERT OR IGNORE INTO hr_security_settings(id, salt, password_hash, updated_by)
    VALUES (1, ?, ?, ?)`).run(salt.toString("hex"), hashPassword(password, salt).toString("hex"), actor);
  if (result.changes !== 1) throw new Error("The HR password has already been created.");
}
function verifyHrPassword(db, password) {
  if (typeof password !== "string" || password.length > 256) return false;
  const stored = db.prepare("SELECT salt, password_hash AS passwordHash FROM hr_security_settings WHERE id = 1").get();
  if (!stored) return false;
  const actual = hashPassword(password, Buffer.from(stored.salt, "hex"));
  const expected = Buffer.from(stored.passwordHash, "hex");
  return actual.length === expected.length && node_crypto.timingSafeEqual(actual, expected);
}
function changeHrPassword(db, actor, currentPassword, newPassword) {
  validatePassword(newPassword);
  if (!verifyHrPassword(db, currentPassword)) throw new Error("The current HR password is incorrect.");
  const salt = node_crypto.randomBytes(16);
  db.prepare(`UPDATE hr_security_settings SET salt = ?, password_hash = ?, updated_by = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(salt.toString("hex"), hashPassword(newPassword, salt).toString("hex"), actor);
}
function resetHrPassword(db, actor, newPassword) {
  validatePassword(newPassword);
  const salt = node_crypto.randomBytes(16);
  const result = db.prepare(`UPDATE hr_security_settings SET salt = ?, password_hash = ?, updated_by = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1`).run(salt.toString("hex"), hashPassword(newPassword, salt).toString("hex"), actor);
  if (result.changes !== 1) throw new Error("The HR password is not configured.");
}
const maxLogSize = 2 * 1024 * 1024;
function redact(value) {
  return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]").replace(/\b(?:\+?\d[\d\s().-]{5,}\d)\b/g, "[redacted number]").replace(/\b(?=[A-Z0-9]{6,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, "[redacted identifier]");
}
function recordDiagnostic(event, error, includeMessage = false, rendererDetails) {
  try {
    const directory = node_path.join(electron.app.getPath("userData"), "logs");
    node_fs.mkdirSync(directory, { recursive: true });
    const date = /* @__PURE__ */ new Date();
    const day = date.toISOString().slice(0, 10);
    const file = node_path.join(directory, `application-${day}.log`);
    if (node_fs.existsSync(file) && node_fs.statSync(file).size >= maxLogSize) {
      const base = `application-${day}-${date.getTime()}`;
      let suffix = 0;
      let rotated = node_path.join(directory, `${base}.log`);
      while (node_fs.existsSync(rotated)) rotated = node_path.join(directory, `${base}-${++suffix}.log`);
      node_fs.renameSync(file, rotated);
    }
    const details2 = {};
    if (rendererDetails) {
      if (rendererDetails.errorName) details2.errorName = redact(rendererDetails.errorName).slice(0, 120);
      if (rendererDetails.stack) details2.stack = redact(rendererDetails.stack).slice(0, 8e3);
    } else if (error instanceof Error) {
      details2.errorName = error.name;
      if (includeMessage) details2.message = redact(error.message).slice(0, 2e3);
      const frames = error.stack?.split("\n").slice(1).join("\n");
      if (frames) details2.stack = redact(frames).slice(0, 8e3);
    } else if (error !== void 0) {
      details2.errorType = typeof error;
    }
    node_fs.appendFileSync(file, `${JSON.stringify({
      timestamp: date.toISOString(),
      event,
      ...details2
    })}
`, { encoding: "utf8", mode: 384 });
  } catch {
    console.error("Unable to write application diagnostics to the user data logs folder.");
  }
}
const passportFieldNames = [
  "firstName",
  "surname",
  "fullName",
  "dateOfBirth",
  "passportNumber",
  "nationality",
  "gender",
  "issueDate",
  "expiryDate"
];
const labelPatterns = {
  fullName: /\bfull\s*name\b/i,
  surname: /\bsurname\b|\bfamily\s*name\b/i,
  dateOfBirth: /\bdate\s*of\s*birth\b/i,
  passportNumber: /\bpassport\s*(?:no|number)\b/i,
  nationality: /\bnationality\b/i,
  gender: /\bsex\b|\bgender\b/i,
  issueDate: /\bdate\s*of\s*issue\b/i,
  expiryDate: /\bdate\s*of\s*expiry\b/i
};
const labelRegions = {
  fullName: { x: [0.12, 0.72], y: [0.08, 0.58] },
  surname: { x: [0.12, 0.72], y: [0.12, 0.7] },
  dateOfBirth: { x: [0.1, 0.72], y: [0.12, 0.74] },
  passportNumber: { x: [0.52, 0.99], y: [0.02, 0.4] },
  nationality: { x: [0.3, 0.98], y: [0.12, 0.76] },
  gender: { x: [0.48, 0.99], y: [0.12, 0.76] },
  issueDate: { x: [0.1, 0.78], y: [0.3, 0.9] },
  expiryDate: { x: [0.1, 0.78], y: [0.35, 0.98] }
};
function makeLines(words) {
  const sorted = words.filter((word) => word.text.trim()).slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines = [];
  for (const word of sorted) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const line = lines.find((candidate) => {
      const height = Math.max(candidate.y1 - candidate.y0, word.bbox.y1 - word.bbox.y0);
      const centerOfLine = (candidate.y0 + candidate.y1) / 2;
      return Math.abs(center - centerOfLine) <= height * 0.65;
    });
    if (line) {
      line.words.push(word);
      line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      line.x0 = Math.min(line.x0, word.bbox.x0);
      line.y0 = Math.min(line.y0, word.bbox.y0);
      line.x1 = Math.max(line.x1, word.bbox.x1);
      line.y1 = Math.max(line.y1, word.bbox.y1);
      line.text = line.words.map((item) => item.text).join(" ");
    } else {
      lines.push({ words: [word], text: word.text, ...word.bbox });
    }
  }
  return lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}
function findLabel(lines, field) {
  const pattern = labelPatterns[field];
  for (const line of lines) {
    const match = pattern.exec(line.text);
    if (!match) continue;
    const before = line.text.slice(0, match.index).trim().split(/\s+/).filter(Boolean).length;
    const matched = match[0].trim().split(/\s+/).length;
    const startIndex = Math.min(before, line.words.length - 1);
    const endIndex = Math.min(before + matched - 1, line.words.length - 1);
    const startWord = line.words[startIndex];
    return { line, startX: startWord?.bbox.x0 ?? line.x0, endIndex };
  }
  return null;
}
function startsPrintedLabel(text2) {
  return /^(?:full|surname|family|date|passport|nationality|sex|gender)\b/i.test(text2);
}
function readVisibleValue(lines, field, page) {
  const found = findLabel(lines, field);
  if (!found) return null;
  const { line: labelLine, startX, endIndex } = found;
  const sameLine = [];
  for (const [index, word] of labelLine.words.entries()) {
    if (index <= endIndex) continue;
    if (startsPrintedLabel(word.text)) break;
    sameLine.push(word);
  }
  let valueWords = sameLine;
  let belowLine = false;
  let value = normalizeVisibleValue(field, valueWords.map((word) => word.text).join(" "));
  if (!value) {
    const lineHeight = Math.max(1, labelLine.y1 - labelLine.y0);
    const candidates = lines.filter((line) => line.y0 > labelLine.y0 && line.y0 - labelLine.y1 <= Math.max(lineHeight * 4, page.height * 0.075)).map((line) => ({
      line,
      distance: Math.abs(line.y0 - labelLine.y1),
      valueWords: contiguousWordsNearestLabel(line.words, startX, page.width)
    })).filter((candidate) => candidate.valueWords.length > 0).sort((a, b) => a.distance - b.distance);
    valueWords = candidates[0]?.valueWords ?? [];
    belowLine = valueWords.length > 0;
    value = normalizeVisibleValue(field, valueWords.map((word) => word.text).join(" "));
  }
  if (!value) return null;
  const wordConfidence = valueWords.reduce((sum, word) => sum + Math.max(0, Math.min(100, word.confidence)), 0) / valueWords.length;
  const labelCenterX = (labelLine.x0 + labelLine.x1) / 2 / page.width;
  const labelCenterY = (labelLine.y0 + labelLine.y1) / 2 / page.height;
  const expected = labelRegions[field];
  const locationMatches = labelCenterX >= expected.x[0] && labelCenterX <= expected.x[1] && labelCenterY >= expected.y[0] && labelCenterY <= expected.y[1];
  const confidence = Math.round(Math.max(0, Math.min(100, wordConfidence * (belowLine ? 0.88 : 0.92) + (locationMatches ? 8 : -15))));
  return { value, confidence };
}
function contiguousWordsNearestLabel(words, labelX, pageWidth) {
  const sorted = words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
  let anchor = -1;
  let nearestDistance = Infinity;
  for (const [index, word] of sorted.entries()) {
    if (startsPrintedLabel(word.text)) continue;
    const distance = Math.abs(word.bbox.x0 - labelX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      anchor = index;
    }
  }
  if (anchor < 0 || nearestDistance > pageWidth * 0.22) return [];
  const result = [sorted[anchor]];
  const maxGap = Math.max(18, pageWidth * 0.04);
  for (let index = anchor + 1; index < sorted.length; index += 1) {
    const previous = result[result.length - 1];
    const current = sorted[index];
    if (startsPrintedLabel(current.text) || current.bbox.x0 - previous.bbox.x1 > maxGap) break;
    result.push(current);
  }
  return result;
}
function normalizeVisibleValue(field, raw) {
  const clean = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d./-]+$/gu, "").replace(/\s+/g, " ").trim();
  if (field === "gender") {
    const genderTokens = clean.toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const recognized = new Set(genderTokens.map((token) => token === "m" || token === "male" ? "Male" : token === "f" || token === "female" ? "Female" : "").filter(Boolean));
    return recognized.size === 1 ? [...recognized][0] : "";
  }
  if (field === "dateOfBirth" || field === "issueDate" || field === "expiryDate") return normalizeVisibleDate(clean);
  if (field === "passportNumber") {
    const value = clean.replace(/[^a-z0-9]/gi, "");
    return /^[A-Z0-9]{7,12}$/i.test(value) && /[A-Z]/i.test(value) && /\d/.test(value) ? value : "";
  }
  return clean;
}
function normalizeVisibleDate(value) {
  const match = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function normalizeComparable(field, value) {
  return field === "fullName" || field === "firstName" || field === "surname" || field === "nationality" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase() : value.trim().toLocaleLowerCase();
}
function validField(field, value) {
  if (!value) return false;
  if (field === "passportNumber") return /^[A-Z0-9]{7,12}$/i.test(value) && /[A-Z]/i.test(value) && /\d/.test(value);
  if (field === "dateOfBirth" || field === "issueDate" || field === "expiryDate") return isValidIsoDate(value);
  if (field === "gender") return value === "Male" || value === "Female";
  return true;
}
function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function mergeGeminiPassport(geminiFields, local) {
  const fields = { ...local.fields };
  const assessments = { ...local.assessments };
  for (const field of passportFieldNames) {
    const result = geminiFields[field];
    const inferredFromFullName = field === "firstName" && !result.value ? geminiFields.fullName.value?.trim().split(/\s+/)[0] ?? null : null;
    const rawValue = typeof result.value === "string" ? result.value.trim() : inferredFromFullName ?? "";
    const value = rawValue.length <= 120 ? rawValue : "";
    const normalizedValue = field === "gender" && /^m(?:ale)?$/i.test(value) ? "Male" : field === "gender" && /^f(?:emale)?$/i.test(value) ? "Female" : value;
    const validatedValue = normalizedValue && validField(field, normalizedValue) ? normalizedValue : "";
    const localAssessment = local.assessments[field];
    const hasConflict = Boolean(validatedValue && localAssessment.value && normalizeComparable(field, validatedValue) !== normalizeComparable(field, localAssessment.value));
    if (validatedValue) {
      fields[field] = validatedValue;
      assessments[field] = {
        value: validatedValue,
        confidence: Number.isFinite(result.confidence) ? Math.round(Math.max(0, Math.min(100, field === "firstName" && inferredFromFullName ? geminiFields.fullName.confidence : result.confidence))) : 0,
        sources: ["gemini", ...localAssessment.value ? localAssessment.sources : []],
        needsReview: true,
        conflict: hasConflict || localAssessment.conflict
      };
    } else if (localAssessment.value && localAssessment.sources.includes("visible")) {
      fields[field] = localAssessment.value;
      assessments[field] = { ...localAssessment, needsReview: true };
    } else {
      fields[field] = "";
      assessments[field] = {
        value: "",
        confidence: 0,
        sources: [],
        needsReview: true,
        conflict: false
      };
    }
  }
  if (fields.issueDate && fields.expiryDate && fields.issueDate >= fields.expiryDate) {
    for (const field of ["issueDate", "expiryDate"]) {
      assessments[field] = { ...assessments[field], needsReview: true, conflict: true };
    }
  }
  return { profile: "iraqi", fields, assessments };
}
function mrzValue(field, mrz) {
  switch (field) {
    case "firstName":
      return mrz.firstName.split(/\s+/)[0] ?? "";
    case "surname":
      return mrz.surname;
    case "fullName":
      return mrz.fullName;
    case "dateOfBirth":
      return mrz.dateOfBirth;
    case "passportNumber":
      return mrz.passportNumber;
    case "nationality":
      return "";
    case "gender":
      return mrz.gender;
    case "issueDate":
      return "";
    case "expiryDate":
      return mrz.expiryDate;
  }
}
function emptyAssessment() {
  return { value: "", confidence: 0, sources: [], needsReview: true, conflict: false };
}
function extractIraqiPassport(pages, mrz) {
  const values = Object.fromEntries(passportFieldNames.map((field) => [field, ""]));
  const assessments = Object.fromEntries(passportFieldNames.map((field) => [field, emptyAssessment()]));
  const visibleCandidates = /* @__PURE__ */ new Map();
  const fieldLabels = [
    ["fullName", "fullName"],
    ["surname", "surname"],
    ["dateOfBirth", "dateOfBirth"],
    ["passportNumber", "passportNumber"],
    ["nationality", "nationality"],
    ["gender", "gender"],
    ["issueDate", "issueDate"],
    ["expiryDate", "expiryDate"]
  ];
  for (const page of pages) {
    const lines = makeLines(page.words);
    for (const [field, label] of fieldLabels) {
      const candidate = readVisibleValue(lines, label, page);
      if (candidate) visibleCandidates.set(field, [...visibleCandidates.get(field) ?? [], candidate]);
    }
  }
  for (const field of fieldLabels.map(([name2]) => name2)) {
    const candidates = visibleCandidates.get(field) ?? [];
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.confidence - a.confidence);
    const chosen = candidates[0];
    const conflicts = candidates.some((candidate) => normalizeComparable(field, candidate.value) !== normalizeComparable(field, chosen.value));
    values[field] = chosen.value;
    assessments[field] = {
      value: chosen.value,
      confidence: chosen.confidence,
      sources: ["visible"],
      needsReview: chosen.confidence < 80 || conflicts || !validField(field, chosen.value),
      conflict: conflicts
    };
  }
  const fullName = values.fullName;
  if (fullName && !values.firstName) {
    const firstName = fullName.split(/\s+/)[0];
    values.firstName = firstName;
    assessments.firstName = { ...assessments.fullName, value: firstName };
  }
  if (mrz) {
    for (const field of passportFieldNames) {
      const value = mrzValue(field, mrz);
      if (!value) continue;
      const current = assessments[field];
      if (!current.value) {
        values[field] = value;
        assessments[field] = {
          value,
          confidence: mrz.checkDigitsValid ? 60 : 40,
          sources: ["mrz"],
          needsReview: true,
          conflict: false
        };
      } else if (normalizeComparable(field, current.value) !== normalizeComparable(field, value)) {
        assessments[field] = { ...current, needsReview: true, conflict: true, sources: [...current.sources, "mrz"] };
      } else {
        assessments[field] = { ...current, confidence: Math.min(100, current.confidence + (mrz.checkDigitsValid ? 5 : 0)), sources: [...current.sources, "mrz"] };
      }
    }
  }
  if (values.issueDate && values.expiryDate && values.issueDate >= values.expiryDate) {
    for (const field of ["issueDate", "expiryDate"]) {
      assessments[field] = { ...assessments[field], needsReview: true };
    }
  }
  values.firstName = values.firstName.trim();
  values.surname = values.surname.trim();
  if (!values.fullName && (values.firstName || values.surname)) {
    values.fullName = [values.firstName, values.surname].filter(Boolean).join(" ");
    assessments.fullName = { ...assessments.firstName, value: values.fullName, needsReview: true };
  }
  return { profile: "iraqi", fields: values, assessments };
}
const defaultModel = "gemini-2.5-flash";
const requestTimeoutMs = 45e3;
const maxAttempts = 3;
const emptyUsage = { requests: 0, successes: 0, failures: 0, promptTokens: 0, candidateTokens: 0, lastUsedAt: null };
const fieldSchema = {
  type: genai.Type.OBJECT,
  properties: {
    value: { type: genai.Type.STRING, nullable: true, description: "The exact visible value or null if unreadable or absent. Never infer." },
    confidence: { type: genai.Type.NUMBER, minimum: 0, maximum: 100, description: "Visual legibility confidence from 0 to 100. This is not human verification." }
  },
  required: ["value", "confidence"]
};
const responseSchema = {
  type: genai.Type.OBJECT,
  properties: {
    firstName: fieldSchema,
    surname: fieldSchema,
    fullName: fieldSchema,
    passportNumber: fieldSchema,
    issueDate: fieldSchema,
    expiryDate: fieldSchema,
    dateOfBirth: fieldSchema,
    nationality: fieldSchema,
    gender: fieldSchema
  },
  required: ["firstName", "surname", "fullName", "passportNumber", "issueDate", "expiryDate", "dateOfBirth", "nationality", "gender"]
};
function isModel(value) {
  return typeof value === "string" && /^gemini-[a-zA-Z0-9._-]{1,100}$/.test(value);
}
function isProvider(value) {
  return value === "ocr" || value === "gemini";
}
function normalizeResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GeminiPassportError("PASSPORT_VALIDATION_ERROR", "Gemini returned JSON with an invalid passport response shape.", diagnostic("", {
      apiConnection: "success",
      imageProcessing: "success",
      request: "success",
      response: "success",
      jsonParsing: "success",
      validation: "failed"
    }));
  }
  const response = value;
  const keys = ["firstName", "surname", "fullName", "passportNumber", "issueDate", "expiryDate", "dateOfBirth", "nationality", "gender"];
  const normalized = {};
  for (const key of keys) {
    const candidate = response[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      normalized[key] = { value: null, confidence: 0 };
      continue;
    }
    const field = candidate;
    if (field.value !== null && typeof field.value !== "string" || field.confidence !== void 0 && (typeof field.confidence !== "number" || !Number.isFinite(field.confidence))) {
      normalized[key] = { value: null, confidence: 0 };
      continue;
    }
    normalized[key] = {
      value: typeof field.value === "string" && field.value.trim() ? field.value.trim().slice(0, 120) : null,
      confidence: typeof field.confidence === "number" ? Math.max(0, Math.min(100, field.confidence)) : 0
    };
  }
  return normalized;
}
function apiErrorMessage(error) {
  const message = error instanceof Error ? error.message : "";
  const status = error?.status ?? error?.code;
  if (status === 401 || status === 403 || /API key|invalid credential|permission denied/i.test(message)) {
    return "Gemini rejected the API key or this key does not have permission. Check the key and try again.";
  }
  if (status === 429 || /quota|rate limit|resource exhausted/i.test(message)) {
    return "Gemini request quota or rate limit was reached. Wait a moment and retry.";
  }
  if (/abort|timeout|timed out/i.test(message)) return "Gemini request timed out. Check the connection and retry.";
  if (/fetch failed|network|ENOTFOUND|ECONN/i.test(message)) return "Could not connect to Gemini. Check the internet connection and retry.";
  return "Gemini could not recognize this passport. Retry, check the connection, or switch to local OCR.";
}
class GeminiPassportError extends Error {
  constructor(category, message, diagnostics) {
    super(message);
    this.category = category;
    this.diagnostics = diagnostics;
    this.name = "GeminiPassportError";
  }
}
function failureCategory(error) {
  if (error instanceof GeminiPassportError) return error.category;
  const message = error instanceof Error ? error.message : "";
  const status = error?.status ?? error?.code;
  if (status === 401 || status === 403 || /API key|invalid credential|permission denied/i.test(message)) return "API_AUTHENTICATION_ERROR";
  if (status === 404 || /\b404\b|model.{0,50}(not found|unavailable|does not exist)/i.test(message)) return "MODEL_NOT_AVAILABLE";
  if (/schema|response.?format|invalid argument|structured output/i.test(message)) return "PASSPORT_VALIDATION_ERROR";
  if (/image|mime|media type|payload|file too large|unsupported format/i.test(message)) return "IMAGE_UPLOAD_ERROR";
  if (/fetch failed|network|ENOTFOUND|ECONN|socket|connection/i.test(message)) return "API_CONNECTION_ERROR";
  if (/payload|image|mime|media type|file too large|unsupported format/i.test(message)) return "IMAGE_UPLOAD_ERROR";
  if (/empty response|no text candidate/i.test(message)) return "GEMINI_EMPTY_RESPONSE";
  return "API_CONNECTION_ERROR";
}
function safeFailureMessage(error, apiKey) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(apiKey || /\u0000/, "[redacted]").replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[redacted image data]").replace(/\b[A-Za-z0-9+/]{160,}={0,2}\b/g, "[redacted encoded data]").replace(/(?:key|api_key|authorization)\s*[:=]\s*["']?[^,\s"']+/gi, "credential=[redacted]").slice(0, 1e3);
}
function diagnostic(model, stages, values = {}) {
  return { model, stages, ...values };
}
async function retryRequest(action, onAttempt) {
  let lastError;
  let attempts = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    attempts += 1;
    onAttempt?.();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return { value: await action(controller.signal), attempts };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    const status = lastError?.status ?? lastError?.code;
    if (status !== void 0 && status !== 429 && status < 500) break;
    if (attempt + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  const category = failureCategory(lastError);
  const message = `${category}: ${apiErrorMessage(lastError)}${lastError instanceof Error && lastError.message ? ` Details: ${safeFailureMessage(lastError)}` : ""}`;
  throw Object.assign(new Error(message), { attempts, category });
}
class GeminiPassportScanner {
  configPath;
  usagePath;
  constructor(userDataPath) {
    this.configPath = node_path.join(userDataPath, "gemini-config.json");
    this.usagePath = node_path.join(userDataPath, "gemini-usage.json");
  }
  async getSettings() {
    const config = await this.readConfig();
    return {
      configured: Boolean(config?.encryptedApiKey),
      model: config?.model ?? defaultModel,
      provider: config?.provider ?? "ocr",
      usage: await this.readUsage()
    };
  }
  async listModels(apiKeyInput) {
    if (apiKeyInput !== void 0 && typeof apiKeyInput !== "string") throw new Error("The Gemini API key format is invalid.");
    const apiKey = apiKeyInput?.trim() || await this.readApiKey();
    if (!apiKey) throw new Error("Enter a Gemini API key before loading supported models.");
    const result = await retryRequest(async (signal) => {
      const client = new genai.GoogleGenAI({ apiKey });
      const pager = await client.models.list({ config: { pageSize: 100, abortSignal: signal, httpOptions: { timeout: requestTimeoutMs } } });
      const models = [];
      for await (const model of pager) {
        const id2 = model.name?.replace(/^models\//, "");
        if (!id2 || !/^gemini-[a-zA-Z0-9._-]+$/.test(id2) || !model.supportedActions?.includes("generateContent")) continue;
        models.push({ id: id2, displayName: model.displayName || id2 });
        if (models.length >= 100) break;
      }
      return models.sort((a, b) => a.displayName.localeCompare(b.displayName));
    });
    if (!result.value.length) throw new Error("This API key has no supported Gemini content-generation models available.");
    return result.value;
  }
  async saveSettings(input) {
    if (!isModel(input.model) || !isProvider(input.provider)) throw new Error("Select a supported Gemini model and passport recognition engine.");
    const current = await this.readConfig();
    if (input.apiKey !== void 0 && typeof input.apiKey !== "string") throw new Error("The Gemini API key format is invalid.");
    const apiKey = input.apiKey?.trim();
    if (apiKey && (apiKey.length > 512 || /[\r\n]/.test(apiKey))) throw new Error("The Gemini API key format is invalid.");
    if (input.provider === "gemini" && !apiKey && !current?.encryptedApiKey) {
      throw new Error("Enter and save a Gemini API key before selecting Gemini as the recognition engine.");
    }
    if (apiKey && !electron.safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this device. The API key was not saved.");
    }
    const encryptedApiKey = apiKey ? electron.safeStorage.encryptString(apiKey).toString("base64") : current?.encryptedApiKey ?? "";
    await this.writeConfig({ encryptedApiKey, model: input.model, provider: input.provider });
    return this.getSettings();
  }
  async testConnection(input) {
    const model = input.model;
    if (!isModel(model)) throw new Error("Select a supported Gemini model.");
    if (input.apiKey !== void 0 && typeof input.apiKey !== "string") throw new Error("The Gemini API key format is invalid.");
    const key = input.apiKey?.trim() || await this.readApiKey();
    if (!key) throw new Error("Enter a Gemini API key before testing the connection.");
    await retryRequest(async (signal) => {
      const client = new genai.GoogleGenAI({ apiKey: key });
      await client.models.get({ model, config: { abortSignal: signal, httpOptions: { timeout: requestTimeoutMs } } });
    });
    return { ok: true, model };
  }
  async diagnoseConnection(model) {
    const stages = {
      apiConnection: "pending",
      imageProcessing: "skipped",
      request: "skipped",
      response: "skipped",
      jsonParsing: "skipped",
      validation: "skipped"
    };
    try {
      const key = await this.readApiKey();
      if (!key) throw new GeminiPassportError("API_AUTHENTICATION_ERROR", "No Gemini API key is configured.", diagnostic(model, { ...stages, apiConnection: "failed" }));
      await this.testConnection({ model });
      return diagnostic(model, { ...stages, apiConnection: "success" });
    } catch (error) {
      const category = failureCategory(error);
      return diagnostic(model, { ...stages, apiConnection: "failed" }, {
        category,
        message: error instanceof Error ? safeFailureMessage(error) : "Gemini connection test failed."
      });
    }
  }
  async inspectImage(filePath, mimeType, local, model) {
    const stages = {
      apiConnection: "pending",
      imageProcessing: "pending",
      request: "pending",
      response: "pending",
      jsonParsing: "pending",
      validation: "pending"
    };
    let apiKey = "";
    try {
      apiKey = await this.readApiKey();
      if (!apiKey) throw Object.assign(new Error("Gemini is selected but no API key is configured. Add it in Settings or switch to local OCR."), { category: "API_AUTHENTICATION_ERROR" });
      stages.apiConnection = "pending";
    } catch (error) {
      stages.apiConnection = "failed";
      throw this.makeScanError(error, model, stages);
    }
    let image;
    try {
      image = await promises.readFile(filePath);
      if (!image.length) throw new Error("The selected passport file is empty.");
      if (image.length > 25 * 1024 * 1024) throw new Error("Passport image must be smaller than 25 MB.");
      if (!["image/jpeg", "image/png", "application/pdf"].includes(mimeType)) throw new Error(`Unsupported passport MIME type: ${mimeType || "missing"}.`);
      const validSignature = mimeType === "image/jpeg" ? image[0] === 255 && image[1] === 216 : mimeType === "image/png" ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : image.subarray(0, 5).toString("ascii") === "%PDF-";
      if (!validSignature) throw new Error(`The file contents do not match the detected ${mimeType} format.`);
      stages.imageProcessing = "success";
    } catch (error) {
      stages.imageProcessing = "failed";
      throw this.makeScanError(error, model, stages, "IMAGE_PROCESSING_ERROR");
    }
    const prompt = `You are a visual passport-field reader using the Iraqi passport profile. Inspect the provided original passport image and locate fields by their printed labels and physical positions, never by OCR text order. For Iraqi passports, read Passport No from the upper-right field; Full Name from the middle-left; Surname from its dedicated labeled field below Full Name; Date of Issue and Date of Expiry from their own labels; Nationality only from the dedicated Nationality label; never use country code IRQ as nationality or a code-zone value as the passport number. Read First Name as only the first given-name token from the visible Full Name; read Surname from its own labeled field. Use the MRZ only as corroboration and never as the sole source. Preserve spelling exactly as visibly printed. Do not infer, guess, autocorrect, or fill missing data. For an unreadable or absent field, set value to null and confidence to 0. For readable dates return YYYY-MM-DD only when unambiguous; otherwise null. For every other value provide a 0-100 estimate of visual legibility, not verification. If the image is not an Iraqi passport biodata page, return all values null and confidence 0.`;
    let attempts = 0;
    let usage = { promptTokens: 0, candidateTokens: 0 };
    let responseText = "";
    try {
      const result = await retryRequest(async (signal) => {
        const client = new genai.GoogleGenAI({ apiKey });
        const response = await client.models.generateContent({
          model,
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inlineData: { data: image.toString("base64"), mimeType } }
            ]
          }],
          config: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema,
            abortSignal: signal,
            httpOptions: { timeout: requestTimeoutMs }
          }
        });
        usage = {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          candidateTokens: response.usageMetadata?.candidatesTokenCount ?? 0
        };
        const text2 = response.text ?? response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
        if (!text2.trim()) throw new Error("GEMINI_EMPTY_RESPONSE: Gemini returned no text candidate.");
        return { text: text2, response };
      }, () => {
        attempts += 1;
      });
      responseText = result.value.text;
      stages.request = "success";
      stages.response = "success";
      stages.apiConnection = "success";
    } catch (error) {
      await this.recordUsage(attempts, false, usage);
      stages.request = "failed";
      const category = failureCategory(error);
      if (category === "API_AUTHENTICATION_ERROR" || category === "API_CONNECTION_ERROR") stages.apiConnection = "failed";
      else stages.apiConnection = "success";
      if (category === "IMAGE_UPLOAD_ERROR") stages.imageProcessing = "failed";
      throw this.makeScanError(error, model, stages, category, attempts, apiKey);
    }
    let parsed;
    try {
      parsed = JSON.parse(responseText);
      stages.jsonParsing = "success";
    } catch (error) {
      await this.recordUsage(attempts, false, usage);
      stages.jsonParsing = "failed";
      throw this.makeScanError(error, model, stages, "GEMINI_RESPONSE_PARSE_ERROR", attempts, apiKey, responseText);
    }
    try {
      const extraction2 = mergeGeminiPassport(normalizeResponse(parsed), local);
      stages.validation = "success";
      await this.recordUsage(attempts, true, usage);
      return { extraction: extraction2, diagnostics: diagnostic(model, stages, { attempts }) };
    } catch (error) {
      await this.recordUsage(attempts, false, usage);
      stages.validation = "failed";
      throw this.makeScanError(error, model, stages, "PASSPORT_VALIDATION_ERROR", attempts, apiKey, responseText);
    }
  }
  makeScanError(error, model, stages, forcedCategory, attempts, apiKey, response) {
    const category = forcedCategory ?? error?.category ?? failureCategory(error);
    const safeDetails = safeFailureMessage(error, apiKey);
    const message = error instanceof GeminiPassportError ? error.message : `${category}: ${apiErrorMessage(error)}${safeDetails ? ` Details: ${safeDetails}` : ""}`;
    return new GeminiPassportError(category, message, diagnostic(model, stages, {
      category,
      message,
      attempts,
      ...response ? { responsePreview: response.slice(0, 1200) } : {}
    }));
  }
  async readUsage() {
    try {
      const parsed = JSON.parse(await promises.readFile(this.usagePath, "utf8"));
      return {
        requests: Number.isSafeInteger(parsed.requests) && Number(parsed.requests) >= 0 ? Number(parsed.requests) : 0,
        successes: Number.isSafeInteger(parsed.successes) && Number(parsed.successes) >= 0 ? Number(parsed.successes) : 0,
        failures: Number.isSafeInteger(parsed.failures) && Number(parsed.failures) >= 0 ? Number(parsed.failures) : 0,
        promptTokens: Number.isSafeInteger(parsed.promptTokens) && Number(parsed.promptTokens) >= 0 ? Number(parsed.promptTokens) : 0,
        candidateTokens: Number.isSafeInteger(parsed.candidateTokens) && Number(parsed.candidateTokens) >= 0 ? Number(parsed.candidateTokens) : 0,
        lastUsedAt: typeof parsed.lastUsedAt === "string" ? parsed.lastUsedAt : null
      };
    } catch (error) {
      if (error.code === "ENOENT") return { ...emptyUsage };
      throw new Error("Gemini usage statistics could not be read.");
    }
  }
  async recordUsage(requests, succeeded, tokens) {
    const current = await this.readUsage();
    const updated = {
      requests: current.requests + requests,
      successes: current.successes + (succeeded ? 1 : 0),
      failures: current.failures + (succeeded ? 0 : 1),
      promptTokens: current.promptTokens + tokens.promptTokens,
      candidateTokens: current.candidateTokens + tokens.candidateTokens,
      lastUsedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const temporaryPath = node_path.join(node_path.dirname(this.usagePath), `.gemini-usage-${node_crypto.randomUUID()}.tmp`);
    try {
      await promises.writeFile(temporaryPath, JSON.stringify(updated), { encoding: "utf8", mode: 384 });
      await promises.rename(temporaryPath, this.usagePath);
    } catch (error) {
      await promises.rm(temporaryPath, { force: true }).catch(() => void 0);
      throw new Error(`Gemini usage statistics could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async readConfig() {
    try {
      const contents = await promises.readFile(this.configPath, "utf8");
      const parsed = JSON.parse(contents);
      if (typeof parsed.encryptedApiKey !== "string" || !isModel(parsed.model) || !isProvider(parsed.provider)) {
        throw new Error("Gemini settings are damaged. Reconfigure the Gemini connection in Settings.");
      }
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async readApiKey() {
    const config = await this.readConfig();
    if (!config?.encryptedApiKey) return "";
    if (!electron.safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable. Reconfigure Gemini in Settings.");
    try {
      return electron.safeStorage.decryptString(Buffer.from(config.encryptedApiKey, "base64"));
    } catch {
      throw new Error("The stored Gemini credential cannot be decrypted. Re-enter the API key in Settings.");
    }
  }
  async writeConfig(config) {
    const temporaryPath = node_path.join(node_path.dirname(this.configPath), `.gemini-config-${node_crypto.randomUUID()}.tmp`);
    try {
      await promises.writeFile(temporaryPath, JSON.stringify(config), { encoding: "utf8", mode: 384 });
      await promises.rename(temporaryPath, this.configPath);
    } catch (error) {
      await promises.rm(temporaryPath, { force: true }).catch(() => void 0);
      throw new Error(`Unable to save Gemini settings securely: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
function checkDigit(value) {
  const weights = [7, 3, 1];
  const valueOf = (char) => {
    if (char === "<") return 0;
    if (char >= "0" && char <= "9") return Number(char);
    if (char >= "A" && char <= "Z") return char.charCodeAt(0) - 55;
    return -1;
  };
  return [...value].reduce((sum, char, index) => sum + valueOf(char) * weights[index % weights.length], 0) % 10;
}
function decodeDate(value, kind) {
  if (!/^\d{6}$/.test(value)) return "";
  const yy = Number(value.slice(0, 2));
  const month = value.slice(2, 4);
  const day = value.slice(4, 6);
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear() % 100;
  const year = kind === "birth" ? yy > currentYear ? 1900 + yy : 2e3 + yy : yy < currentYear ? 2e3 + yy : 1900 + yy;
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
}
function parsePassportMrz(text2) {
  const lines = text2.toUpperCase().split(/\r?\n/).map((line) => line.replace(/[^A-Z0-9<]/g, "")).filter((line) => line.length >= 40);
  const line1 = lines.find((line) => line.startsWith("P<") && line.length >= 44)?.slice(0, 44);
  if (!line1) return null;
  const line2 = lines.find((line) => line !== line1 && line.length >= 44)?.slice(0, 44);
  if (!line2) return null;
  const nameParts = line1.slice(5).split("<<");
  const surname = (nameParts[0] ?? "").replace(/</g, " ").trim();
  const givenNames = (nameParts[1] ?? "").replace(/</g, " ").trim();
  const passportNumber = line2.slice(0, 9).replace(/</g, "").trim();
  const birth = line2.slice(13, 19);
  const expiry = line2.slice(21, 27);
  const composite = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43);
  const valid = /^\d$/.test(line2[9]) && /^\d$/.test(line2[19]) && /^\d$/.test(line2[27]) && /^\d$/.test(line2[43]) && checkDigit(line2.slice(0, 9)) === Number(line2[9]) && checkDigit(birth) === Number(line2[19]) && checkDigit(expiry) === Number(line2[27]) && checkDigit(composite) === Number(line2[43]);
  return {
    fullName: [givenNames, surname].filter(Boolean).join(" "),
    firstName: givenNames,
    surname,
    passportNumber,
    nationality: line2.slice(10, 13).replace(/</g, ""),
    dateOfBirth: decodeDate(birth, "birth"),
    gender: line2[20] === "F" ? "Female" : line2[20] === "M" ? "Male" : "",
    expiryDate: decodeDate(expiry, "expiry"),
    checkDigitsValid: valid
  };
}
const MAX_REQUEST = 720 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
const documentActions = /* @__PURE__ */ new Set(["documents-list", "document-begin", "document-chunk", "document-cancel", "document-finish", "document-download"]);
const actions = /* @__PURE__ */ new Set(["probe", "login", "crm", "hr", "workspace", "gemini", "status", "check-in", "check-out", "calendar", ...documentActions]);
function getLanIPv4Addresses() {
  const addresses = Object.values(node_os.networkInterfaces()).flat().filter((item) => item && !item.internal && node_net.isIP(item.address) === 4 && !item.address.startsWith("169.254.")).map((item) => item.address);
  return [...new Set(addresses)].sort();
}
function parseLanConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid LAN configuration.");
  const config = value;
  if (config.mode === "local") return { mode: "local" };
  if (!Number.isSafeInteger(config.port) || Number(config.port) < 1024 || Number(config.port) > 65535) throw new Error("LAN port must be between 1024 and 65535.");
  const port = Number(config.port);
  if (config.mode === "server") {
    if (typeof config.bindAddress !== "string" || node_net.isIP(config.bindAddress) !== 4 || config.bindAddress.startsWith("127.") || config.bindAddress === "0.0.0.0") throw new Error("Choose a specific LAN IPv4 address for the server.");
    const addresses = getLanIPv4Addresses();
    if (!addresses.includes(config.bindAddress)) throw new Error("The server bind address is not assigned to this computer.");
    return { mode: "server", bindAddress: config.bindAddress, port };
  }
  if (config.mode === "client") {
    if (typeof config.host !== "string" || !/^[a-zA-Z0-9.-]{1,253}$/.test(config.host) || typeof config.fingerprint !== "string" || !/^[a-fA-F0-9]{64}$/.test(config.fingerprint.replace(/:/g, ""))) {
      throw new Error("Invalid server address or SHA-256 certificate fingerprint.");
    }
    return { mode: "client", host: config.host, port, fingerprint: config.fingerprint.replace(/:/g, "").toUpperCase() };
  }
  throw new Error("Unknown LAN workspace mode.");
}
function readLanConfig(root) {
  const file = node_path.join(root, "lan-workspace.json");
  try {
    return parseLanConfig(JSON.parse(node_fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return { mode: "local" };
    throw new Error(`Cannot load LAN workspace configuration: ${error instanceof Error ? error.message : "invalid configuration"}`);
  }
}
function parseRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request.");
  const v = value;
  if (v.action === "probe") {
    if (Object.keys(v).some((key) => !["action", "args"].includes(key)) || !Array.isArray(v.args) || v.args.length !== 0) {
      throw new Error("Invalid request.");
    }
    return { action: "probe", args: [] };
  }
  if (Object.keys(v).some((key) => !["action", "username", "password", "args"].includes(key)) || typeof v.action !== "string" || !actions.has(v.action) || typeof v.username !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(v.username) || typeof v.password !== "string" || v.password.length < 1 || v.password.length > 256 || !Array.isArray(v.args)) throw new Error("Invalid request.");
  if (v.action === "crm" || v.action === "hr" || v.action === "workspace" || v.action === "gemini") {
    if (v.args.length !== 3 || typeof v.args[0] !== "string" || v.args[0].length > 64 || !Array.isArray(v.args[1]) || typeof v.args[2] !== "string" || !/^[a-f0-9]{64}$/.test(v.args[2])) throw new Error("Invalid request.");
  } else if (v.action === "calendar") {
    if (v.args.length !== 2 || !Number.isSafeInteger(v.args[0]) || v.args[0] < 1900 || v.args[0] > 9999 || !Number.isSafeInteger(v.args[1]) || v.args[1] < 1 || v.args[1] > 12) throw new Error("Invalid calendar.");
  } else if (v.action === "document-begin") {
    if (v.args.length !== 3 || typeof v.args[0] !== "string" || typeof v.args[1] !== "string" || typeof v.args[2] !== "number") throw new Error("Invalid request.");
  } else if (v.action === "document-chunk") {
    if (v.args.length !== 3 || typeof v.args[0] !== "string" || typeof v.args[1] !== "number" || typeof v.args[2] !== "string") throw new Error("Invalid request.");
  } else if (v.action === "document-cancel" || v.action === "document-finish") {
    if (v.args.length !== 1 || typeof v.args[0] !== "string") throw new Error("Invalid request.");
  } else if (v.action === "document-download") {
    if (v.args.length !== 3 || typeof v.args[0] !== "string" || typeof v.args[1] !== "number" || typeof v.args[2] !== "number") throw new Error("Invalid request.");
  } else if (v.args.length !== 0) throw new Error("Invalid request.");
  return v;
}
function dispatchAttendance(request, deps) {
  if (request.action === "probe") return { service: "Blue Line Visa CRM", protocolVersion: 1 };
  const user = deps.authenticate(request.username, request.password);
  if (!user) throw new Error("Username or password is incorrect.");
  if (request.action === "login") return { ...user, permissions: user.permissions.filter((permission) => permission === "My Attendance" || deps.documents && permission === "Documents" || deps.crm && ["CRM", "Customers", "DATA", "Visa Pipeline", "Visa Types", "Countries", "Settings"].includes(permission) || deps.hr && permission === "Human Resources" || deps.workspace && ["Dashboard", "Reports", "Smart Scanner"].includes(permission)) };
  if (request.action === "crm" || request.action === "hr" || request.action === "workspace" || request.action === "gemini") {
    const handler = request.action === "crm" ? deps.crm : request.action === "hr" ? deps.hr : request.action === "gemini" ? deps.gemini : deps.workspace;
    if (!handler) throw new Error("This workspace action is unavailable.");
    return handler.execute(user, request.args[2], request.args[0], request.args[1]);
  }
  if (documentActions.has(request.action)) {
    if (!user.permissions.includes("Documents") || !deps.documents) throw new Error("You do not have permission to access Documents.");
    const [a, b, c] = request.args;
    switch (request.action) {
      case "documents-list":
        return deps.documents.list();
      case "document-begin":
        return deps.documents.begin(user, a, b, c);
      case "document-chunk":
        return deps.documents.chunk(user, a, b, c);
      case "document-cancel":
        return deps.documents.cancel(user, a);
      case "document-finish":
        return deps.documents.finish(user, a);
      case "document-download":
        return deps.documents.download(a, b, c);
      default:
        throw new Error("Invalid request.");
    }
  }
  if (!user.permissions.includes("My Attendance")) throw new Error("You do not have permission to access My Attendance.");
  return deps.attendance(request.action, user, request.args);
}
async function testOfficeServerConnection(config) {
  const result = await requestAttendance(config, { action: "probe", args: [] });
  if (result?.service !== "Blue Line Visa CRM" || result.protocolVersion !== 1) {
    throw new Error("The connected server is not a compatible Blue Line office server.");
  }
  return { service: result.service, protocolVersion: result.protocolVersion };
}
const publicErrors = /* @__PURE__ */ new Set([
  "Username or password is incorrect.",
  "You do not have permission to access My Attendance.",
  "You do not have permission to access Documents.",
  "You do not have permission for this action.",
  "You do not have permission for Human Resources.",
  "Unlock Human Resources with the HR password to continue.",
  "The HR password is incorrect.",
  "The current HR password is incorrect.",
  "The administrator password is incorrect.",
  "Only an administrator can manage HR security or user assignments.",
  "The HR password is not configured.",
  "The HR password has already been created.",
  "The HR password must be between 8 and 256 characters.",
  "Only an administrator can manage application users or create a shared backup.",
  "The host could not create the backup.",
  "A shared backup is already in progress.",
  "Backup expired.",
  "Gemini is not configured on the office server.",
  "A shared Gemini scan is already in progress.",
  "The office server could not complete the Gemini scan.",
  "Scan expired.",
  "Employee data was deleted, but a stored HR file could not be removed.",
  "Application not found.",
  "Customer not found.",
  "Invalid pipeline stage.",
  "Invalid pipeline.",
  "That passport number is already assigned to another customer.",
  "Name, country, and visa type are required.",
  "Name, phone, country, and visa type are required.",
  "Customer name and phone are required.",
  "Application does not belong to this customer.",
  "Document not found.",
  "Unsupported document filename.",
  "Document must be between 1 byte and 25 MB.",
  "Document is unavailable or exceeds 25 MB.",
  "Too many uploads are in progress. Try again later.",
  "Finish or cancel your other upload first.",
  "Upload expired. Choose the file again.",
  "No employee profile is assigned to this application user. Ask an administrator to assign one in Human Resources.",
  "The employee profile assigned to this application user is not active.",
  "Check in before checking out.",
  "This employee has already checked out today.",
  "Check-out must be later than check-in. Overnight shifts are not supported."
]);
async function startAttendanceServer(root, config, deps) {
  const key = node_fs.readFileSync(node_path.join(root, "lan-server", "key.pem"));
  const cert = node_fs.readFileSync(node_path.join(root, "lan-server", "cert.pem"));
  const fingerprint = new node_crypto.X509Certificate(cert).fingerprint256;
  const failures = /* @__PURE__ */ new Map();
  const server = node_tls.createServer({ key, cert, minVersion: "TLSv1.2" }, (socket) => {
    const deadline = setTimeout(() => socket.destroy(), 1e4);
    socket.once("close", () => clearTimeout(deadline));
    socket.setTimeout(1e4, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    const chunks = [];
    let length = 0;
    let handled = false;
    socket.on("data", async (chunk) => {
      if (handled) return;
      chunks.push(chunk);
      length += chunk.length;
      if (length > MAX_REQUEST) {
        socket.destroy();
        return;
      }
      if (!chunk.includes(10)) return;
      handled = true;
      const data = Buffer.concat(chunks, length);
      const newline = data.indexOf(10);
      const address = socket.remoteAddress ?? "";
      let response;
      try {
        if (newline !== data.length - 1) throw new Error("Invalid request.");
        const request = parseRequest(JSON.parse(data.subarray(0, newline).toString("utf8")));
        const current = failures.get(address);
        if (current && current.until > Date.now() && current.count >= 5) throw new Error("Too many failed sign-in attempts. Try again later.");
        try {
          const result = await dispatchAttendance(request, deps);
          response = { ok: true, result };
        } catch (error) {
          if (error instanceof Error && [
            "Username or password is incorrect.",
            "The HR password is incorrect.",
            "The current HR password is incorrect.",
            "The administrator password is incorrect."
          ].includes(error.message)) {
            const previous = current && current.until > Date.now() ? current : { count: 0, until: Date.now() + 6e4 };
            failures.set(address, { ...previous, count: previous.count + 1 });
            if (failures.size > 1024) failures.delete(failures.keys().next().value);
          }
          throw error;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        response = { ok: false, error: publicErrors.has(message) || message === "Too many failed sign-in attempts. Try again later." ? message : "Unable to process the workspace request. Check the details and try again." };
      }
      const encoded = JSON.stringify(response);
      if (Buffer.byteLength(encoded) > MAX_RESPONSE) socket.end('{"ok":false,"error":"Server response is too large."}\n');
      else socket.end(`${encoded}
`);
    });
  });
  server.maxConnections = 20;
  server.on("tlsClientError", () => {
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindAddress, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", (error) => console.error("LAN attendance server error:", error.message));
  return { server, fingerprint };
}
function requestAttendance(config, request) {
  parseRequest(request);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const socket = node_tls.connect({ host: config.host, port: config.port, rejectUnauthorized: false, minVersion: "TLSv1.2" });
    const fail = (error) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(error);
      }
    };
    socket.setTimeout(1e4, () => fail(new Error("Server connection timed out.")));
    socket.on("error", () => fail(new Error("Could not securely connect to the office server.")));
    socket.on("secureConnect", () => {
      const actual = socket.getPeerCertificate().fingerprint256?.replace(/:/g, "").toUpperCase();
      if (!actual || actual !== config.fingerprint) {
        fail(new Error("Server certificate fingerprint does not match. No credentials were sent."));
        return;
      }
      socket.write(`${JSON.stringify(request)}
`);
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length > MAX_RESPONSE) {
        fail(new Error("Server response is too large."));
        return;
      }
      if (!chunk.includes(10)) return;
      const data = Buffer.concat(chunks, length);
      const newline = data.indexOf(10);
      try {
        if (newline !== data.length - 1) throw new Error();
        const response = JSON.parse(data.subarray(0, newline).toString("utf8"));
        if (!response || typeof response.ok !== "boolean") throw new Error();
        settled = true;
        socket.destroy();
        if (response.ok) resolve(response.result);
        else reject(new Error(typeof response.error === "string" ? response.error : "Server request failed."));
      } catch {
        fail(new Error("Invalid server response."));
      }
    });
    socket.on("end", () => {
      if (!settled) fail(new Error("Server closed the connection."));
    });
    socket.on("close", () => {
      if (!settled) fail(new Error("Server closed the connection."));
    });
  });
}
const DOCUMENT_CHUNK_SIZE = 512 * 1024;
const DOCUMENT_MAX_SIZE = 25 * 1024 * 1024;
const extensions$1 = /* @__PURE__ */ new Set([".pdf", ".jpg", ".jpeg", ".png"]);
function documentName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 180 || /[\\/:*?"<>|\x00-\x1f]/.test(value) || !extensions$1.has(node_path.extname(value).toLowerCase())) throw new Error("Unsupported document filename.");
  return value;
}
function positiveId(value) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("Invalid document ID.");
  return Number(value);
}
class LanDocuments {
  constructor(db, docsDir) {
    this.db = db;
    this.docsDir = docsDir;
    setInterval(() => this.expire(), 6e4).unref();
  }
  pending = /* @__PURE__ */ new Map();
  list() {
    const records = listAllDocuments(this.db);
    if (records.length > 5e3) throw new Error("The document library is too large for this client.");
    return records;
  }
  begin(user, reference, name2, size) {
    this.expire();
    if (this.pending.size >= 4) throw new Error("Too many uploads are in progress. Try again later.");
    if (Array.from(this.pending.values()).some((upload) => upload.owner === user.id)) throw new Error("Finish or cancel your other upload first.");
    if (typeof reference !== "string" || reference.length > 80 || !reference.trim()) throw new Error("Enter an application reference.");
    const application = this.db.prepare("SELECT id FROM applications WHERE application_id = ? AND deleted_at IS NULL").get(reference.trim());
    if (!application) throw new Error("Application not found.");
    const fileName = documentName(name2);
    if (!Number.isSafeInteger(size) || size < 1 || size > DOCUMENT_MAX_SIZE) throw new Error("Document must be between 1 byte and 25 MB.");
    const token = node_crypto.randomUUID();
    this.pending.set(token, { owner: user.id, reference: reference.trim(), name: fileName, size, chunks: [], received: 0, expires: Date.now() + 5 * 6e4 });
    return token;
  }
  chunk(user, token, offset, encoded) {
    const pending = this.getPending(user, token);
    if (!Number.isSafeInteger(offset) || offset !== pending.received || typeof encoded !== "string" || encoded.length > Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid upload chunk.");
    const data = Buffer.from(encoded, "base64");
    if (data.length !== Math.min(DOCUMENT_CHUNK_SIZE, pending.size - pending.received) || data.toString("base64") !== encoded) throw new Error("Invalid upload chunk.");
    pending.chunks.push(data);
    pending.received += data.length;
    pending.expires = Date.now() + 5 * 6e4;
    return pending.received;
  }
  cancel(user, token) {
    this.getPending(user, token);
    this.pending.delete(token);
  }
  async finish(user, token) {
    const pending = this.getPending(user, token);
    if (pending.received !== pending.size) throw new Error("The upload is incomplete.");
    this.pending.delete(token);
    const directory = node_path.join(this.docsDir, "lan-uploads");
    await promises.mkdir(directory, { recursive: true });
    const destination = node_path.join(directory, `${node_crypto.randomUUID()}${node_path.extname(pending.name).toLowerCase()}`);
    try {
      await promises.writeFile(destination, Buffer.concat(pending.chunks, pending.size), { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") await promises.rm(destination, { force: true });
      throw error;
    }
    try {
      return this.db.transaction(() => {
        const app = this.db.prepare("SELECT id, application_id AS applicationId FROM applications WHERE application_id = ? AND deleted_at IS NULL").get(pending.reference);
        if (!app) throw new Error("Application not found.");
        const record2 = this.db.prepare("INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, 'Supporting Document', ?, ?)").run(app.id, pending.name, destination);
        this.db.prepare("INSERT INTO application_activities(application_id, activity_type, description) VALUES (?, 'Document Added', ?)").run(app.id, `Document uploaded: ${pending.name}`);
        return { id: Number(record2.lastInsertRowid), applicationId: app.applicationId, fileName: pending.name };
      })();
    } catch (error) {
      await promises.rm(destination, { force: true });
      throw error;
    }
  }
  async download(storage, id2, offset) {
    if (storage !== "application" && storage !== "customer") throw new Error("Invalid document type.");
    positiveId(id2);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > DOCUMENT_MAX_SIZE || offset % DOCUMENT_CHUNK_SIZE !== 0) throw new Error("Invalid download offset.");
    const row = storage === "application" ? this.db.prepare(`SELECT d.file_path AS path, d.file_name AS name FROM documents d JOIN applications a ON a.id = d.application_id
          WHERE d.id = ? AND a.deleted_at IS NULL`).get(id2) : this.db.prepare("SELECT file_path AS path, file_name AS name FROM customer_documents WHERE id = ?").get(id2);
    if (!row) throw new Error("Document not found.");
    const name2 = documentName(node_path.basename(row.name));
    const root = await promises.realpath(this.docsDir);
    const path = await promises.realpath(row.path);
    const within = node_path.relative(root, path);
    if (!within || within === ".." || within.startsWith(`..${node_path.sep}`) || node_path.isAbsolute(within) || node_path.resolve(path) === node_path.resolve(root)) throw new Error("Document is outside managed storage.");
    if (!extensions$1.has(node_path.extname(path).toLowerCase())) throw new Error("Unsupported document format.");
    const details2 = await promises.stat(path);
    if (!details2.isFile() || details2.size < 1 || details2.size > DOCUMENT_MAX_SIZE || offset >= details2.size) throw new Error("Document is unavailable or exceeds 25 MB.");
    const handle = await promises.open(path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(DOCUMENT_CHUNK_SIZE, details2.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead !== buffer.length) throw new Error("Document changed during download.");
      return { name: name2, size: details2.size, data: buffer.toString("base64") };
    } finally {
      await handle.close();
    }
  }
  expire() {
    for (const [token, upload] of this.pending) if (upload.expires < Date.now()) this.pending.delete(token);
  }
  getPending(user, token) {
    this.expire();
    const upload = this.pending.get(token);
    if (!upload || upload.owner !== user.id) throw new Error("Upload expired. Choose the file again.");
    return upload;
  }
}
const customers = ["CRM", "Customers", "DATA"];
const pipeline = ["Visa Pipeline"];
const fileModules = {
  application: ["Visa Pipeline", "Documents"],
  customer: customers,
  photo: customers,
  passport: ["Dashboard", "Visa Pipeline"]
};
function access$2(user, modules) {
  if (!modules.some((module2) => user.permissions.includes(module2))) throw new Error("You do not have permission for this action.");
}
function id$1(value) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("Invalid record ID.");
  return Number(value);
}
function text$2(value, max = 2e3) {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text value.");
  return value;
}
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid details.");
  const record2 = value;
  if (Object.keys(record2).some((key) => !keys.includes(key))) throw new Error("Invalid details.");
  return record2;
}
function applicationInput(value) {
  const fields = ["fullName", "phone", "email", "nationality", "passportNumber", "country", "visaType", "employee", "followUpDate", "dateOfBirth", "gender", "address", "passportIssueDate", "passportExpiryDate"];
  const data = object(value, [...fields, "pipelineId", "passportToken"]);
  for (const field of fields) if (data[field] !== void 0) text$2(data[field], 2e3);
  for (const required of ["fullName", "country", "visaType", "employee"]) text$2(data[required], 2e3);
  if (data.pipelineId !== void 0) id$1(data.pipelineId);
  if (data.passportToken !== void 0) text$2(data.passportToken, 64);
  return data;
}
function filename(value, kind) {
  const name2 = text$2(value, 180);
  const extension = node_path.extname(name2).toLowerCase();
  if (!name2 || /[\\/:*?"<>|\x00-\x1f]/.test(name2) || !(kind === "photo" ? [".jpg", ".jpeg", ".png"] : [".pdf", ".jpg", ".jpeg", ".png"]).includes(extension)) throw new Error("Unsupported file name.");
  return name2;
}
class LanCrm {
  constructor(db, root, docs, image) {
    this.db = db;
    this.root = root;
    this.docs = docs;
    this.image = image;
    this.photoDir = node_path.join(root, "customer-photos");
    setInterval(() => this.expire(), 6e4).unref();
  }
  uploads = /* @__PURE__ */ new Map();
  photoDir;
  execute(user, session, operation, args) {
    const count = (n) => {
      if (args.length !== n) throw new Error("Invalid action arguments.");
    };
    switch (operation) {
      case "applications:list":
        count(0);
        access$2(user, ["Visa Pipeline", "Reports", "Smart Scanner"]);
        return listApplications(this.db);
      case "applications:create":
        count(1);
        access$2(user, ["Dashboard", "Visa Pipeline"]);
        return this.create(user, session, applicationInput(args[0]));
      case "applications:move":
        count(2);
        access$2(user, pipeline);
        return moveApplication(this.db, id$1(args[0]), text$2(args[1], 80));
      case "applications:update":
        count(2);
        access$2(user, pipeline);
        return updateApplication(this.db, id$1(args[0]), applicationInput(args[1]));
      case "applications:delete":
        count(1);
        access$2(user, pipeline);
        return deleteApplication(this.db, id$1(args[0]));
      case "applications:activities:list":
        count(1);
        access$2(user, [...pipeline, ...customers]);
        return listApplicationActivities(this.db, id$1(args[0]));
      case "applications:activities:add": {
        count(2);
        access$2(user, [...pipeline, ...customers]);
        const value = object(args[1], ["activityType", "description"]);
        return addApplicationActivity(this.db, id$1(args[0]), { activityType: text$2(value.activityType, 32), description: text$2(value.description) });
      }
      case "customers:list":
        count(1);
        access$2(user, [...customers, ...pipeline]);
        return listCustomers(this.db, args[0] === null ? "" : text$2(args[0], 200)).map((customer) => ({ ...customer, photoDataUrl: this.photo(customer.id, 48) }));
      case "customers:get-profile": {
        count(1);
        access$2(user, [...customers, ...pipeline]);
        const profile = getCustomerProfile(this.db, id$1(args[0]));
        profile.customer.photoDataUrl = this.photo(profile.customer.id, 400);
        return profile;
      }
      case "customers:update": {
        count(2);
        access$2(user, customers);
        const fields = ["fullName", "passportNumber", "dateOfBirth", "nationality", "gender", "phone", "email", "address", "passportIssueDate", "passportExpiryDate"];
        const value = object(args[1], fields);
        for (const key of fields) text$2(value[key], 2e3);
        return updateCustomer(this.db, id$1(args[0]), value);
      }
      case "pipelines:list":
        count(0);
        access$2(user, ["Dashboard", ...pipeline, "Settings"]);
        return listPipelines(this.db);
      case "pipelines:save": {
        count(1);
        access$2(user, [...pipeline, "Settings"]);
        const value = object(args[0], ["id", "name", "stages"]);
        if (value.id !== void 0) id$1(value.id);
        const name2 = text$2(value.name, 80);
        if (!Array.isArray(value.stages) || value.stages.length > 30) throw new Error("Invalid stages.");
        const stages = value.stages.map((stage) => text$2(stage, 80));
        return savePipeline(this.db, { ...value.id === void 0 ? {} : { id: Number(value.id) }, name: name2, stages });
      }
      case "pipelines:delete":
        count(1);
        access$2(user, [...pipeline, "Settings"]);
        return deletePipeline(this.db, id$1(args[0]));
      case "catalog:list": {
        count(1);
        access$2(user, ["Dashboard", ...customers, ...pipeline, "Visa Types", "Countries", "Settings", "Smart Scanner"]);
        return listCatalog(this.db, this.catalog(args[0]));
      }
      case "catalog:save": {
        count(2);
        access$2(user, ["Visa Types", "Countries", "Settings"]);
        const value = object(args[1], ["id", "name", "active"]);
        if (value.id !== void 0) id$1(value.id);
        if (typeof value.active !== "boolean") throw new Error("Invalid catalog entry.");
        return saveCatalogItem(this.db, this.catalog(args[0]), { ...value.id === void 0 ? {} : { id: Number(value.id) }, name: text$2(value.name, 200), active: value.active });
      }
      case "catalog:delete":
        count(2);
        access$2(user, ["Visa Types", "Countries", "Settings"]);
        return deleteCatalogItem(this.db, this.catalog(args[0]), id$1(args[1]));
      case "documents:list":
        count(1);
        access$2(user, ["Visa Pipeline", "Documents"]);
        return this.db.prepare(`SELECT d.id, a.application_id AS applicationId, d.category, d.file_name AS fileName, d.added_at AS addedAt
          FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.application_id = ? AND a.deleted_at IS NULL ORDER BY d.added_at DESC`).all(id$1(args[0]));
      case "file:download": {
        count(3);
        const storage = text$2(args[0], 20);
        if (storage === "application") access$2(user, ["Visa Pipeline", "Documents"]);
        else if (storage === "customer") access$2(user, [...customers, "Documents"]);
        else throw new Error("Invalid document type.");
        if (!Number.isSafeInteger(args[2])) throw new Error("Invalid download offset.");
        return this.docs.download(storage, id$1(args[1]), args[2]);
      }
      case "file:begin":
        count(5);
        return this.begin(user, session, args);
      case "file:chunk":
        count(3);
        return this.chunk(user, session, args);
      case "file:finish":
        count(1);
        return this.finish(user, session, text$2(args[0], 64));
      case "file:cancel":
        count(1);
        this.pending(user, session, text$2(args[0], 64));
        this.uploads.delete(String(args[0]));
        return;
      default:
        throw new Error("Unsupported workspace action.");
    }
  }
  catalog(value) {
    if (value !== "visaType" && value !== "country") throw new Error("Invalid catalog.");
    return value;
  }
  photo(customerId, max) {
    const path = getCustomerPhotoPath(this.db, customerId);
    if (!path || !node_fs.existsSync(path) || !node_fs.existsSync(this.photoDir)) return null;
    try {
      const base = node_fs.realpathSync(this.photoDir);
      const actual = node_fs.realpathSync(path);
      const rel = node_path.relative(base, actual);
      if (!rel || rel === ".." || rel.startsWith(`..${node_path.sep}`) || node_path.isAbsolute(rel) || node_fs.statSync(actual).size > 10 * 1024 * 1024) return null;
      return `data:image/jpeg;base64,${this.image(node_fs.readFileSync(actual), max).toString("base64")}`;
    } catch {
      return null;
    }
  }
  begin(user, session, args) {
    const kind = args[0];
    if (kind !== "application" && kind !== "customer" && kind !== "photo" && kind !== "passport") throw new Error("Invalid upload type.");
    access$2(user, fileModules[kind]);
    this.expire();
    if (this.uploads.size >= 4 || Array.from(this.uploads.values()).some((item) => item.userId === user.id && item.session === session && !item.complete)) throw new Error("Too many uploads in progress.");
    const recordId = kind === "passport" ? null : id$1(args[1]);
    const related = args[2] === null ? null : id$1(args[2]);
    if (kind !== "customer" && related !== null) throw new Error("Invalid upload target.");
    if (kind === "passport" && args[1] !== null) throw new Error("Invalid upload target.");
    if (kind === "application" && !this.db.prepare("SELECT 1 FROM applications WHERE id = ? AND deleted_at IS NULL").get(recordId)) throw new Error("Application not found.");
    if ((kind === "customer" || kind === "photo") && !this.db.prepare("SELECT 1 FROM customers WHERE id = ?").get(recordId)) throw new Error("Customer not found.");
    if (related !== null && !this.db.prepare("SELECT 1 FROM applications WHERE id = ? AND customer_id = ? AND deleted_at IS NULL").get(related, recordId)) throw new Error("Application does not belong to this customer.");
    const name2 = filename(args[3], kind);
    const size = args[4];
    if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > (kind === "photo" ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE)) throw new Error("Invalid file size.");
    const token = node_crypto.randomUUID();
    this.uploads.set(token, { userId: user.id, session, kind, id: recordId, related, name: name2, size: Number(size), chunks: [], received: 0, expires: Date.now() + 5 * 6e4, complete: false });
    return token;
  }
  pending(user, session, token) {
    this.expire();
    const item = this.uploads.get(token);
    if (!item || item.userId !== user.id || item.session !== session) throw new Error("Upload expired. Choose the file again.");
    access$2(user, fileModules[item.kind]);
    return item;
  }
  chunk(user, session, args) {
    const item = this.pending(user, session, text$2(args[0], 64));
    const offset = args[1];
    const encoded = text$2(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4);
    if (item.complete || offset !== item.received || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid upload chunk.");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, item.size - item.received) || bytes.toString("base64") !== encoded) throw new Error("Invalid upload chunk.");
    item.chunks.push(bytes);
    item.received += bytes.length;
    item.expires = Date.now() + 5 * 6e4;
    return item.received;
  }
  finish(user, session, token) {
    const item = this.pending(user, session, token);
    if (item.complete || item.received !== item.size) throw new Error("Upload is incomplete.");
    if (item.kind === "passport") {
      item.complete = true;
      item.expires = Date.now() + 10 * 6e4;
      return { passportToken: token };
    }
    const data = Buffer.concat(item.chunks, item.size);
    this.uploads.delete(token);
    if (item.kind === "photo") {
      const image = this.image(data, 800);
      node_fs.mkdirSync(this.photoDir, { recursive: true });
      const path2 = node_path.join(this.photoDir, `${item.id}-${node_crypto.randomUUID()}.jpg`);
      const old = getCustomerPhotoPath(this.db, item.id);
      try {
        node_fs.writeFileSync(path2, image, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") node_fs.rmSync(path2, { force: true });
        throw error;
      }
      try {
        setCustomerPhotoPath(this.db, item.id, path2);
      } catch (error) {
        node_fs.rmSync(path2, { force: true });
        throw error;
      }
      if (old && node_fs.existsSync(old)) {
        try {
          const rel = node_path.relative(node_fs.realpathSync(this.photoDir), node_fs.realpathSync(old));
          if (rel && rel !== ".." && !rel.startsWith(`..${node_path.sep}`) && !node_path.isAbsolute(rel)) node_fs.rmSync(old, { force: true });
        } catch {
        }
      }
      return `data:image/jpeg;base64,${image.toString("base64")}`;
    }
    const directory = node_path.join(this.root, "documents", "lan-uploads");
    node_fs.mkdirSync(directory, { recursive: true });
    const path = node_path.join(directory, `${node_crypto.randomUUID()}${node_path.extname(item.name).toLowerCase()}`);
    try {
      node_fs.writeFileSync(path, data, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") node_fs.rmSync(path, { force: true });
      throw error;
    }
    try {
      return this.db.transaction(() => {
        if (item.kind === "application") {
          const app = this.db.prepare("SELECT application_id AS reference FROM applications WHERE id = ? AND deleted_at IS NULL").get(item.id);
          if (!app) throw new Error("Application not found.");
          const result2 = this.db.prepare("INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, 'Supporting Document', ?, ?)").run(item.id, item.name, path);
          this.db.prepare("INSERT INTO application_activities(application_id, activity_type, description) VALUES (?, 'Document Added', ?)").run(item.id, `Document uploaded: ${item.name}`);
          return { id: Number(result2.lastInsertRowid), applicationId: app.reference, category: "Supporting Document", fileName: item.name, addedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
        if (!this.db.prepare("SELECT 1 FROM customers WHERE id = ?").get(item.id)) throw new Error("Customer not found.");
        if (item.related !== null && !this.db.prepare("SELECT 1 FROM applications WHERE id = ? AND customer_id = ? AND deleted_at IS NULL").get(item.related, item.id)) throw new Error("Application does not belong to this customer.");
        const result = this.db.prepare("INSERT INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type) VALUES (?, ?, ?, ?, 'Supporting document')").run(item.id, item.related, item.name, path);
        return { id: Number(result.lastInsertRowid), applicationId: null, category: "Supporting document", fileName: item.name, addedAt: (/* @__PURE__ */ new Date()).toISOString(), applicationRecordId: item.related, storage: "customer" };
      })();
    } catch (error) {
      node_fs.rmSync(path, { force: true });
      throw error;
    }
  }
  create(user, session, input) {
    let path;
    const token = input.passportToken;
    if (token) {
      const item = this.pending(user, session, token);
      if (item.kind !== "passport" || !item.complete) throw new Error("Passport upload expired.");
      const directory = node_path.join(this.root, "documents", "passports");
      node_fs.mkdirSync(directory, { recursive: true });
      path = node_path.join(directory, `${node_crypto.randomUUID()}${node_path.extname(item.name).toLowerCase()}`);
      try {
        node_fs.writeFileSync(path, Buffer.concat(item.chunks, item.size), { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") node_fs.rmSync(path, { force: true });
        throw error;
      }
    }
    try {
      const { passportToken: _token, ...details2 } = input;
      const result = createApplication(this.db, details2, path);
      if (token) this.uploads.delete(token);
      return result;
    } catch (error) {
      if (path) node_fs.rmSync(path, { force: true });
      throw error;
    }
  }
  expire() {
    for (const [token, item] of this.uploads) if (item.expires < Date.now()) this.uploads.delete(token);
  }
}
const TTL = 12 * 60 * 6e4;
const extensions = [".pdf", ".jpg", ".jpeg", ".png"];
function id(value) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("Invalid record ID.");
  return Number(value);
}
function integer$1(value) {
  if (!Number.isSafeInteger(value)) throw new Error("Invalid number.");
  return Number(value);
}
function text$1(value, max = 2e3) {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text value.");
  return value;
}
function obj(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid details.");
  const record2 = value;
  if (Object.keys(record2).some((key) => !keys.includes(key))) throw new Error("Invalid details.");
  return record2;
}
function nullableText(value) {
  return value === null ? null : text$1(value, 200);
}
function name(value, photo = false) {
  const file = text$1(value, 180);
  if (!file || /[\\/:*?"<>|\x00-\x1f]/.test(file) || !extensions.includes(node_path.extname(file).toLowerCase()) || photo && node_path.extname(file).toLowerCase() === ".pdf") throw new Error("Unsupported file name.");
  return file;
}
class LanHr {
  constructor(db, root, image) {
    this.db = db;
    this.image = image;
    this.hrDir = node_path.join(root, "documents", "hr");
    setInterval(() => this.expire(), 6e4).unref();
  }
  unlocked = /* @__PURE__ */ new Map();
  uploads = /* @__PURE__ */ new Map();
  hrDir;
  execute(user, session, operation, args) {
    const key = `${user.id}:${session}`;
    if (!user.permissions.includes("Human Resources")) {
      this.unlocked.delete(key);
      this.removeUploads(user.id, session);
      throw new Error("You do not have permission for Human Resources.");
    }
    const count = (n) => {
      if (args.length !== n) throw new Error("Invalid action arguments.");
    };
    const admin = () => {
      if (user.role !== "admin") throw new Error("Only an administrator can manage HR security or user assignments.");
    };
    const unlock = () => {
      const version = this.version();
      if (!version) throw new Error("The HR password is not configured.");
      this.unlocked.set(key, { version, expires: Date.now() + TTL });
      if (this.unlocked.size > 1024) this.unlocked.delete(this.unlocked.keys().next().value);
    };
    switch (operation) {
      case "hr:auth:status":
        count(0);
        return { configured: isHrPasswordConfigured(this.db) };
      case "hr:auth:setup":
        count(1);
        admin();
        setInitialHrPassword(this.db, user.username, text$1(args[0], 256));
        this.unlocked.clear();
        this.uploads.clear();
        unlock();
        return;
      case "hr:auth:unlock":
        count(1);
        if (!isHrPasswordConfigured(this.db) || !verifyHrPassword(this.db, text$1(args[0], 256))) throw new Error("The HR password is incorrect.");
        unlock();
        return;
      case "hr:auth:reset":
        count(2);
        admin();
        if (!isHrPasswordConfigured(this.db)) throw new Error("The HR password is not configured.");
        if (!authenticate(this.db, user.username, text$1(args[0], 256))) throw new Error("The administrator password is incorrect.");
        resetHrPassword(this.db, user.username, text$1(args[1], 256));
        this.unlocked.clear();
        this.uploads.clear();
        unlock();
        return;
      case "hr:auth:lock":
        count(0);
        this.unlocked.delete(key);
        this.removeUploads(user.id, session);
        return;
    }
    const state = this.unlocked.get(key);
    if (!state || state.expires < Date.now() || state.version !== this.version()) {
      this.unlocked.delete(key);
      this.removeUploads(user.id, session);
      throw new Error("Unlock Human Resources with the HR password to continue.");
    }
    state.expires = Date.now() + TTL;
    const actor = user.displayName;
    switch (operation) {
      case "hr:auth:check":
        count(0);
        return true;
      case "hr:auth:change":
        count(2);
        admin();
        changeHrPassword(this.db, user.username, text$1(args[0], 256), text$1(args[1], 256));
        this.unlocked.clear();
        this.uploads.clear();
        unlock();
        return;
      case "hr:users:list":
        count(0);
        admin();
        return listApplicationUsers(this.db);
      case "hr:dashboard": {
        count(0);
        const now = /* @__PURE__ */ new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        return getHrDashboard(this.db, date);
      }
      case "hr:departments:list":
        count(0);
        return listHrDepartments(this.db);
      case "hr:departments:save": {
        count(1);
        const value = obj(args[0], ["id", "name", "description"]);
        return saveHrDepartment(this.db, actor, { ...value.id === void 0 ? {} : { id: id(value.id) }, name: text$1(value.name, 200), description: text$1(value.description) });
      }
      case "hr:employees:list":
        count(2);
        if (args[1] !== null && typeof args[1] !== "boolean") throw new Error("Invalid employee filters.");
        return listHrEmployees(this.db, args[0] === null ? "" : text$1(args[0], 200), args[1] === true).map((employee) => this.employee(employee, 48));
      case "hr:employees:profile": {
        count(1);
        const profile = getHrEmployeeProfileData(this.db, id(args[0]));
        return { ...profile, employee: this.employee(profile.employee, 320) };
      }
      case "hr:employees:save": {
        count(1);
        const fields = ["id", "fullName", "phone", "email", "departmentId", "jobTitle", "hireDate", "employmentType", "status", "hourlyRate", "workStart", "workEnd", "appUserId"];
        const value = obj(args[0], fields);
        for (const field of ["fullName", "phone", "email", "jobTitle", "hireDate", "employmentType", "status"]) text$1(value[field]);
        if (value.id !== void 0) id(value.id);
        if (value.departmentId !== null) id(value.departmentId);
        integer$1(value.hourlyRate);
        if (value.appUserId !== void 0) {
          admin();
          if (value.appUserId !== null) id(value.appUserId);
        }
        for (const field of ["workStart", "workEnd"]) if (value[field] !== void 0) nullableText(value[field]);
        return this.employee(saveHrEmployee(this.db, actor, value), 320);
      }
      case "hr:employees:archive":
        count(2);
        if (typeof args[1] !== "boolean") throw new Error("Invalid archive action.");
        return archiveHrEmployee(this.db, actor, id(args[0]), args[1]);
      case "hr:employees:delete":
        count(1);
        return this.deleteEmployee(actor, id(args[0]));
      case "hr:attendance:list":
        count(1);
        return listHrAttendance(this.db, text$1(args[0], 20));
      case "hr:attendance:calendar":
        count(3);
        return listHrAttendanceCalendar(this.db, integer$1(args[0]), integer$1(args[1]), args[2] === null ? void 0 : id(args[2]));
      case "hr:attendance:clock-in":
        count(1);
        return clockHrAttendance(this.db, actor, id(args[0]), "in");
      case "hr:attendance:clock-out":
        count(1);
        return clockHrAttendance(this.db, actor, id(args[0]), "out");
      case "hr:attendance:save": {
        count(1);
        const value = obj(args[0], ["employeeId", "attendanceDate", "checkIn", "checkOut", "status", "notes"]);
        return saveHrAttendance(this.db, actor, {
          employeeId: id(value.employeeId),
          attendanceDate: text$1(value.attendanceDate, 20),
          checkIn: nullableText(value.checkIn),
          checkOut: nullableText(value.checkOut),
          status: text$1(value.status, 50),
          notes: text$1(value.notes)
        });
      }
      case "hr:attendance:mark-all-present":
        count(1);
        return markAllHrEmployeesPresent(this.db, actor, text$1(args[0], 20));
      case "hr:leaves:list":
        count(1);
        return listHrLeaveRequests(this.db, args[0] === null ? void 0 : text$1(args[0], 50));
      case "hr:leaves:create": {
        count(1);
        const value = obj(args[0], ["employeeId", "leaveType", "startDate", "endDate", "totalDays", "reason"]);
        if (typeof value.totalDays !== "number" || !Number.isFinite(value.totalDays)) throw new Error("Invalid leave details.");
        return createHrLeaveRequest(this.db, actor, {
          employeeId: id(value.employeeId),
          leaveType: text$1(value.leaveType, 100),
          startDate: text$1(value.startDate, 20),
          endDate: text$1(value.endDate, 20),
          totalDays: value.totalDays,
          reason: text$1(value.reason)
        });
      }
      case "hr:leaves:decide":
        count(2);
        if (args[1] !== "Approved" && args[1] !== "Rejected") throw new Error("Invalid leave decision.");
        return decideHrLeaveRequest(this.db, actor, id(args[0]), args[1]);
      case "hr:leave-balances:list":
        count(1);
        return listHrLeaveBalances(this.db, integer$1(args[0]));
      case "hr:leave-balances:save": {
        count(1);
        const value = obj(args[0], ["employeeId", "leaveType", "year", "allocatedDays"]);
        if (typeof value.allocatedDays !== "number" || !Number.isFinite(value.allocatedDays)) throw new Error("Invalid leave balance.");
        return saveHrLeaveBalance(this.db, actor, {
          employeeId: id(value.employeeId),
          leaveType: text$1(value.leaveType, 100),
          year: integer$1(value.year),
          allocatedDays: value.allocatedDays
        });
      }
      case "hr:documents:list":
        count(1);
        return listHrDocuments(this.db, args[0] === null ? void 0 : id(args[0]));
      case "hr:candidates:list":
        count(0);
        return listHrCandidates(this.db);
      case "hr:candidates:create": {
        count(1);
        const value = obj(args[0], ["uploadId", "fullName", "phone", "email", "departmentId", "notes"]);
        const draft = {
          fullName: text$1(value.fullName, 120),
          phone: text$1(value.phone, 50),
          email: text$1(value.email, 200),
          departmentId: id(value.departmentId),
          notes: text$1(value.notes)
        };
        return this.createCandidate(user, session, text$1(value.uploadId, 64), draft);
      }
      case "hr:candidates:update": {
        count(1);
        const value = obj(args[0], ["id", "fullName", "phone", "email", "departmentId", "notes"]);
        return updateHrCandidate(this.db, actor, {
          id: id(value.id),
          fullName: text$1(value.fullName, 120),
          phone: text$1(value.phone, 50),
          email: text$1(value.email, 200),
          departmentId: id(value.departmentId),
          notes: text$1(value.notes)
        });
      }
      case "hr:candidates:star":
        count(2);
        if (typeof args[1] !== "boolean") throw new Error("Invalid candidate star setting.");
        return setHrCandidateStarred(this.db, actor, id(args[0]), args[1]);
      case "hr:payroll:list":
        count(0);
        return listHrPayrollPeriods(this.db);
      case "hr:payroll:calculate":
        count(3);
        return calculateHrPay(this.db, id(args[0]), text$1(args[1], 20), text$1(args[2], 20));
      case "hr:payroll:records:list":
        count(1);
        return listHrPayrollRecords(this.db, id(args[0]));
      case "hr:payroll:item:add": {
        count(2);
        const value = obj(args[1], ["itemType", "description", "amount"]);
        const type = text$1(value.itemType, 32);
        if (!["Bonus", "Allowance", "Deduction", "Advance Repayment", "Other Adjustment"].includes(type)) throw new Error("Invalid payroll item details.");
        return addHrPayrollItem(this.db, actor, id(args[0]), { itemType: type, description: text$1(value.description, 200), amount: integer$1(value.amount) });
      }
      case "hr:payroll:generate":
        count(2);
        return generateHrPayroll(this.db, actor, integer$1(args[0]), integer$1(args[1]));
      case "hr:payroll:approve":
        count(1);
        return approveHrPayroll(this.db, actor, id(args[0]));
      case "hr:payroll:paid":
        count(1);
        return markHrPayrollPaid(this.db, actor, id(args[0]));
      case "hr:reports:export": {
        count(1);
        const report = text$1(args[0], 20);
        if (!["employees", "attendance", "leaves", "payroll", "documents", "activity"].includes(report)) throw new Error("Unsupported HR report.");
        return buildHrCsvReport(this.db, report);
      }
      case "hr:file:begin":
        count(5);
        return this.begin(user, session, args);
      case "hr:file:chunk":
        count(3);
        return this.chunk(user, session, args);
      case "hr:file:finish":
        count(1);
        return this.finish(user, session, text$1(args[0], 64));
      case "hr:candidates:cancel-upload":
      case "hr:file:cancel":
        count(1);
        this.cancel(user, session, text$1(args[0], 64));
        return;
      case "hr:file:download":
        count(3);
        return this.download(text$1(args[0], 20), id(args[1]), integer$1(args[2]));
      default:
        throw new Error("Unsupported HR action.");
    }
  }
  version() {
    const row = this.db.prepare("SELECT salt, password_hash AS hash FROM hr_security_settings WHERE id = 1").get();
    return row ? `${row.salt}:${row.hash}` : "";
  }
  employee(record2, max) {
    const { photoPath, ...details2 } = record2;
    let photoDataUrl = null;
    if (photoPath && node_fs.existsSync(photoPath)) {
      try {
        const path = this.safePath(photoPath, node_path.join(this.hrDir, "employee-photos"));
        if (node_fs.statSync(path).size <= 10 * 1024 * 1024) photoDataUrl = `data:image/jpeg;base64,${this.image(node_fs.readFileSync(path), max).toString("base64")}`;
      } catch {
      }
    }
    return { ...details2, photoDataUrl };
  }
  safePath(path, directory) {
    const root = node_fs.realpathSync(directory);
    const resolved = node_fs.realpathSync(path);
    const rel = node_path.relative(root, resolved);
    if (!rel || rel === ".." || rel.startsWith(`..${node_path.sep}`) || node_path.isAbsolute(rel)) throw new Error("File is outside managed HR storage.");
    return resolved;
  }
  deleteEmployee(actor, employeeId) {
    const documentDir = node_path.resolve(this.hrDir, String(employeeId));
    const photoDir = node_path.resolve(this.hrDir, "employee-photos");
    const paths = getHrEmployeeStoredFilePaths(this.db, employeeId);
    for (const path of paths) {
      const absolute = node_path.resolve(path);
      const rel = node_path.relative(documentDir, absolute);
      const document = Boolean(rel) && rel !== ".." && !rel.startsWith(`..${node_path.sep}`) && !node_path.isAbsolute(rel);
      const photo = node_path.resolve(node_path.dirname(absolute)) === photoDir && node_path.basename(absolute).startsWith(`${employeeId}-`);
      if (!document && !photo) throw new Error("Employee files are outside managed HR storage; no data was deleted.");
      if (node_fs.existsSync(absolute)) this.safePath(absolute, document ? documentDir : photoDir);
    }
    const deleted = deleteHrEmployee(this.db, actor, employeeId);
    try {
      for (const path of deleted) node_fs.rmSync(path, { force: true });
    } catch {
      throw new Error("Employee data was deleted, but a stored HR file could not be removed.");
    }
  }
  begin(user, session, args) {
    const kind = args[0];
    if (kind !== "photo" && kind !== "document" && kind !== "candidate") throw new Error("Invalid upload type.");
    this.expire();
    if (this.uploads.size >= 4 || Array.from(this.uploads.values()).some((item) => item.userId === user.id && item.session === session && !item.complete)) throw new Error("Too many uploads in progress.");
    const employeeId = kind === "candidate" ? null : id(args[1]);
    if (kind === "candidate" && args[1] !== null) throw new Error("Invalid upload target.");
    if (employeeId !== null) getHrEmployeePhotoPath(this.db, employeeId);
    const file = name(args[2], kind === "photo");
    const size = integer$1(args[3]);
    if (size < 1 || size > (kind === "photo" ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE)) throw new Error("Invalid file size.");
    let metadata = null;
    if (kind === "document") {
      const value = obj(args[4], ["documentType", "issueDate", "expirationDate"]);
      metadata = {
        documentType: text$1(value.documentType, 80),
        ...value.issueDate === void 0 ? {} : { issueDate: text$1(value.issueDate, 20) },
        ...value.expirationDate === void 0 ? {} : { expirationDate: text$1(value.expirationDate, 20) }
      };
    } else if (args[4] !== null) throw new Error("Invalid upload details.");
    const token = node_crypto.randomUUID();
    this.uploads.set(token, { userId: user.id, session, kind, employeeId, name: file, size, chunks: [], received: 0, complete: false, expires: Date.now() + 5 * 6e4, metadata });
    return token;
  }
  pending(user, session, token) {
    this.expire();
    const upload = this.uploads.get(token);
    if (!upload || upload.userId !== user.id || upload.session !== session) throw new Error("Upload expired. Choose the file again.");
    return upload;
  }
  cancel(user, session, token) {
    this.expire();
    const upload = this.uploads.get(token);
    if (!upload) return;
    if (upload.userId !== user.id || upload.session !== session) throw new Error("Upload expired. Choose the file again.");
    this.uploads.delete(token);
  }
  chunk(user, session, args) {
    const upload = this.pending(user, session, text$1(args[0], 64));
    const encoded = text$1(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4);
    if (upload.complete || args[1] !== upload.received || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Invalid upload chunk.");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, upload.size - upload.received) || bytes.toString("base64") !== encoded) throw new Error("Invalid upload chunk.");
    upload.chunks.push(bytes);
    upload.received += bytes.length;
    upload.expires = Date.now() + 5 * 6e4;
    return upload.received;
  }
  finish(user, session, token) {
    const upload = this.pending(user, session, token);
    if (upload.complete || upload.received !== upload.size) throw new Error("Upload is incomplete.");
    if (upload.kind === "candidate") {
      upload.complete = true;
      upload.expires = Date.now() + 10 * 6e4;
      return { uploadId: token, fileName: upload.name };
    }
    this.uploads.delete(token);
    const directory = upload.kind === "photo" ? node_path.join(this.hrDir, "employee-photos") : node_path.join(this.hrDir, String(upload.employeeId));
    node_fs.mkdirSync(directory, { recursive: true });
    const filePath = node_path.join(directory, upload.kind === "photo" ? `${upload.employeeId}-${node_crypto.randomUUID()}.jpg` : `${node_crypto.randomUUID()}${node_path.extname(upload.name).toLowerCase()}`);
    const bytes = Buffer.concat(upload.chunks, upload.size);
    const content = upload.kind === "photo" ? this.image(bytes, 800) : bytes;
    const preview = upload.kind === "photo" ? this.image(content, 320) : null;
    this.writeNew(filePath, content);
    try {
      if (upload.kind === "photo") {
        setHrEmployeePhotoPath(this.db, user.displayName, upload.employeeId, filePath);
        return `data:image/jpeg;base64,${preview.toString("base64")}`;
      }
      return addHrDocument(this.db, user.displayName, { employeeId: upload.employeeId, documentName: upload.name, ...upload.metadata, filePath });
    } catch (error) {
      node_fs.rmSync(filePath, { force: true });
      throw error;
    }
  }
  createCandidate(user, session, token, draft) {
    const upload = this.pending(user, session, token);
    if (upload.kind !== "candidate" || !upload.complete) throw new Error("Candidate upload expired.");
    const directory = node_path.join(this.hrDir, "cvs");
    node_fs.mkdirSync(directory, { recursive: true });
    const path = node_path.join(directory, `${node_crypto.randomUUID()}${node_path.extname(upload.name).toLowerCase()}`);
    this.writeNew(path, Buffer.concat(upload.chunks, upload.size));
    try {
      const result = addHrCandidate(this.db, user.displayName, draft, upload.name, path);
      this.uploads.delete(token);
      return result;
    } catch (error) {
      node_fs.rmSync(path, { force: true });
      throw error;
    }
  }
  download(kind, recordId, offset) {
    if (kind !== "document" && kind !== "candidate") throw new Error("Invalid document type.");
    if (offset < 0 || offset > DOCUMENT_MAX_SIZE || offset % DOCUMENT_CHUNK_SIZE !== 0) throw new Error("Invalid download offset.");
    const row = kind === "document" ? this.db.prepare("SELECT document_name AS name, employee_id AS employeeId FROM hr_employee_documents WHERE id = ?").get(recordId) : this.db.prepare("SELECT file_name AS name FROM hr_candidates WHERE id = ?").get(recordId);
    if (!row) throw new Error("HR file not found.");
    const fileName = name(node_path.basename(row.name));
    const path = kind === "document" ? getHrDocumentPath(this.db, recordId) : getHrCandidateFilePath(this.db, recordId);
    const safe = this.safePath(path, kind === "document" ? node_path.join(this.hrDir, String(id(row.employeeId))) : node_path.join(this.hrDir, "cvs"));
    if (!extensions.includes(node_path.extname(safe).toLowerCase())) throw new Error("Unsupported document format.");
    const details2 = node_fs.statSync(safe);
    if (!details2.isFile() || details2.size < 1 || details2.size > DOCUMENT_MAX_SIZE || offset >= details2.size) throw new Error("Document is unavailable or exceeds 25 MB.");
    const descriptor = node_fs.openSync(safe, "r");
    try {
      const bytes = Buffer.alloc(Math.min(DOCUMENT_CHUNK_SIZE, details2.size - offset));
      if (node_fs.readSync(descriptor, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error("Document changed during download.");
      return { name: fileName, size: details2.size, data: bytes.toString("base64") };
    } finally {
      node_fs.closeSync(descriptor);
    }
  }
  writeNew(path, data) {
    try {
      node_fs.writeFileSync(path, data, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") node_fs.rmSync(path, { force: true });
      throw error;
    }
  }
  removeUploads(userId, session) {
    for (const [token, upload] of this.uploads) if (upload.userId === userId && upload.session === session) this.uploads.delete(token);
  }
  expire() {
    for (const [key, state] of this.unlocked) if (state.expires < Date.now()) this.unlocked.delete(key);
    for (const [key, upload] of this.uploads) if (upload.expires < Date.now()) this.uploads.delete(key);
  }
}
const backupLimit = 1024 * 1024 * 1024;
const backupTtl = 30 * 6e4;
function access$1(user, modules) {
  if (!modules.some((module2) => user.permissions.includes(module2))) throw new Error("You do not have permission for this action.");
}
function administrator(user) {
  access$1(user, ["Settings"]);
  if (user.role !== "admin") throw new Error("Only an administrator can manage application users or create a shared backup.");
}
function integer(value) {
  if (!Number.isSafeInteger(value)) throw new Error("Invalid number.");
  return Number(value);
}
function text(value, limit) {
  if (typeof value !== "string" || value.length > limit) throw new Error("Invalid text value.");
  return value;
}
function details(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Invalid details.");
  return value;
}
class LanWorkspace {
  constructor(db, root, image, requireHrUnlock) {
    this.db = db;
    this.root = root;
    this.image = image;
    this.requireHrUnlock = requireHrUnlock;
    this.branding = node_path.join(root, "branding");
    this.backupDirectory = node_path.join(root, "lan-backups");
    if (node_fs.existsSync(this.backupDirectory)) {
      for (const name2 of node_fs.readdirSync(this.backupDirectory)) {
        if (/^lan-[a-f0-9-]{36}\.(zip|db)$/.test(name2)) node_fs.rmSync(node_path.join(this.backupDirectory, name2), { force: true });
      }
    }
    setInterval(() => this.expire(), 6e4).unref();
  }
  logos = /* @__PURE__ */ new Map();
  backups = /* @__PURE__ */ new Map();
  branding;
  backupDirectory;
  execute(user, session, operation, args) {
    const count = (n) => {
      if (args.length !== n) throw new Error("Invalid action arguments.");
    };
    switch (operation) {
      case "dashboard":
        count(0);
        access$1(user, ["Dashboard", "Reports"]);
        return getDashboard(this.db);
      case "reports:csv": {
        count(0);
        access$1(user, ["Reports"]);
        const escape = (value) => {
          let cell = String(value ?? "");
          if (/^[\s]*[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
          return `"${cell.replace(/"/g, '""')}"`;
        };
        return "\uFEFF" + [
          "Application ID,Customer,Phone,Country,Visa Type,Status,Employee,Application Date,Follow-up Date",
          ...listApplications(this.db).map((row) => [
            row.applicationId,
            row.customerName,
            row.phone,
            row.country,
            row.visaType,
            row.status,
            row.employee,
            row.applicationDate,
            row.followUpDate
          ].map(escape).join(","))
        ].join("\r\n");
      }
      case "settings:get":
        count(0);
        return this.settings();
      case "settings:save": {
        count(1);
        access$1(user, ["Settings"]);
        const value = details(args[0], ["companyName", "language"]);
        const company = text(value.companyName, 200).trim();
        if (company.length < 2 || value.language !== "en" && value.language !== "ar") throw new Error("Invalid settings.");
        this.db.transaction(() => {
          this.db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)").run("companyName", company);
          this.db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)").run("language", value.language);
        })();
        return;
      }
      case "settings:users:list":
        count(0);
        administrator(user);
        return listApplicationUsers(this.db);
      case "settings:users:create":
        count(1);
        administrator(user);
        details(args[0], ["username", "displayName", "role", "password", "permissions"]);
        return createApplicationUser(this.db, args[0]);
      case "settings:users:update":
        count(1);
        administrator(user);
        details(args[0], ["id", "username", "displayName", "role", "password", "permissions"]);
        return updateApplicationUser(this.db, user.id, args[0]);
      case "settings:users:delete":
        count(1);
        administrator(user);
        return deleteApplicationUser(this.db, user.id, integer(args[0]));
      case "scanner:authorize":
        count(1);
        access$1(user, args[0] === "standalone" ? ["Smart Scanner"] : args[0] === "inspect" ? ["Smart Scanner", "Visa Pipeline"] : []);
        return true;
      case "logo:begin": {
        count(1);
        access$1(user, ["Settings"]);
        this.expire();
        const size = integer(args[0]);
        if (size < 1 || size > 5 * 1024 * 1024 || this.logos.size >= 4) throw new Error("Invalid logo upload.");
        const token = node_crypto.randomUUID();
        this.logos.set(token, { userId: user.id, session, size, received: 0, chunks: [], expires: Date.now() + 5 * 6e4 });
        return token;
      }
      case "logo:chunk": {
        count(3);
        access$1(user, ["Settings"]);
        const upload = this.logo(user, session, text(args[0], 64));
        const encoded = text(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4);
        const bytes = Buffer.from(encoded, "base64");
        if (args[1] !== upload.received || bytes.toString("base64") !== encoded || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, upload.size - upload.received)) throw new Error("Invalid logo chunk.");
        upload.chunks.push(bytes);
        upload.received += bytes.length;
        upload.expires = Date.now() + 5 * 6e4;
        return upload.received;
      }
      case "logo:finish": {
        count(1);
        access$1(user, ["Settings"]);
        const token = text(args[0], 64);
        const upload = this.logo(user, session, token);
        if (upload.received !== upload.size) throw new Error("Upload is incomplete.");
        const image = this.image(Buffer.concat(upload.chunks, upload.size), 800);
        node_fs.mkdirSync(this.branding, { recursive: true });
        const path = node_path.join(this.branding, `company-logo-${node_crypto.randomUUID()}.png`);
        node_fs.writeFileSync(path, image, { flag: "wx" });
        const old = this.logoPath();
        try {
          this.db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('companyLogoPath', ?)").run(path);
        } catch (error) {
          node_fs.rmSync(path, { force: true });
          throw error;
        }
        this.logos.delete(token);
        this.removeOldLogo(old);
        return `data:image/png;base64,${image.toString("base64")}`;
      }
      case "logo:cancel":
        count(1);
        access$1(user, ["Settings"]);
        this.logo(user, session, text(args[0], 64));
        this.logos.delete(String(args[0]));
        return;
      case "settings:remove-logo": {
        count(0);
        access$1(user, ["Settings"]);
        const old = this.logoPath();
        this.db.prepare("DELETE FROM app_settings WHERE key = 'companyLogoPath'").run();
        this.removeOldLogo(old);
        return;
      }
      case "backup:begin":
        count(0);
        administrator(user);
        this.requireHrUnlock(user, session);
        return this.beginBackup(user, session);
      case "backup:status": {
        count(1);
        administrator(user);
        this.requireHrUnlock(user, session);
        const item = this.backup(user, session, text(args[0], 64));
        if (item.state === "failed") throw new Error("The host could not create the backup.");
        return { state: item.state, ...item.state === "ready" ? { size: item.size, hash: item.hash } : {} };
      }
      case "backup:chunk": {
        count(2);
        administrator(user);
        this.requireHrUnlock(user, session);
        const item = this.backup(user, session, text(args[0], 64));
        const offset = integer(args[1]);
        if (item.state !== "ready" || offset < 0 || offset >= item.size || offset % DOCUMENT_CHUNK_SIZE !== 0) throw new Error("Invalid backup offset.");
        const handle = node_fs.openSync(item.zip, "r");
        try {
          const bytes = Buffer.alloc(Math.min(DOCUMENT_CHUNK_SIZE, item.size - offset));
          if (node_fs.readSync(handle, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error("Backup changed during download.");
          return bytes.toString("base64");
        } finally {
          node_fs.closeSync(handle);
        }
      }
      case "backup:release": {
        count(1);
        administrator(user);
        const token = text(args[0], 64);
        const item = this.backups.get(token);
        if (item && (item.userId !== user.id || item.session !== session)) throw new Error("Backup expired.");
        if (item) this.discard(token, item);
        return;
      }
      default:
        throw new Error("Unsupported workspace action.");
    }
  }
  logoPath() {
    return this.db.prepare("SELECT value FROM app_settings WHERE key = 'companyLogoPath'").get()?.value ?? "";
  }
  safeLogo(path) {
    const rel = node_path.relative(node_fs.realpathSync(this.branding), node_fs.realpathSync(path));
    if (!rel || rel === ".." || rel.startsWith(`..${node_path.sep}`) || node_path.isAbsolute(rel)) throw new Error("Logo is outside managed branding storage.");
    return node_fs.realpathSync(path);
  }
  removeOldLogo(path) {
    if (path && node_fs.existsSync(path)) {
      try {
        node_fs.rmSync(this.safeLogo(path), { force: true });
      } catch {
      }
    }
  }
  settings() {
    const values = Object.fromEntries(this.db.prepare("SELECT key, value FROM app_settings").all().map(({ key, value }) => [key, value]));
    let companyLogoDataUrl = null;
    try {
      const path = this.safeLogo(values.companyLogoPath);
      if (node_fs.statSync(path).size <= 5 * 1024 * 1024 && [".png", ".jpg", ".jpeg"].includes(node_path.extname(path).toLowerCase())) {
        companyLogoDataUrl = `data:image/png;base64,${this.image(node_fs.readFileSync(path), 800).toString("base64")}`;
      }
    } catch {
    }
    return { companyName: values.companyName ?? "Blue Line Travel", language: values.language === "ar" ? "ar" : "en", companyLogoDataUrl };
  }
  logo(user, session, token) {
    this.expire();
    const item = this.logos.get(token);
    if (!item || item.userId !== user.id || item.session !== session) throw new Error("Upload expired. Choose the file again.");
    return item;
  }
  beginBackup(user, session) {
    this.expire();
    if (this.backups.size >= 1) throw new Error("A shared backup is already in progress.");
    node_fs.mkdirSync(this.backupDirectory, { recursive: true });
    const token = node_crypto.randomUUID();
    const item = {
      userId: user.id,
      session,
      zip: node_path.join(this.backupDirectory, `lan-${token}.zip`),
      snapshot: node_path.join(this.backupDirectory, `lan-${token}.db`),
      state: "building",
      size: 0,
      hash: "",
      expires: Date.now() + backupTtl,
      cancelled: false
    };
    this.backups.set(token, item);
    void this.createBackup(item).then(() => {
      if (item.cancelled) {
        this.cleanup(item);
        this.backups.delete(token);
      } else {
        item.state = "ready";
        item.expires = Date.now() + backupTtl;
      }
    }).catch(() => {
      this.cleanup(item);
      if (item.cancelled) this.backups.delete(token);
      else {
        item.state = "failed";
        item.expires = Date.now() + 6e4;
      }
    });
    return token;
  }
  backup(user, session, token) {
    this.expire();
    const item = this.backups.get(token);
    if (!item || item.cancelled || item.userId !== user.id || item.session !== session) throw new Error("Backup expired.");
    item.expires = Date.now() + backupTtl;
    return item;
  }
  discard(token, item) {
    item.cancelled = true;
    if (item.state !== "building") {
      this.backups.delete(token);
      this.cleanup(item);
    }
  }
  cleanup(item) {
    for (const path of [item.snapshot, item.zip]) {
      try {
        node_fs.rmSync(path, { force: true });
      } catch {
      }
    }
  }
  expire() {
    const now = Date.now();
    for (const [token, item] of this.logos) if (item.expires < now) this.logos.delete(token);
    for (const [token, item] of this.backups) if (item.expires < now) this.discard(token, item);
  }
  async createBackup(item) {
    await this.db.backup(item.snapshot);
    const zip = new yazl.ZipFile();
    let zipFailure;
    zip.outputStream.on("error", (error) => {
      zipFailure = error;
    });
    let total = (await promises.stat(item.snapshot)).size;
    let count = 0;
    const addDirectory = async (directory, prefix) => {
      if (!node_fs.existsSync(directory)) return;
      for (const entry of await promises.readdir(directory, { withFileTypes: true })) {
        const path = node_path.join(directory, entry.name);
        const archive = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) await addDirectory(path, archive);
        else if (entry.isFile()) {
          total += (await promises.stat(path)).size;
          if (++count > 1e5 || total > backupLimit) throw new Error("Backup is too large.");
          zip.addFile(path, archive);
        } else throw new Error("Backup contains unsupported filesystem entries.");
      }
    };
    try {
      zip.addFile(item.snapshot, "database/blueline.db");
      await addDirectory(node_path.join(this.root, "documents"), "documents");
      await addDirectory(node_path.join(this.root, "customer-photos"), "customer-photos");
      await addDirectory(node_path.join(this.root, "branding"), "branding");
      if (total > backupLimit) throw new Error("Backup is too large.");
      if (zipFailure) throw zipFailure;
      zip.addBuffer(Buffer.from(JSON.stringify({ product: "Blue Line Visa CRM", createdAt: (/* @__PURE__ */ new Date()).toISOString(), format: 1 }, null, 2)), "backup.json");
      const completion = promises$1.pipeline(zip.outputStream, node_fs.createWriteStream(item.zip, { flags: "wx" }));
      zip.end();
      await completion;
      await promises.rm(item.snapshot, { force: true });
      item.size = (await promises.stat(item.zip)).size;
      if (item.size < 1 || item.size > backupLimit) throw new Error("Backup is too large.");
      const hash = node_crypto.createHash("sha256");
      await new Promise((resolve, reject) => {
        const stream = node_fs.createReadStream(item.zip);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", resolve);
      });
      item.hash = hash.digest("hex");
    } catch (error) {
      throw error;
    }
  }
}
function access(user) {
  if (!user.permissions.some((module2) => module2 === "Smart Scanner" || module2 === "Visa Pipeline")) throw new Error("You do not have permission for this action.");
}
function string(value, max) {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid scanner input.");
  return value;
}
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error("Invalid scanner input.");
  return value;
}
function extraction(value) {
  const input = record(value, ["profile", "fields", "assessments"]);
  if (input.profile !== "iraqi") throw new Error("Invalid scanner input.");
  const fields = record(input.fields, passportFieldNames);
  const assessments = record(input.assessments, passportFieldNames);
  const result = { profile: "iraqi", fields: {}, assessments: {} };
  for (const name2 of passportFieldNames) {
    const assessment = record(assessments[name2], ["value", "confidence", "sources", "needsReview", "conflict"]);
    if (typeof assessment.confidence !== "number" || !Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 100 || !Array.isArray(assessment.sources) || assessment.sources.length > 2 || assessment.sources.some((source) => source !== "visible" && source !== "mrz") || typeof assessment.needsReview !== "boolean" || typeof assessment.conflict !== "boolean") throw new Error("Invalid scanner input.");
    result.fields[name2] = string(fields[name2], 2e3);
    result.assessments[name2] = {
      value: string(assessment.value, 2e3),
      confidence: assessment.confidence,
      sources: assessment.sources,
      needsReview: assessment.needsReview,
      conflict: assessment.conflict
    };
  }
  return result;
}
class LanGemini {
  constructor(root, available, inspect) {
    this.available = available;
    this.inspect = inspect;
    this.directory = node_path.join(root, "lan-gemini-scans");
    if (node_fs.existsSync(this.directory)) {
      for (const name2 of node_fs.readdirSync(this.directory)) if (/^scan-[a-f0-9-]{36}\.(pdf|jpg|jpeg|png)$/.test(name2)) node_fs.rmSync(node_path.join(this.directory, name2), { force: true });
    }
    setInterval(() => this.expire(), 6e4).unref();
  }
  jobs = /* @__PURE__ */ new Map();
  directory;
  async execute(user, session, operation, args) {
    access(user);
    const count = (n) => {
      if (args.length !== n) throw new Error("Invalid action arguments.");
    };
    switch (operation) {
      case "availability":
        count(0);
        return { configured: await this.available() };
      case "begin": {
        count(2);
        this.expire();
        if (!await this.available()) throw new Error("Gemini is not configured on the office server.");
        if (this.jobs.size >= 1) throw new Error("A shared Gemini scan is already in progress.");
        const name2 = string(args[0], 180);
        const extension = node_path.extname(name2).toLowerCase();
        if (!name2 || /[\\/:*?"<>|\x00-\x1f]/.test(name2) || ![".jpg", ".jpeg", ".png", ".pdf"].includes(extension) || !Number.isSafeInteger(args[1]) || Number(args[1]) < 1 || Number(args[1]) > DOCUMENT_MAX_SIZE) throw new Error("Invalid scanner input.");
        const token = node_crypto.randomUUID();
        const mime = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : "image/jpeg";
        this.jobs.set(token, {
          userId: user.id,
          session,
          size: Number(args[1]),
          received: 0,
          chunks: [],
          extension,
          mime,
          path: node_path.join(this.directory, `scan-${token}${extension}`),
          expires: Date.now() + 5 * 6e4,
          cancelled: false,
          state: "uploading"
        });
        return token;
      }
      case "chunk": {
        count(3);
        const item = this.job(user, session, string(args[0], 64));
        const encoded = string(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4);
        const bytes = Buffer.from(encoded, "base64");
        if (item.state !== "uploading" || item.received >= item.size || args[1] !== item.received || bytes.toString("base64") !== encoded || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, item.size - item.received)) throw new Error("Invalid scanner upload chunk.");
        item.chunks.push(bytes);
        item.received += bytes.length;
        return item.received;
      }
      case "finish": {
        count(2);
        const token = string(args[0], 64);
        const item = this.job(user, session, token);
        const local = extraction(args[1]);
        if (item.state !== "uploading" || item.received !== item.size) throw new Error("Upload is incomplete.");
        node_fs.mkdirSync(this.directory, { recursive: true });
        node_fs.writeFileSync(item.path, Buffer.concat(item.chunks, item.size), { flag: "wx" });
        item.chunks = [];
        item.state = "processing";
        void this.inspect(item.path, item.mime, local).then((result) => {
          if (!item.cancelled) {
            item.result = result;
            item.state = "ready";
            item.expires = Date.now() + 5 * 6e4;
          }
        }).catch(() => {
          if (!item.cancelled) {
            item.state = "failed";
            item.expires = Date.now() + 6e4;
          }
        }).finally(() => {
          try {
            node_fs.rmSync(item.path, { force: true });
          } catch {
          }
          if (item.cancelled) this.jobs.delete(token);
        });
        return;
      }
      case "status": {
        count(1);
        const item = this.job(user, session, string(args[0], 64));
        if (item.state === "failed") throw new Error("The office server could not complete the Gemini scan.");
        if (item.state === "uploading") throw new Error("Upload is incomplete.");
        return { state: item.state, ...item.result ? { result: item.result } : {} };
      }
      case "cancel": {
        count(1);
        const token = string(args[0], 64);
        const item = this.jobs.get(token);
        if (!item) return;
        if (item.userId !== user.id || item.session !== session) throw new Error("Scan expired.");
        this.discard(token, item);
        return;
      }
      default:
        throw new Error("Unsupported scanner action.");
    }
  }
  job(user, session, token) {
    this.expire();
    const item = this.jobs.get(token);
    if (!item || item.cancelled || item.userId !== user.id || item.session !== session) throw new Error("Scan expired.");
    item.expires = Date.now() + 5 * 6e4;
    return item;
  }
  discard(token, item) {
    item.cancelled = true;
    item.chunks = [];
    if (item.state !== "processing") {
      this.jobs.delete(token);
      try {
        node_fs.rmSync(item.path, { force: true });
      } catch {
      }
    }
  }
  expire() {
    const now = Date.now();
    for (const [token, item] of this.jobs) if (item.expires < now) this.discard(token, item);
  }
}
const setupCodePrefix = "BLUELINE-OFFICE-1";
function isValidHost(host) {
  if (!host || host.length > 253 || host.startsWith(".") || host.endsWith(".")) return false;
  return host.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label));
}
function parseOfficeServerAddress(value) {
  if (typeof value !== "string" || value.length > 300) throw new Error("Enter a valid HTTPS office server address.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter the server address as https://host:port.");
  }
  if (url.protocol !== "https:" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !isValidHost(url.hostname)) {
    throw new Error("Enter the server address as https://host:port.");
  }
  const port = Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Server port must be between 1024 and 65535.");
  }
  return { host: url.hostname, port };
}
function normalizeServerFingerprint(value) {
  if (typeof value !== "string") throw new Error("Enter the server SHA-256 certificate fingerprint.");
  const fingerprint = value.trim().replace(/:/g, "").toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(fingerprint)) throw new Error("Enter a valid 64-character SHA-256 certificate fingerprint.");
  return fingerprint;
}
function buildClientSetupCode(host, port, fingerprint) {
  if (!isValidHost(host) || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid office server address.");
  }
  const normalizedFingerprint = normalizeServerFingerprint(fingerprint);
  return `${setupCodePrefix}|https://${host}:${port}|${normalizedFingerprint}`;
}
electron.app.setName("BlueLineVisaCRM");
process.on("uncaughtException", (error) => {
  recordDiagnostic("main-uncaught-exception", error, true);
  electron.app.exit(1);
});
process.on("unhandledRejection", (reason) => {
  recordDiagnostic("main-unhandled-rejection", reason, true);
  electron.app.exit(1);
});
const hasSingleInstanceLock = electron.app.requestSingleInstanceLock();
const pendingPassports = /* @__PURE__ */ new Map();
const passportOcrWorkers = /* @__PURE__ */ new Map();
const pendingHrCandidateUploads = /* @__PURE__ */ new Map();
let authenticatedUser = null;
let clientCredentials = null;
let clientSession = null;
let hrUnlocked = false;
let mainWindow = null;
let passportOcrQueue = Promise.resolve();
if (!hasSingleInstanceLock) electron.app.quit();
else electron.app.on("second-instance", () => {
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
function isMainWindowEvent(event) {
  return mainWindow !== null && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame;
}
async function createOfficeServerCertificate(root, bindAddress) {
  const generated = await selfsigned.generate([{ name: "commonName", value: bindAddress }], {
    keyType: "rsa",
    keySize: 3072,
    algorithm: "sha256",
    notAfterDate: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1e3),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 7, ip: bindAddress }] }
    ]
  });
  node_tls.createSecureContext({ key: generated.private, cert: generated.cert, minVersion: "TLSv1.2" });
  const directory = node_path.join(root, "lan-server");
  await promises.mkdir(directory, { recursive: true });
  const keyPath = node_path.join(directory, "key.pem");
  const certificatePath = node_path.join(directory, "cert.pem");
  const suffix = node_crypto.randomUUID();
  const pendingKey = node_path.join(directory, `${suffix}.key.tmp`);
  const pendingCertificate = node_path.join(directory, `${suffix}.cert.tmp`);
  const previousKey = node_path.join(directory, `${suffix}.key.previous`);
  const previousCertificate = node_path.join(directory, `${suffix}.cert.previous`);
  await promises.writeFile(pendingKey, generated.private, { encoding: "utf8", mode: 384, flag: "wx" });
  await promises.writeFile(pendingCertificate, generated.cert, { encoding: "utf8", mode: 384, flag: "wx" });
  let keyMoved = false;
  let certificateMoved = false;
  let keyInstalled = false;
  let certificateInstalled = false;
  try {
    if (node_fs.existsSync(keyPath)) {
      await promises.rename(keyPath, previousKey);
      keyMoved = true;
    }
    if (node_fs.existsSync(certificatePath)) {
      await promises.rename(certificatePath, previousCertificate);
      certificateMoved = true;
    }
    await promises.rename(pendingKey, keyPath);
    keyInstalled = true;
    await promises.rename(pendingCertificate, certificatePath);
    certificateInstalled = true;
  } catch (error) {
    if (certificateInstalled) await promises.rm(certificatePath, { force: true });
    if (keyInstalled) await promises.rm(keyPath, { force: true });
    if (keyMoved) await promises.rename(previousKey, keyPath);
    if (certificateMoved) await promises.rename(previousCertificate, certificatePath);
    throw new Error(`Unable to save the office server certificate: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await promises.rm(pendingKey, { force: true });
    await promises.rm(pendingCertificate, { force: true });
  }
  await promises.rm(previousKey, { force: true });
  await promises.rm(previousCertificate, { force: true });
}
async function verifyOfficeServerCertificate(root) {
  try {
    node_tls.createSecureContext({
      key: await promises.readFile(node_path.join(root, "lan-server", "key.pem"), "utf8"),
      cert: await promises.readFile(node_path.join(root, "lan-server", "cert.pem"), "utf8"),
      minVersion: "TLSv1.2"
    });
  } catch (error) {
    throw new Error(`A valid office server certificate is required. Select “Create a new server certificate” or fix the existing certificate: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function installApplicationMenu(config, getFingerprint) {
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate([
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [{
        label: "Copy Client Setup Code",
        enabled: config.mode === "server",
        click: () => {
          if (config.mode !== "server") return;
          const fingerprint = getFingerprint();
          if (!fingerprint) {
            electron.dialog.showErrorBox("Office server is not ready", "The client setup code is unavailable until the server has started.");
            return;
          }
          electron.clipboard.writeText(buildClientSetupCode(config.bindAddress, config.port, fingerprint));
        }
      }]
    }
  ]));
}
function modulesForChannel(channel) {
  if (channel.startsWith("hr:")) return ["Human Resources"];
  if (channel === "dashboard") return ["Dashboard", "Reports"];
  if (channel.startsWith("attendance:self:")) return ["My Attendance", "Dashboard"];
  if (channel === "applications:list") return ["Visa Pipeline", "Reports", "Smart Scanner"];
  if (channel === "applications:create") return ["Dashboard", "Visa Pipeline"];
  if (channel.startsWith("applications:activities:")) return ["Visa Pipeline", "CRM", "Customers", "DATA"];
  if (channel.startsWith("applications:")) return ["Visa Pipeline"];
  if (channel === "customers:list") return ["CRM", "Customers", "DATA", "Visa Pipeline"];
  if (channel === "customers:get-profile") return ["CRM", "Customers", "DATA", "Visa Pipeline"];
  if (channel === "customer-documents:open") return ["CRM", "Customers", "DATA", "Documents"];
  if (channel.startsWith("customers:") || channel.startsWith("customer-documents:")) return ["CRM", "Customers", "DATA"];
  if (channel === "pipelines:list") return ["Dashboard", "Visa Pipeline", "Settings"];
  if (channel.startsWith("pipelines:")) return ["Visa Pipeline", "Settings"];
  if (channel === "catalog:list") return ["Dashboard", "Visa Pipeline", "CRM", "Customers", "DATA", "Visa Types", "Countries", "Settings", "Smart Scanner"];
  if (channel.startsWith("catalog:")) return ["Visa Types", "Countries", "Settings"];
  if (channel === "documents:list-all") return ["Documents"];
  if (channel.startsWith("documents:")) return ["Documents", "Visa Pipeline"];
  if (channel.startsWith("settings:users:")) return ["Settings"];
  if (channel.startsWith("settings:")) return ["Settings"];
  if (channel.startsWith("gemini:")) return ["Gemini API"];
  if (channel.startsWith("passport:provider:")) return ["Smart Scanner", "Gemini API", "Visa Pipeline"];
  if (channel === "passport:inspect") return ["Smart Scanner", "Visa Pipeline"];
  if (channel.startsWith("passport:")) return ["Smart Scanner"];
  if (channel.startsWith("scanner:")) return ["Smart Scanner"];
  if (channel === "reports:csv") return ["Reports"];
  if (channel === "backup:create") return ["Settings"];
  return [];
}
function secureHandle(channel, handler) {
  electron.ipcMain.handle(channel, (event, ...args) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    if (!authenticatedUser) throw new Error("Please sign in to continue.");
    const requiredModules = modulesForChannel(channel);
    if (!requiredModules.length) throw new Error("This application action is not assigned to a module.");
    if (!requiredModules.some((module2) => authenticatedUser.permissions.includes(module2))) {
      throw new Error("You do not have permission to access this module.");
    }
    if (channel.startsWith("hr:") && !hrUnlocked && !["hr:auth:status", "hr:auth:setup", "hr:auth:unlock", "hr:auth:reset"].includes(channel)) {
      throw new Error("Unlock Human Resources with the HR password to continue.");
    }
    return handler(event, ...args);
  });
}
function requireModuleAccess(...modules) {
  if (!authenticatedUser || !modules.some((module2) => authenticatedUser.permissions.includes(module2))) {
    throw new Error("You do not have permission to access this module.");
  }
}
const validId = (id2) => {
  if (!Number.isSafeInteger(id2) || Number(id2) <= 0) throw new Error("Invalid record ID.");
  return Number(id2);
};
function requireAdministrator() {
  if (!authenticatedUser || authenticatedUser.role !== "admin") throw new Error("Only an administrator can manage application users.");
  return authenticatedUser;
}
async function addDocuments(zip, source, archivePath) {
  for (const entry of await promises.readdir(source, { withFileTypes: true })) {
    const fullPath = node_path.join(source, entry.name);
    const archiveName = `${archivePath}/${entry.name}`;
    if (entry.isDirectory()) await addDocuments(zip, fullPath, archiveName);
    else if (entry.isFile()) zip.addFile(fullPath, archiveName);
  }
}
async function createWindow() {
  const preloadPath = node_path.join(__dirname, "../preload/index.js");
  if (!node_fs.existsSync(preloadPath)) throw new Error("Required preload file is missing from the application package.");
  const win = new electron.BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f5f7fa",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = win;
  win.once("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      authenticatedUser = null;
      clientCredentials = null;
      clientSession = null;
      hrUnlocked = false;
    }
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("render-process-gone", (_event, details2) => {
    recordDiagnostic("renderer-process-gone", new Error(`reason=${details2.reason}; exitCode=${details2.exitCode}`), true);
  });
  win.webContents.once("did-finish-load", () => recordDiagnostic("renderer-load-succeeded"));
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      recordDiagnostic("renderer-load-failed", new Error(`code=${errorCode}; ${errorDescription}`), true);
    }
  });
  electron.ipcMain.on("diagnostics:renderer", (event, value) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const diagnostic2 = value;
    if (!["window-error", "unhandled-rejection", "react-uncaught-error"].includes(String(diagnostic2.type))) return;
    const errorName = typeof diagnostic2.errorName === "string" ? diagnostic2.errorName.slice(0, 120) : void 0;
    const stack = typeof diagnostic2.stack === "string" ? diagnostic2.stack.slice(0, 8e3) : void 0;
    recordDiagnostic(`renderer-${diagnostic2.type}`, void 0, false, { errorName, stack });
  });
  try {
    const rendererUrl = !electron.app.isPackaged ? process.env.ELECTRON_RENDERER_URL : void 0;
    const rendererPath = node_path.join(__dirname, "../renderer/index.html");
    if (rendererUrl) {
      try {
        await win.loadURL(rendererUrl);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (!/ERR_CONNECTION_REFUSED|\(-102\)/.test(detail) || !node_fs.existsSync(rendererPath)) throw error;
        recordDiagnostic("renderer-dev-server-unavailable", error, true);
        await win.loadFile(rendererPath);
      }
    } else {
      if (!node_fs.existsSync(rendererPath)) throw new Error("Required renderer file is missing from the application package.");
      await win.loadFile(rendererPath);
    }
  } catch (error) {
    win.destroy();
    throw error;
  }
}
electron.app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  const root = electron.app.getPath("userData");
  const lanConfig = readLanConfig(root);
  let serverFingerprint = "";
  installApplicationMenu(lanConfig, () => serverFingerprint);
  electron.ipcMain.handle("workspace:info", (event) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    return {
      ...lanConfig,
      fingerprint: lanConfig.mode === "server" ? serverFingerprint : lanConfig.mode === "client" ? lanConfig.fingerprint : "",
      configPath: node_path.join(root, "lan-workspace.json"),
      networkAddresses: getLanIPv4Addresses(),
      ...lanConfig.mode === "server" && serverFingerprint ? { setupCode: buildClientSetupCode(lanConfig.bindAddress, lanConfig.port, serverFingerprint) } : {}
    };
  });
  electron.ipcMain.handle("workspace:configure", async (event, input) => {
    if (!isMainWindowEvent(event) || authenticatedUser) throw new Error("Sign out before changing workspace.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid workspace configuration.");
    const value = input;
    let config;
    if (value.mode === "local") {
      if (Object.keys(value).some((key) => key !== "mode")) throw new Error("Invalid workspace configuration.");
      config = { mode: "local" };
    } else if (value.mode === "server") {
      if (Object.keys(value).some((key) => !["mode", "bindAddress", "port", "createCertificate"].includes(key)) || typeof value.createCertificate !== "boolean") throw new Error("Invalid server configuration.");
      config = parseLanConfig({ mode: "server", bindAddress: value.bindAddress, port: value.port });
      if (value.createCertificate) await createOfficeServerCertificate(root, config.bindAddress);
      else await verifyOfficeServerCertificate(root);
    } else if (value.mode === "client") {
      if (Object.keys(value).some((key) => !["mode", "address", "fingerprint"].includes(key))) throw new Error("Invalid client configuration.");
      const endpoint = parseOfficeServerAddress(value.address);
      const fingerprint = normalizeServerFingerprint(value.fingerprint);
      config = parseLanConfig({ mode: "client", ...endpoint, fingerprint });
    } else {
      throw new Error("Select standalone, server, or client mode.");
    }
    await promises.writeFile(node_path.join(root, "lan-workspace.json"), JSON.stringify(config, null, 2), "utf8");
    electron.app.relaunch();
    electron.app.exit(0);
  });
  electron.ipcMain.handle("workspace:test-connection", async (event, address, fingerprint) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    const endpoint = parseOfficeServerAddress(address);
    const pin = normalizeServerFingerprint(fingerprint);
    const config = parseLanConfig({ mode: "client", ...endpoint, fingerprint: pin });
    return testOfficeServerConnection(config);
  });
  if (lanConfig.mode === "client") {
    let clientPassportProvider = "ocr";
    let activeGeminiToken = null;
    const check = (event) => {
      if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    };
    electron.ipcMain.handle("auth:session", (event) => {
      check(event);
      return authenticatedUser;
    });
    electron.ipcMain.handle("auth:login", async (event, username, password) => {
      check(event);
      if (typeof username !== "string" || typeof password !== "string") throw new Error("Invalid credentials.");
      const credentials = { username: username.trim(), password };
      const user = await requestAttendance(lanConfig, { action: "login", ...credentials, args: [] });
      clientCredentials = credentials;
      clientSession = node_crypto.randomBytes(32).toString("hex");
      clientPassportProvider = "ocr";
      pendingPassports.clear();
      authenticatedUser = user;
      return user;
    });
    electron.ipcMain.handle("auth:logout", (event) => {
      check(event);
      const credentials = clientCredentials;
      const session = clientSession;
      const scan = activeGeminiToken;
      clientCredentials = null;
      clientSession = null;
      authenticatedUser = null;
      pendingPassports.clear();
      clientPassportProvider = "ocr";
      activeGeminiToken = null;
      if (credentials && session) void requestAttendance(lanConfig, { action: "hr", ...credentials, args: ["hr:auth:lock", [], session] }).catch(() => void 0);
      if (credentials && session && scan) void requestAttendance(lanConfig, { action: "gemini", ...credentials, args: ["cancel", [scan], session] }).catch(() => void 0);
    });
    const remote = (action, args = []) => {
      if (!clientCredentials) throw new Error("Please sign in to continue.");
      return requestAttendance(lanConfig, { action, ...clientCredentials, args });
    };
    const workspace = (operation, args = []) => {
      if (!clientSession) throw new Error("Please sign in to continue.");
      return remote("crm", [operation, args, clientSession]);
    };
    const hr = (operation, args = []) => {
      if (!clientSession) throw new Error("Please sign in to continue.");
      return remote("hr", [operation, args, clientSession]);
    };
    const shared = (operation, args = []) => {
      if (!clientSession) throw new Error("Please sign in to continue.");
      return remote("workspace", [operation, args, clientSession]);
    };
    const gemini = (operation, args = []) => {
      if (!clientSession) throw new Error("Please sign in to continue.");
      return remote("gemini", [operation, args, clientSession]);
    };
    for (const channel of [
      "applications:list",
      "applications:move",
      "applications:update",
      "applications:delete",
      "applications:activities:list",
      "applications:activities:add",
      "customers:list",
      "customers:get-profile",
      "customers:update",
      "pipelines:list",
      "pipelines:save",
      "pipelines:delete",
      "catalog:list",
      "catalog:save",
      "catalog:delete",
      "documents:list"
    ]) {
      electron.ipcMain.handle(channel, (event, ...args) => {
        check(event);
        return workspace(channel, args.map((arg) => arg === void 0 ? null : arg));
      });
    }
    for (const channel of [
      "hr:auth:status",
      "hr:auth:setup",
      "hr:auth:unlock",
      "hr:auth:change",
      "hr:auth:reset",
      "hr:dashboard",
      "hr:departments:list",
      "hr:departments:save",
      "hr:employees:list",
      "hr:employees:profile",
      "hr:employees:save",
      "hr:employees:archive",
      "hr:employees:delete",
      "hr:attendance:list",
      "hr:attendance:calendar",
      "hr:attendance:clock-in",
      "hr:attendance:clock-out",
      "hr:attendance:save",
      "hr:attendance:mark-all-present",
      "hr:leaves:list",
      "hr:leaves:create",
      "hr:leaves:decide",
      "hr:leave-balances:list",
      "hr:leave-balances:save",
      "hr:documents:list",
      "hr:candidates:list",
      "hr:candidates:cancel-upload",
      "hr:candidates:update",
      "hr:candidates:star",
      "hr:payroll:list",
      "hr:payroll:calculate",
      "hr:payroll:records:list",
      "hr:payroll:item:add",
      "hr:payroll:generate",
      "hr:payroll:approve",
      "hr:payroll:paid"
    ]) {
      electron.ipcMain.handle(channel, (event, ...args) => {
        check(event);
        return hr(channel, args.map((arg) => arg === void 0 ? null : arg));
      });
    }
    for (const channel of ["dashboard", "settings:get", "settings:save", "settings:users:list", "settings:users:create", "settings:users:delete", "settings:remove-logo"]) {
      electron.ipcMain.handle(channel, (event, ...args) => {
        check(event);
        return shared(channel, args);
      });
    }
    electron.ipcMain.handle("settings:users:update", async (event, input) => {
      check(event);
      const updated = await shared("settings:users:update", [input]);
      if (updated.id === authenticatedUser?.id && clientCredentials && input && typeof input === "object") {
        const value = input;
        clientCredentials = { username: updated.username, password: typeof value.password === "string" && value.password ? value.password : clientCredentials.password };
        try {
          authenticatedUser = await requestAttendance(lanConfig, { action: "login", ...clientCredentials, args: [] });
          if (clientSession) {
            try {
              await requestAttendance(lanConfig, { action: "hr", ...clientCredentials, args: ["hr:auth:lock", [], clientSession] });
            } catch {
            }
          }
          clientSession = node_crypto.randomBytes(32).toString("hex");
          pendingPassports.clear();
          return authenticatedUser;
        } catch {
          throw new Error("Your account was updated. Sign out and sign in again with the updated credentials.");
        }
      }
      return updated;
    });
    electron.ipcMain.handle("reports:csv", async (event) => {
      check(event);
      const csv = await shared("reports:csv");
      if (typeof csv !== "string") throw new Error("Invalid report response.");
      const result = await electron.dialog.showSaveDialog({ defaultPath: "BlueLine-Visa-CRM-Applications.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (result.canceled || !result.filePath) return false;
      if (node_path.extname(result.filePath).toLowerCase() !== ".csv") throw new Error("Save the report as a CSV file.");
      await promises.writeFile(result.filePath, csv, "utf8");
      return true;
    });
    electron.ipcMain.handle("settings:set-logo", async (event) => {
      check(event);
      const result = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Company logo", extensions: ["png", "jpg", "jpeg"] }] });
      if (result.canceled || !result.filePaths[0]) return null;
      const path = result.filePaths[0];
      const file = await promises.stat(path);
      if (!file.isFile() || file.size < 1 || file.size > 5 * 1024 * 1024 || ![".png", ".jpg", ".jpeg"].includes(node_path.extname(path).toLowerCase())) throw new Error("Choose a JPG or PNG logo up to 5 MB.");
      const bytes = await promises.readFile(path);
      if (bytes.length !== file.size) throw new Error("The selected logo changed. Choose it again.");
      const token = await shared("logo:begin", [bytes.length]);
      if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid logo upload response.");
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length);
          if (await shared("logo:chunk", [token, offset, bytes.subarray(offset, end).toString("base64")]) !== end) throw new Error("The server did not acknowledge the upload.");
        }
        return await shared("logo:finish", [token]);
      } catch (error) {
        try {
          await shared("logo:cancel", [token]);
        } catch {
        }
        throw error;
      }
    });
    electron.ipcMain.handle("backup:create", async (event) => {
      check(event);
      const destination = await electron.dialog.showSaveDialog({ defaultPath: `BlueLine-Backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`, filters: [{ name: "ZIP backup", extensions: ["zip"] }] });
      if (destination.canceled || !destination.filePath) return false;
      if (node_path.extname(destination.filePath).toLowerCase() !== ".zip") throw new Error("Save the backup as a ZIP file.");
      const token = await shared("backup:begin");
      if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid backup response.");
      const partial = `${destination.filePath}.partial-${node_crypto.randomUUID()}`;
      try {
        let info;
        const deadline = Date.now() + 30 * 6e4;
        do {
          info = await shared("backup:status", [token]);
          if (info?.state === "building") await new Promise((resolve2) => setTimeout(resolve2, 1e3));
          else break;
        } while (Date.now() < deadline);
        if (info?.state !== "ready" || !Number.isSafeInteger(info.size) || Number(info.size) < 1 || Number(info.size) > 1024 * 1024 * 1024 || typeof info.hash !== "string" || !/^[a-f0-9]{64}$/.test(info.hash)) throw new Error("The host backup is not ready or is invalid.");
        const handle = await promises.open(partial, "wx");
        try {
          const hash = node_crypto.createHash("sha256");
          const size = Number(info.size);
          for (let offset = 0; offset < size; offset += DOCUMENT_CHUNK_SIZE) {
            const encoded = await shared("backup:chunk", [token, offset]);
            if (typeof encoded !== "string" || encoded.length > Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4) throw new Error("Invalid backup data.");
            const bytes = Buffer.from(encoded, "base64");
            if (bytes.toString("base64") !== encoded || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, size - offset)) throw new Error("Invalid backup data.");
            await handle.writeFile(bytes);
            hash.update(bytes);
          }
          if (hash.digest("hex") !== info.hash) throw new Error("Backup integrity check failed.");
        } finally {
          await handle.close();
        }
        await promises.rename(partial, destination.filePath);
        return true;
      } finally {
        try {
          await promises.rm(partial, { force: true });
        } finally {
          try {
            await shared("backup:release", [token]);
          } catch {
          }
        }
      }
    });
    electron.ipcMain.handle("hr:reports:export", async (event, report) => {
      check(event);
      if (typeof report !== "string" || !["employees", "attendance", "leaves", "payroll", "documents", "activity"].includes(report)) throw new Error("Unsupported HR report.");
      const csv = await hr("hr:reports:export", [report]);
      if (typeof csv !== "string") throw new Error("Invalid HR report response.");
      const result = await electron.dialog.showSaveDialog({ defaultPath: `BlueLine-HR-${report}.csv`, filters: [{ name: "CSV report", extensions: ["csv"] }] });
      if (result.canceled || !result.filePath) return false;
      if (node_path.extname(result.filePath).toLowerCase() !== ".csv") throw new Error("Save the report as a CSV file.");
      await promises.writeFile(result.filePath, csv, "utf8");
      return true;
    });
    electron.ipcMain.handle("passport:provider:get", async (event) => {
      check(event);
      await shared("scanner:authorize", ["inspect"]);
      return clientPassportProvider;
    });
    electron.ipcMain.handle("passport:provider:save", async (event, provider) => {
      check(event);
      await shared("scanner:authorize", ["inspect"]);
      if (provider !== "ocr" && provider !== "gemini") throw new Error("Select a supported passport recognition engine.");
      if (provider === "gemini") {
        const status = await gemini("availability");
        if (status?.configured !== true) throw new Error("Gemini is not configured on the office server.");
      }
      clientPassportProvider = provider;
      return provider;
    });
    for (const channel of ["gemini:settings:get", "gemini:models:list", "gemini:settings:save", "gemini:connection:test"]) {
      electron.ipcMain.handle(channel, (event) => {
        check(event);
        throw new Error("Gemini configuration is available on the host only.");
      });
    }
    electron.ipcMain.handle("scanner:passport", async (event) => {
      check(event);
      await shared("scanner:authorize", ["standalone"]);
      const selected = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Passport image", extensions: ["jpg", "jpeg", "png"] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const path = selected.filePaths[0];
      const file = await promises.stat(path);
      if (!file.isFile() || file.size < 1 || file.size > DOCUMENT_MAX_SIZE || ![".jpg", ".jpeg", ".png"].includes(node_path.extname(path).toLowerCase())) throw new Error("Choose a JPG or PNG passport image up to 25 MB.");
      const text2 = (await recognizePassport(path, root)).text;
      await shared("scanner:authorize", ["standalone"]);
      return { fileName: node_path.basename(path), text: text2 };
    });
    secureHandle("passport:inspect", async (event, filePath, preprocessingVariants, provider) => {
      await shared("scanner:authorize", ["inspect"]);
      if (provider !== void 0 && provider !== "ocr" && provider !== "gemini") throw new Error("Select a supported passport recognition engine.");
      const selectedProvider = provider ?? clientPassportProvider;
      if (typeof filePath !== "string" || ![".pdf", ".jpg", ".jpeg", ".png"].includes(node_path.extname(filePath).toLowerCase())) throw new Error("Choose a JPG, PNG, or PDF passport.");
      const details2 = await promises.stat(filePath);
      if (!details2.isFile() || details2.size < 1 || details2.size > DOCUMENT_MAX_SIZE) throw new Error("Passport must be between 1 byte and 25 MB.");
      const image = await promises.readFile(filePath);
      if (image.length !== details2.size) throw new Error("The passport file changed. Choose it again.");
      const extension = node_path.extname(filePath).toLowerCase();
      const mimeType = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : "image/jpeg";
      const variants = validatePassportVariants(preprocessingVariants);
      let ocr = extension === ".pdf" ? { text: "", pages: [], mrz: null, extraction: extractIraqiPassport([], null) } : await recognizePassport(filePath, root, variants, "eng").catch((error) => {
        if (selectedProvider === "ocr") throw error;
        return { text: "", pages: [], mrz: null, extraction: extractIraqiPassport([], null) };
      });
      if (node_crypto.createHash("sha256").update(await promises.readFile(filePath)).digest("hex") !== node_crypto.createHash("sha256").update(image).digest("hex")) throw new Error("The passport file changed. Choose it again.");
      await shared("scanner:authorize", ["inspect"]);
      let diagnostics;
      if (selectedProvider === "gemini") {
        const token2 = await gemini("begin", [node_path.basename(filePath), image.length]);
        if (typeof token2 !== "string" || !/^[a-f0-9-]{36}$/.test(token2)) throw new Error("Invalid Gemini scan response.");
        activeGeminiToken = token2;
        try {
          for (let offset = 0; offset < image.length; offset += DOCUMENT_CHUNK_SIZE) {
            const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, image.length);
            if (await gemini("chunk", [token2, offset, image.subarray(offset, end).toString("base64")]) !== end) throw new Error("The server did not acknowledge the scan upload.");
          }
          await gemini("finish", [token2, ocr.extraction]);
          let status;
          const deadline = Date.now() + 5 * 6e4;
          do {
            status = await gemini("status", [token2]);
            if (status?.state === "processing") await new Promise((resolve2) => setTimeout(resolve2, 1e3));
            else break;
          } while (Date.now() < deadline);
          if (status?.state !== "ready" || !status.result?.extraction || !status.result.diagnostics) throw new Error("The Gemini scan did not complete.");
          ocr = { ...ocr, extraction: status.result.extraction };
          diagnostics = status.result.diagnostics;
        } finally {
          try {
            await gemini("cancel", [token2]);
          } catch {
          }
          if (activeGeminiToken === token2) activeGeminiToken = null;
        }
      }
      const token = node_crypto.randomUUID();
      pendingPassports.set(token, {
        path: filePath,
        owner: event.sender.id,
        fileName: node_path.basename(filePath),
        mimeType,
        expiresAt: Date.now() + 10 * 6e4,
        hash: node_crypto.createHash("sha256").update(image).digest("hex")
      });
      return {
        token,
        fileName: node_path.basename(filePath),
        mimeType,
        previewDataUrl: `data:${mimeType};base64,${image.toString("base64")}`,
        text: ocr.text,
        fields: ocr.extraction.fields,
        assessments: ocr.extraction.assessments,
        profile: ocr.extraction.profile,
        mrz: ocr.mrz,
        ...diagnostics ? { diagnostics } : {}
      };
    });
    for (const [channel, action] of [
      ["attendance:self:status", "status"],
      ["attendance:self:check-in", "check-in"],
      ["attendance:self:check-out", "check-out"],
      ["attendance:self:calendar", "calendar"]
    ]) {
      electron.ipcMain.handle(channel, (event, ...args) => {
        check(event);
        return remote(action, args);
      });
    }
    electron.ipcMain.handle("documents:list-all", (event) => {
      check(event);
      return remote("documents-list");
    });
    const download = async (storage, id2) => {
      const documentId = validId(id2);
      const pieces = [];
      let offset = 0;
      let size = 0;
      let name2 = "";
      do {
        const chunk = await (storage === "hr-document" || storage === "hr-candidate" ? hr("hr:file:download", [storage === "hr-document" ? "document" : "candidate", documentId, offset]) : workspace("file:download", [storage, documentId, offset]));
        if (!chunk || typeof chunk.name !== "string" || node_path.basename(chunk.name) !== chunk.name || ![".pdf", ".jpg", ".jpeg", ".png"].includes(node_path.extname(chunk.name).toLowerCase()) || /[\\/:*?"<>|\x00-\x1f]/.test(chunk.name) || chunk.name.length > 180 || !Number.isSafeInteger(chunk.size) || Number(chunk.size) < 1 || Number(chunk.size) > DOCUMENT_MAX_SIZE || typeof chunk.data !== "string" || chunk.data.length > Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4) throw new Error("Invalid document response.");
        if (offset && (chunk.size !== size || chunk.name !== name2)) throw new Error("Document changed during download.");
        size = Number(chunk.size);
        name2 = chunk.name;
        const bytes = Buffer.from(chunk.data, "base64");
        if (bytes.toString("base64") !== chunk.data || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, size - offset)) throw new Error("Invalid document response.");
        pieces.push(bytes);
        offset += bytes.length;
      } while (offset < size);
      const result = await electron.dialog.showSaveDialog({ defaultPath: name2, filters: [{ name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png"] }] });
      if (result.canceled || !result.filePath) return;
      if (node_path.extname(result.filePath).toLowerCase() !== node_path.extname(name2).toLowerCase()) throw new Error("Save the document using its original file extension.");
      await promises.writeFile(result.filePath, Buffer.concat(pieces, size));
      const error = await electron.shell.openPath(result.filePath);
      if (error) throw new Error(`The document was saved, but could not be opened: ${error}`);
    };
    electron.ipcMain.handle("documents:open", (event, id2) => {
      check(event);
      return download("application", id2);
    });
    electron.ipcMain.handle("customer-documents:open", (event, id2) => {
      check(event);
      return download("customer", id2);
    });
    electron.ipcMain.handle("hr:documents:open", (event, id2) => {
      check(event);
      return download("hr-document", id2);
    });
    electron.ipcMain.handle("hr:candidates:open-file", (event, id2) => {
      check(event);
      return download("hr-candidate", id2);
    });
    const connectionLost = (error) => error instanceof Error && [
      "Could not securely connect to the office server.",
      "Server connection timed out.",
      "Server closed the connection."
    ].includes(error.message);
    electron.ipcMain.handle("hr:candidates:create", async (event, input) => {
      check(event);
      try {
        return await hr("hr:candidates:create", [input]);
      } catch (error) {
        if (connectionLost(error)) throw new Error("Candidate confirmation was lost. Check the CVs Bank before retrying.");
        throw error;
      }
    });
    const upload = async (kind, target, related, fileName, bytes) => {
      const token = await workspace("file:begin", [kind, target, related, fileName, bytes.length]);
      if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid upload response.");
      let finishing = false;
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length);
          if (await workspace("file:chunk", [token, offset, bytes.subarray(offset, end).toString("base64")]) !== end) throw new Error("The server did not acknowledge the upload.");
        }
        finishing = true;
        return await workspace("file:finish", [token]);
      } catch (error) {
        try {
          await workspace("file:cancel", [token]);
        } catch {
        }
        if (finishing && kind !== "passport" && connectionLost(error)) throw new Error("Upload confirmation was lost. Check the record before retrying; the file may already be saved.");
        throw error;
      }
    };
    const chooseUpload = async (kind, target, related = null) => {
      const selected = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Documents", extensions: kind === "photo" ? ["jpg", "jpeg", "png"] : ["pdf", "jpg", "jpeg", "png"] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const source = selected.filePaths[0];
      const details2 = await promises.stat(source);
      const limit = kind === "photo" ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE;
      if (!details2.isFile() || details2.size < 1 || details2.size > limit) throw new Error("The selected file is empty or too large.");
      const data = await promises.readFile(source);
      if (data.length !== details2.size) throw new Error("The selected file changed. Choose it again.");
      return upload(kind, validId(target), related == null ? null : validId(related), node_path.basename(source), data);
    };
    electron.ipcMain.handle("documents:upload", (event, target) => {
      check(event);
      return chooseUpload("application", target);
    });
    electron.ipcMain.handle("customer-documents:upload", (event, target, related) => {
      check(event);
      return chooseUpload("customer", target, related);
    });
    electron.ipcMain.handle("customers:set-photo", (event, target) => {
      check(event);
      return chooseUpload("photo", target);
    });
    const uploadHr = async (kind, target, fileName, bytes, metadata = null) => {
      const token = await hr("hr:file:begin", [kind, target, fileName, bytes.length, metadata]);
      if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid upload response.");
      let finishing = false;
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length);
          if (await hr("hr:file:chunk", [token, offset, bytes.subarray(offset, end).toString("base64")]) !== end) throw new Error("The server did not acknowledge the upload.");
        }
        finishing = true;
        return await hr("hr:file:finish", [token]);
      } catch (error) {
        try {
          await hr("hr:file:cancel", [token]);
        } catch {
        }
        if (finishing && kind !== "candidate" && connectionLost(error)) throw new Error("Upload confirmation was lost. Check the HR record before retrying.");
        throw error;
      }
    };
    const selectHrFile = async (photo) => {
      const selected = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: photo ? "Profile image" : "HR documents", extensions: photo ? ["jpg", "jpeg", "png"] : ["pdf", "jpg", "jpeg", "png"] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const path = selected.filePaths[0];
      const details2 = await promises.stat(path);
      if (!details2.isFile() || details2.size < 1 || details2.size > (photo ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE)) throw new Error("The selected file is empty or too large.");
      const data = await promises.readFile(path);
      if (data.length !== details2.size) throw new Error("The selected file changed. Choose it again.");
      return { path, fileName: node_path.basename(path), data };
    };
    electron.ipcMain.handle("hr:employees:set-photo", async (event, target) => {
      check(event);
      const file = await selectHrFile(true);
      return file ? uploadHr("photo", validId(target), file.fileName, file.data) : null;
    });
    electron.ipcMain.handle("hr:documents:upload", async (event, target, metadata) => {
      check(event);
      const file = await selectHrFile(false);
      return file ? uploadHr("document", validId(target), file.fileName, file.data, metadata) : null;
    });
    electron.ipcMain.handle("hr:candidates:select-file", async (event) => {
      check(event);
      const file = await selectHrFile(false);
      if (!file) return null;
      let suggestedName = candidateNameFromFileName(file.fileName);
      let nameSource = "filename";
      let suggestionNote;
      if ([".jpg", ".jpeg", ".png"].includes(node_path.extname(file.fileName).toLowerCase())) {
        try {
          const recognized = candidateNameFromText((await recognizePassport(file.path, root, [], "eng+ara")).text);
          if (recognized) {
            suggestedName = recognized;
            nameSource = "ocr";
          }
        } catch {
          suggestionNote = "Offline name recognition could not read this image; the filename suggestion is shown.";
        }
      }
      const result = await uploadHr("candidate", null, file.fileName, file.data);
      if (typeof result?.uploadId !== "string" || result.fileName !== file.fileName) throw new Error("Invalid candidate upload response.");
      return { uploadId: result.uploadId, fileName: file.fileName, suggestedName, nameSource, suggestionNote };
    });
    electron.ipcMain.handle("applications:create", async (event, value) => {
      check(event);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid application details.");
      const input = value;
      let staged;
      if (input.passportToken) {
        const pending = pendingPassports.get(input.passportToken);
        if (!pending || pending.owner !== event.sender.id || pending.expiresAt < Date.now()) throw new Error("Passport preview expired. Scan it again.");
        const bytes = await promises.readFile(pending.path);
        if (!bytes.length || bytes.length > DOCUMENT_MAX_SIZE || node_crypto.createHash("sha256").update(bytes).digest("hex") !== pending.hash) throw new Error("The passport file changed. Scan it again.");
        const result = await upload("passport", null, null, pending.fileName, bytes);
        if (typeof result?.passportToken !== "string") throw new Error("Invalid passport upload response.");
        staged = result.passportToken;
      }
      try {
        const result = await workspace("applications:create", [{ ...input, ...staged ? { passportToken: staged } : {} }]);
        if (input.passportToken) pendingPassports.delete(input.passportToken);
        return result;
      } catch (error) {
        if (staged) {
          try {
            await workspace("file:cancel", [staged]);
          } catch {
          }
        }
        if (connectionLost(error)) throw new Error("Application confirmation was lost. Check the pipeline before retrying; the application may already exist.");
        throw error;
      }
    });
    electron.ipcMain.handle("documents:upload-by-reference", async (event, reference) => {
      check(event);
      if (typeof reference !== "string" || !reference.trim() || reference.length > 80) throw new Error("Enter an application reference.");
      const selected = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png"] }] });
      if (selected.canceled || !selected.filePaths[0]) return null;
      const source = selected.filePaths[0];
      const details2 = await promises.stat(source);
      if (!details2.isFile() || details2.size < 1 || details2.size > DOCUMENT_MAX_SIZE) throw new Error("Document must be between 1 byte and 25 MB.");
      if (![".pdf", ".jpg", ".jpeg", ".png"].includes(node_path.extname(source).toLowerCase())) throw new Error("Unsupported document format.");
      const bytes = await promises.readFile(source);
      if (bytes.length !== details2.size || bytes.length > DOCUMENT_MAX_SIZE) throw new Error("The selected file changed. Choose it again.");
      const token = await remote("document-begin", [reference.trim(), node_path.basename(source), bytes.length]);
      if (typeof token !== "string" || !/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid upload response.");
      let finishing = false;
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length);
          const received = await remote("document-chunk", [token, offset, bytes.subarray(offset, end).toString("base64")]);
          if (received !== end) throw new Error("The server did not acknowledge the upload.");
        }
        finishing = true;
        return await remote("document-finish", [token]);
      } catch (error) {
        try {
          await remote("document-cancel", [token]);
        } catch {
        }
        if (finishing) throw new Error("Upload confirmation failed. Check the document library before retrying; the file may already be saved.");
        throw error;
      }
    });
    await createWindow();
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) void createWindow().catch(showStartupError);
    });
    return;
  }
  const docsDir = node_path.join(root, "documents");
  const geminiScanner = new GeminiPassportScanner(root);
  let db;
  try {
    db = openDatabase(node_path.join(root, "database", "blueline.db"));
  } catch (error) {
    recordDiagnostic("database-initialization-failed", error, true);
    throw error;
  }
  const removedCandidatePaths = listHrCandidatePathsForDepartmentPurge(db);
  const candidateDirectory = node_path.resolve(docsDir, "hr", "cvs");
  for (const filePath of removedCandidatePaths) {
    if (!node_path.isAbsolute(filePath)) throw new Error("A removed CV candidate file has an invalid stored path.");
    const relativePath = node_path.relative(candidateDirectory, node_path.resolve(filePath));
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${node_path.sep}`) || node_path.isAbsolute(relativePath)) {
      throw new Error("A removed CV candidate file is outside the private CV storage directory.");
    }
    await promises.rm(node_path.resolve(filePath), { force: true });
  }
  purgeHrCandidatesFromDepartments(db, "System migration");
  if (lanConfig.mode === "server") {
    const documents = new LanDocuments(db, docsDir);
    const resizeImage = (bytes, max) => {
      const image = electron.nativeImage.createFromBuffer(bytes);
      const size = image.getSize();
      if (image.isEmpty() || !size.width || !size.height || size.width * size.height > 4e7) throw new Error("Invalid image.");
      const factor = Math.min(1, max / Math.max(size.width, size.height));
      return image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)), quality: "good" });
    };
    const convertImage = (bytes, max) => resizeImage(bytes, max).toJPEG(80);
    const crm = new LanCrm(db, root, documents, convertImage);
    const hr = new LanHr(db, root, convertImage);
    const workspace = new LanWorkspace(db, root, (bytes, max) => resizeImage(bytes, max).toPNG(), (user, session) => {
      hr.execute(user, session, "hr:auth:check", []);
    });
    const gemini = new LanGemini(root, async () => (await geminiScanner.getSettings()).configured, async (path, mime, local) => {
      const settings = await geminiScanner.getSettings();
      return geminiScanner.inspectImage(path, mime, local, settings.model);
    });
    const service = await startAttendanceServer(root, lanConfig, {
      authenticate: (username, password) => authenticate(db, username, password),
      documents,
      crm,
      hr,
      workspace,
      gemini,
      attendance: (action, user, args) => {
        const now = /* @__PURE__ */ new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        if (action === "status") return getHrSelfAttendanceStatus(db, user.id, date);
        if (action === "check-in") return clockInHrAttendanceForUser(db, user.id, user.displayName);
        if (action === "check-out") return clockOutHrAttendanceForUser(db, user.id, user.displayName);
        return getHrSelfAttendanceCalendar(db, user.id, args[0], args[1]);
      }
    });
    serverFingerprint = service.fingerprint;
    electron.app.once("before-quit", () => service.server.close());
  }
  electron.ipcMain.handle("auth:session", (event) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    return authenticatedUser;
  });
  electron.ipcMain.handle("auth:login", (event, username, password) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    const user = authenticate(db, username, password);
    if (!user) throw new Error("Username or password is incorrect.");
    hrUnlocked = false;
    authenticatedUser = user;
    return user;
  });
  electron.ipcMain.handle("auth:logout", (event) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    authenticatedUser = null;
    hrUnlocked = false;
  });
  secureHandle("dashboard", () => getDashboard(db));
  const localDate = () => {
    const now = /* @__PURE__ */ new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  electron.ipcMain.handle("attendance:self:status", (event) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    if (!authenticatedUser) throw new Error("Please sign in to continue.");
    requireModuleAccess("My Attendance", "Dashboard");
    return getHrSelfAttendanceStatus(db, authenticatedUser.id, localDate());
  });
  electron.ipcMain.handle("attendance:self:check-in", (event) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    if (!authenticatedUser) throw new Error("Please sign in to continue.");
    requireModuleAccess("My Attendance", "Dashboard");
    return clockInHrAttendanceForUser(db, authenticatedUser.id, authenticatedUser.displayName);
  });
  electron.ipcMain.handle("attendance:self:check-out", (event) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    if (!authenticatedUser) throw new Error("Please sign in to continue.");
    requireModuleAccess("My Attendance", "Dashboard");
    return clockOutHrAttendanceForUser(db, authenticatedUser.id, authenticatedUser.displayName);
  });
  electron.ipcMain.handle("attendance:self:calendar", (event, year, month) => {
    if (!isMainWindowEvent(event)) throw new Error("Untrusted application window.");
    if (!authenticatedUser) throw new Error("Please sign in to continue.");
    requireModuleAccess("My Attendance");
    return getHrSelfAttendanceCalendar(db, authenticatedUser.id, Number(year), Number(month));
  });
  secureHandle("hr:auth:status", () => ({ configured: isHrPasswordConfigured(db) }));
  secureHandle("hr:auth:setup", (_event, password) => {
    if (authenticatedUser.role !== "admin") throw new Error("Only an administrator can create or change the HR password.");
    if (typeof password !== "string") throw new Error("Invalid HR password.");
    setInitialHrPassword(db, authenticatedUser.username, password);
    hrUnlocked = true;
  });
  secureHandle("hr:auth:unlock", (_event, password) => {
    if (typeof password !== "string" || !isHrPasswordConfigured(db) || !verifyHrPassword(db, password)) {
      throw new Error("The HR password is incorrect.");
    }
    hrUnlocked = true;
  });
  secureHandle("hr:auth:change", (_event, currentPassword, newPassword) => {
    if (authenticatedUser.role !== "admin") throw new Error("Only an administrator can change the HR password.");
    if (typeof currentPassword !== "string" || typeof newPassword !== "string") throw new Error("Invalid HR password.");
    changeHrPassword(db, authenticatedUser.username, currentPassword, newPassword);
  });
  secureHandle("hr:auth:reset", (_event, administratorPassword, newPassword) => {
    if (authenticatedUser.role !== "admin") throw new Error("Only an administrator can reset the HR password.");
    if (typeof administratorPassword !== "string" || typeof newPassword !== "string") throw new Error("Invalid password.");
    if (!isHrPasswordConfigured(db)) throw new Error("The HR password is not configured.");
    if (!authenticate(db, authenticatedUser.username, administratorPassword)) throw new Error("The administrator password is incorrect.");
    resetHrPassword(db, authenticatedUser.username, newPassword);
    hrUnlocked = true;
  });
  secureHandle("hr:dashboard", () => getHrDashboard(db, localDate()));
  secureHandle("hr:departments:list", () => listHrDepartments(db));
  secureHandle("hr:departments:save", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.name !== "string" || typeof input.description !== "string" || input.id !== void 0 && !Number.isSafeInteger(input.id)) throw new Error("Invalid department details.");
    saveHrDepartment(db, authenticatedUser.displayName, input);
  });
  secureHandle("hr:employees:list", (_event, search, includeArchived) => {
    if (search !== void 0 && typeof search !== "string" || includeArchived !== void 0 && typeof includeArchived !== "boolean") throw new Error("Invalid employee filters.");
    return listHrEmployees(db, search, includeArchived).map(withHrEmployeePhoto);
  });
  secureHandle("hr:employees:profile", (_event, id2) => {
    const profile = getHrEmployeeProfileData(db, validId(id2));
    return { ...profile, employee: withHrEmployeePhoto(profile.employee) };
  });
  secureHandle("hr:employees:set-photo", async (_event, id2) => {
    const employeeId = validId(id2);
    getHrEmployeePhotoPath(db, employeeId);
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Employee profile image", extensions: ["jpg", "jpeg", "png"] }]
    });
    if (canceled || !filePaths[0]) return null;
    const source = filePaths[0];
    const details2 = await promises.stat(source);
    if (!details2.isFile() || details2.size > 10 * 1024 * 1024) throw new Error("Profile image must be smaller than 10 MB.");
    const extension = node_path.extname(source).toLowerCase();
    if (![".jpg", ".jpeg", ".png"].includes(extension)) throw new Error("Unsupported profile image format.");
    if (electron.nativeImage.createFromPath(source).isEmpty()) throw new Error("The selected profile image could not be decoded.");
    const directory = node_path.join(docsDir, "hr", "employee-photos");
    await promises.mkdir(directory, { recursive: true });
    const destination = node_path.join(directory, `${employeeId}-${node_crypto.randomUUID()}${extension}`);
    await promises.copyFile(source, destination);
    try {
      const photoDataUrl = readHrEmployeePhotoDataUrl(destination);
      if (!photoDataUrl) throw new Error("The selected profile image could not be processed.");
      setHrEmployeePhotoPath(db, authenticatedUser.displayName, employeeId, destination);
      return photoDataUrl;
    } catch (error) {
      await promises.rm(destination, { force: true });
      throw error;
    }
  });
  secureHandle("hr:employees:save", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.id !== void 0 && !Number.isSafeInteger(input.id) || typeof input.fullName !== "string" || typeof input.phone !== "string" || typeof input.email !== "string" || typeof input.jobTitle !== "string" || typeof input.hireDate !== "string" || typeof input.employmentType !== "string" || typeof input.status !== "string" || !Number.isSafeInteger(input.hourlyRate) || !(input.departmentId === null || Number.isSafeInteger(input.departmentId)) || input.workStart !== void 0 && !(input.workStart === null || typeof input.workStart === "string") || input.workEnd !== void 0 && !(input.workEnd === null || typeof input.workEnd === "string") || input.appUserId !== void 0 && !(input.appUserId === null || Number.isSafeInteger(input.appUserId) && Number(input.appUserId) > 0)) throw new Error("Invalid employee details.");
    if (input.appUserId !== void 0 && authenticatedUser.role !== "admin") {
      throw new Error("Only an administrator can assign application users to employees.");
    }
    const { id: id2, ...employee } = input;
    return withHrEmployeePhoto(saveHrEmployee(db, authenticatedUser.displayName, {
      ...employee,
      ...id2 === void 0 ? {} : { id: validId(id2) }
    }));
  });
  secureHandle("hr:employees:archive", (_event, id2, archived) => {
    if (typeof archived !== "boolean") throw new Error("Invalid archive action.");
    archiveHrEmployee(db, authenticatedUser.displayName, validId(id2), archived);
  });
  secureHandle("hr:employees:delete", async (_event, id2) => {
    const employeeId = validId(id2);
    const employeeDocumentDirectory = node_path.resolve(docsDir, "hr", String(employeeId));
    const employeePhotoDirectory = node_path.resolve(docsDir, "hr", "employee-photos");
    const filePaths = getHrEmployeeStoredFilePaths(db, employeeId);
    for (const filePath of filePaths) {
      const absolutePath = node_path.resolve(filePath);
      const documentRelativePath = node_path.relative(employeeDocumentDirectory, absolutePath);
      const isEmployeeDocument = Boolean(documentRelativePath) && documentRelativePath !== ".." && !documentRelativePath.startsWith(`..${node_path.sep}`) && !node_path.isAbsolute(documentRelativePath);
      const isEmployeePhoto = node_path.resolve(node_path.dirname(absolutePath)) === employeePhotoDirectory && node_path.basename(absolutePath).startsWith(`${employeeId}-`);
      if (!isEmployeeDocument && !isEmployeePhoto) {
        throw new Error("Employee files are outside their managed HR storage location; no employee data was deleted.");
      }
    }
    const storedPaths = deleteHrEmployee(db, authenticatedUser.displayName, employeeId);
    try {
      for (const filePath of storedPaths) await promises.rm(filePath, { force: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Employee data was deleted, but a stored HR file could not be removed: ${reason}`);
    }
  });
  secureHandle("hr:attendance:list", (_event, date) => {
    if (typeof date !== "string") throw new Error("Invalid attendance date.");
    return listHrAttendance(db, date);
  });
  secureHandle("hr:attendance:calendar", (_event, year, month, employeeId) => {
    if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || employeeId !== void 0 && (!Number.isSafeInteger(employeeId) || Number(employeeId) <= 0)) {
      throw new Error("Invalid attendance calendar selection.");
    }
    return listHrAttendanceCalendar(db, year, month, employeeId === void 0 ? void 0 : Number(employeeId));
  });
  secureHandle("hr:attendance:clock-in", (_event, id2) => clockHrAttendance(db, authenticatedUser.displayName, validId(id2), "in"));
  secureHandle("hr:attendance:clock-out", (_event, id2) => clockHrAttendance(db, authenticatedUser.displayName, validId(id2), "out"));
  secureHandle("hr:attendance:save", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Number.isSafeInteger(input.employeeId) || typeof input.attendanceDate !== "string" || !(input.checkIn === null || typeof input.checkIn === "string") || !(input.checkOut === null || typeof input.checkOut === "string") || typeof input.status !== "string" || typeof input.notes !== "string") throw new Error("Invalid attendance details.");
    saveHrAttendance(db, authenticatedUser.displayName, input);
  });
  secureHandle("hr:attendance:mark-all-present", (_event, date) => {
    if (typeof date !== "string") throw new Error("Invalid attendance date.");
    return markAllHrEmployeesPresent(db, authenticatedUser.displayName, date);
  });
  secureHandle("hr:leaves:list", (_event, status) => {
    if (status !== void 0 && typeof status !== "string") throw new Error("Invalid leave filter.");
    return listHrLeaveRequests(db, status);
  });
  secureHandle("hr:leaves:create", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Number.isSafeInteger(input.employeeId) || typeof input.leaveType !== "string" || typeof input.startDate !== "string" || typeof input.endDate !== "string" || typeof input.totalDays !== "number" || typeof input.reason !== "string") throw new Error("Invalid leave request.");
    createHrLeaveRequest(db, authenticatedUser.displayName, input);
  });
  secureHandle("hr:leaves:decide", (_event, id2, status) => {
    if (status !== "Approved" && status !== "Rejected") throw new Error("Invalid leave decision.");
    decideHrLeaveRequest(db, authenticatedUser.displayName, validId(id2), status);
  });
  secureHandle("hr:leave-balances:list", (_event, year) => {
    if (!Number.isSafeInteger(year)) throw new Error("Invalid leave-balance year.");
    return listHrLeaveBalances(db, year);
  });
  secureHandle("hr:leave-balances:save", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Number.isSafeInteger(input.employeeId) || typeof input.leaveType !== "string" || !Number.isSafeInteger(input.year) || typeof input.allocatedDays !== "number") throw new Error("Invalid leave-balance details.");
    saveHrLeaveBalance(db, authenticatedUser.displayName, input);
  });
  secureHandle("hr:documents:list", (_event, employeeId) => {
    if (employeeId !== void 0 && !Number.isSafeInteger(employeeId)) throw new Error("Invalid employee ID.");
    return listHrDocuments(db, employeeId);
  });
  secureHandle("hr:documents:upload", async (_event, employeeId, metadata) => {
    const id2 = validId(employeeId);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || typeof metadata.documentType !== "string" || metadata.issueDate !== void 0 && typeof metadata.issueDate !== "string" || metadata.expirationDate !== void 0 && typeof metadata.expirationDate !== "string") throw new Error("Invalid employee document details.");
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ?").get(id2)) throw new Error("Employee not found.");
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Employee documents", extensions: ["pdf", "jpg", "jpeg", "png"] }]
    });
    if (canceled || !filePaths[0]) return null;
    const source = filePaths[0];
    const details2 = await promises.stat(source);
    if (!details2.isFile() || details2.size > 25 * 1024 * 1024) throw new Error("Document must be smaller than 25 MB.");
    const extension = node_path.extname(source).toLowerCase();
    if (![".pdf", ".jpg", ".jpeg", ".png"].includes(extension)) throw new Error("Unsupported document format.");
    const directory = node_path.join(docsDir, "hr", String(id2));
    await promises.mkdir(directory, { recursive: true });
    const destination = node_path.join(directory, `${node_crypto.randomUUID()}${extension}`);
    await promises.copyFile(source, destination);
    try {
      return addHrDocument(db, authenticatedUser.displayName, {
        employeeId: id2,
        documentName: node_path.basename(source),
        documentType: metadata.documentType,
        issueDate: metadata.issueDate,
        expirationDate: metadata.expirationDate,
        filePath: destination
      });
    } catch (error) {
      await promises.rm(destination, { force: true });
      throw error;
    }
  });
  secureHandle("hr:documents:open", async (_event, documentId) => {
    const filePath = getHrDocumentPath(db, validId(documentId));
    if (!node_fs.existsSync(filePath)) throw new Error("Employee document file not found.");
    const error = await electron.shell.openPath(filePath);
    if (error) throw new Error(error);
  });
  secureHandle("hr:candidates:list", () => listHrCandidates(db));
  secureHandle("hr:candidates:select-file", async () => {
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "CVs and photos", extensions: ["pdf", "jpg", "jpeg", "png"] }]
    });
    if (canceled || !filePaths[0]) return null;
    const source = filePaths[0];
    const details2 = await promises.stat(source);
    if (!details2.isFile() || details2.size > 25 * 1024 * 1024) throw new Error("Candidate file must be smaller than 25 MB.");
    const extension = node_path.extname(source).toLowerCase();
    if (![".pdf", ".jpg", ".jpeg", ".png"].includes(extension)) throw new Error("Unsupported candidate file format.");
    const fileName = node_path.basename(source);
    const uploadId = node_crypto.randomUUID();
    const stagingDirectory = node_path.join(docsDir, "hr", "cv-staging");
    await promises.mkdir(stagingDirectory, { recursive: true });
    const stagedPath = node_path.join(stagingDirectory, `${uploadId}${extension}`);
    await promises.copyFile(source, stagedPath);
    pendingHrCandidateUploads.set(uploadId, { filePath: stagedPath, fileName });
    let suggestedName = candidateNameFromFileName(fileName);
    let nameSource = "filename";
    let suggestionNote;
    if ([".jpg", ".jpeg", ".png"].includes(extension)) {
      try {
        const recognizedName = candidateNameFromText((await recognizePassport(stagedPath, root, [], "eng+ara")).text);
        if (recognizedName) {
          suggestedName = recognizedName;
          nameSource = "ocr";
        }
      } catch (error) {
        recordDiagnostic("hr-candidate-name-recognition-failed", error);
        nameSource = "filename";
        suggestionNote = "Offline name recognition could not read this image; the filename suggestion is shown.";
      }
    }
    return { uploadId, fileName, suggestedName, nameSource, suggestionNote };
  });
  secureHandle("hr:candidates:cancel-upload", async (_event, uploadId) => {
    if (typeof uploadId !== "string") throw new Error("Invalid candidate upload.");
    const pending = pendingHrCandidateUploads.get(uploadId);
    if (!pending) return;
    pendingHrCandidateUploads.delete(uploadId);
    await promises.rm(pending.filePath, { force: true });
  });
  secureHandle("hr:candidates:create", async (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.uploadId !== "string" || typeof input.fullName !== "string" || typeof input.phone !== "string" || typeof input.email !== "string" || !Number.isSafeInteger(input.departmentId) || typeof input.notes !== "string") throw new Error("Invalid candidate details.");
    const pending = pendingHrCandidateUploads.get(input.uploadId);
    if (!pending) throw new Error("Candidate upload expired. Choose the file again.");
    const destinationDirectory = node_path.join(docsDir, "hr", "cvs");
    await promises.mkdir(destinationDirectory, { recursive: true });
    const filePath = node_path.join(destinationDirectory, `${node_crypto.randomUUID()}${node_path.extname(pending.fileName).toLowerCase()}`);
    await promises.copyFile(pending.filePath, filePath);
    let candidate;
    try {
      const details2 = {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        departmentId: input.departmentId,
        notes: input.notes
      };
      candidate = addHrCandidate(db, authenticatedUser.displayName, details2, pending.fileName, filePath);
    } catch (error) {
      await promises.rm(filePath, { force: true });
      throw error;
    }
    pendingHrCandidateUploads.delete(input.uploadId);
    try {
      await promises.rm(pending.filePath, { force: true });
    } catch (error) {
      recordDiagnostic("hr-candidate-staging-cleanup-failed", error);
    }
    return candidate;
  });
  secureHandle("hr:candidates:update", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Number.isSafeInteger(input.id) || typeof input.fullName !== "string" || typeof input.phone !== "string" || typeof input.email !== "string" || !Number.isSafeInteger(input.departmentId) || typeof input.notes !== "string") {
      throw new Error("Invalid candidate details.");
    }
    const details2 = {
      id: input.id,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      departmentId: input.departmentId,
      notes: input.notes
    };
    return updateHrCandidate(db, authenticatedUser.displayName, details2);
  });
  secureHandle("hr:candidates:star", (_event, id2, starred) => {
    if (typeof starred !== "boolean") throw new Error("Invalid candidate star setting.");
    setHrCandidateStarred(db, authenticatedUser.displayName, validId(id2), starred);
  });
  secureHandle("hr:candidates:open-file", async (_event, id2) => {
    const filePath = getHrCandidateFilePath(db, validId(id2));
    if (!node_fs.existsSync(filePath)) throw new Error("Candidate file not found.");
    const error = await electron.shell.openPath(filePath);
    if (error) throw new Error(error);
  });
  secureHandle("hr:reports:export", async (_event, report) => {
    const reportNames = {
      employees: "Employee-Directory",
      attendance: "Attendance",
      leaves: "Leave-Requests",
      payroll: "Payroll-Summary",
      documents: "Document-Expiration",
      activity: "HR-Activity"
    };
    if (typeof report !== "string" || !Object.hasOwn(reportNames, report)) throw new Error("Unsupported HR report.");
    const reportType = report;
    const { canceled, filePath } = await electron.dialog.showSaveDialog({
      defaultPath: `BlueLine-HR-${reportNames[reportType]}-${localDate()}.csv`,
      filters: [{ name: "CSV report", extensions: ["csv"] }]
    });
    if (canceled || !filePath) return false;
    await promises.writeFile(filePath, buildHrCsvReport(db, reportType), "utf8");
    return true;
  });
  secureHandle("hr:payroll:list", () => listHrPayrollPeriods(db));
  secureHandle("hr:payroll:calculate", (_event, employeeId, startDate, endDate) => {
    if (typeof startDate !== "string" || typeof endDate !== "string") throw new Error("Select a valid pay calculation date range.");
    return calculateHrPay(db, validId(employeeId), startDate, endDate);
  });
  secureHandle("hr:payroll:records:list", (_event, id2) => listHrPayrollRecords(db, validId(id2)));
  secureHandle("hr:payroll:item:add", (_event, id2, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.itemType !== "string" || typeof item.description !== "string" || !Number.isSafeInteger(item.amount)) throw new Error("Invalid payroll item details.");
    addHrPayrollItem(db, authenticatedUser.displayName, validId(id2), item);
  });
  secureHandle("hr:payroll:generate", (_event, month, year) => {
    if (!Number.isSafeInteger(month) || !Number.isSafeInteger(year)) throw new Error("Invalid payroll period.");
    generateHrPayroll(db, authenticatedUser.displayName, month, year);
  });
  secureHandle("hr:payroll:approve", (_event, id2) => approveHrPayroll(db, authenticatedUser.displayName, validId(id2)));
  secureHandle("hr:payroll:paid", (_event, id2) => markHrPayrollPaid(db, authenticatedUser.displayName, validId(id2)));
  secureHandle("applications:list", () => listApplications(db));
  secureHandle("customers:list", (_event, search) => {
    if (typeof search !== "string" && search !== void 0) throw new Error("Invalid search query.");
    return listCustomers(db, search).map((customer) => ({
      ...customer,
      photoDataUrl: readImageDataUrl(getCustomerPhotoPath(db, customer.id))
    }));
  });
  secureHandle("customers:get-profile", (_event, id2) => {
    const profile = getCustomerProfile(db, validId(id2));
    profile.customer.photoDataUrl = readImageDataUrl(getCustomerPhotoPath(db, profile.customer.id));
    return profile;
  });
  secureHandle("customers:update", (_event, id2, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid customer details.");
    updateCustomer(db, validId(id2), input);
  });
  secureHandle("customers:set-photo", async (_event, id2) => {
    const customerId = validId(id2);
    getCustomerPhotoPath(db, customerId);
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Profile image", extensions: ["jpg", "jpeg", "png"] }] });
    if (canceled || !filePaths[0]) return null;
    const source = filePaths[0];
    const details2 = await promises.stat(source);
    if (!details2.isFile() || details2.size > 10 * 1024 * 1024) throw new Error("Profile image must be smaller than 10 MB.");
    const extension = node_path.extname(source).toLowerCase();
    if (![".jpg", ".jpeg", ".png"].includes(extension)) throw new Error("Unsupported profile image format.");
    const directory = node_path.join(root, "customer-photos");
    await promises.mkdir(directory, { recursive: true });
    const destination = node_path.join(directory, `${customerId}-${Date.now()}${extension}`);
    await promises.copyFile(source, destination);
    const previous = getCustomerPhotoPath(db, customerId);
    setCustomerPhotoPath(db, customerId, destination);
    if (previous && node_fs.existsSync(previous)) await promises.rm(previous, { force: true });
    return readImageDataUrl(destination);
  });
  secureHandle("customer-documents:upload", async (_event, id2, applicationId) => {
    const customerId = validId(id2);
    getCustomerProfile(db, customerId);
    const recordId = applicationId === void 0 ? null : validId(applicationId);
    if (recordId !== null && !db.prepare("SELECT 1 FROM applications WHERE id = ? AND customer_id = ? AND deleted_at IS NULL").get(recordId, customerId)) {
      throw new Error("Application does not belong to this customer.");
    }
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Customer documents", extensions: ["pdf", "jpg", "jpeg", "png"] }] });
    if (canceled || !filePaths[0]) return null;
    const source = filePaths[0];
    const details2 = await promises.stat(source);
    if (!details2.isFile() || details2.size > 25 * 1024 * 1024) throw new Error("Document must be smaller than 25 MB.");
    const extension = node_path.extname(source).toLowerCase();
    if (![".pdf", ".jpg", ".jpeg", ".png"].includes(extension)) throw new Error("Unsupported document format.");
    const directory = node_path.join(docsDir, "customers", String(customerId));
    await promises.mkdir(directory, { recursive: true });
    const destination = node_path.join(directory, `${Date.now()}-${node_path.basename(source).replace(/[^\w.-]/g, "_")}`);
    await promises.copyFile(source, destination);
    const result = db.prepare(`INSERT INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type)
      VALUES (?, ?, ?, ?, 'Supporting document')`).run(customerId, recordId, node_path.basename(source), destination);
    return { id: Number(result.lastInsertRowid), applicationId: null, category: "Supporting document", fileName: node_path.basename(source), addedAt: (/* @__PURE__ */ new Date()).toISOString(), applicationRecordId: recordId, storage: "customer" };
  });
  secureHandle("customer-documents:open", async (_event, id2) => {
    const row = db.prepare("SELECT file_path FROM customer_documents WHERE id = ?").get(validId(id2));
    if (!row || !node_fs.existsSync(row.file_path)) throw new Error("Customer document file not found.");
    const error = await electron.shell.openPath(row.file_path);
    if (error) throw new Error(error);
  });
  secureHandle("applications:create", (event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid application details.");
    const application = input;
    let passport;
    if (application.passportToken) {
      passport = pendingPassports.get(application.passportToken);
      if (!passport || passport.owner !== event.sender.id || passport.expiresAt < Date.now()) throw new Error("Passport preview expired. Please scan the document again.");
    }
    const storedPath = passport ? node_path.join(docsDir, "passports", `${node_crypto.randomUUID()}${node_path.extname(passport.path).toLowerCase()}`) : void 0;
    if (passport && storedPath) {
      node_fs.mkdirSync(node_path.join(docsDir, "passports"), { recursive: true });
      node_fs.copyFileSync(passport.path, storedPath);
    }
    try {
      const { passportToken: _passportToken, ...details2 } = application;
      const created = createApplication(db, details2, storedPath);
      if (passport) pendingPassports.delete(application.passportToken);
      return created;
    } catch (error) {
      if (storedPath) node_fs.rmSync(storedPath, { force: true });
      throw error;
    }
  });
  secureHandle("applications:move", (_event, id2, status) => {
    if (typeof status !== "string") throw new Error("Invalid pipeline stage.");
    moveApplication(db, validId(id2), status);
  });
  secureHandle("applications:update", (_event, id2, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid application details.");
    updateApplication(db, validId(id2), input);
  });
  secureHandle("applications:activities:list", (_event, id2) => listApplicationActivities(db, validId(id2)));
  secureHandle("applications:activities:add", (_event, id2, activity) => {
    if (!activity || typeof activity !== "object" || Array.isArray(activity) || typeof activity.activityType !== "string" || typeof activity.description !== "string") {
      throw new Error("Invalid activity details.");
    }
    addApplicationActivity(db, validId(id2), activity);
  });
  secureHandle("applications:delete", (_event, id2) => deleteApplication(db, validId(id2)));
  secureHandle("pipelines:list", () => listPipelines(db));
  secureHandle("pipelines:save", (_event, pipeline2) => {
    if (!pipeline2 || typeof pipeline2.name !== "string" || !Array.isArray(pipeline2.stages) || pipeline2.stages.some((stage) => typeof stage !== "string")) throw new Error("Invalid pipeline details.");
    savePipeline(db, pipeline2);
  });
  secureHandle("pipelines:delete", (_event, id2) => deletePipeline(db, validId(id2)));
  secureHandle("catalog:list", (_event, kind) => {
    if (kind !== "visaType" && kind !== "country") throw new Error("Invalid catalog.");
    return listCatalog(db, kind);
  });
  secureHandle("catalog:save", (_event, kind, item) => {
    if (kind !== "visaType" && kind !== "country" || !item || typeof item.name !== "string" || typeof item.active !== "boolean") throw new Error("Invalid catalog entry.");
    saveCatalogItem(db, kind, item);
  });
  secureHandle("catalog:delete", (_event, kind, id2) => {
    if (kind !== "visaType" && kind !== "country") throw new Error("Invalid catalog.");
    deleteCatalogItem(db, kind, validId(id2));
  });
  secureHandle("documents:upload", async (_event, appId) => {
    const id2 = validId(appId);
    const exists = db.prepare("SELECT application_id FROM applications WHERE id = ?").get(id2);
    if (!exists) throw new Error("Application not found.");
    const result = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Documents", extensions: ["pdf", "jpg", "jpeg", "png"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const stat2 = await import("node:fs/promises").then((fs) => fs.stat(source));
    if (stat2.size > 25 * 1024 * 1024) throw new Error("File exceeds the 25 MB limit.");
    const ext = node_path.extname(source).toLowerCase();
    if (![".pdf", ".jpg", ".jpeg", ".png"].includes(ext)) throw new Error("Unsupported document format.");
    const directory = node_path.join(docsDir, "applications", exists.application_id);
    await promises.mkdir(directory, { recursive: true });
    const safeName = `${Date.now()}-${node_path.basename(source).replace(/[^\w.-]/g, "_")}`;
    const destination = node_path.join(directory, safeName);
    await promises.copyFile(source, destination);
    const record2 = db.prepare("INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, ?, ?, ?)").run(id2, "Supporting Document", node_path.basename(source), destination);
    db.prepare("INSERT INTO application_activities(application_id, activity_type, description) VALUES (?, 'Document Added', ?)").run(id2, `Document uploaded: ${node_path.basename(source)}`);
    return db.prepare("SELECT id, (SELECT application_id FROM applications WHERE id = ?) AS applicationId, category, file_name AS fileName, added_at AS addedAt FROM documents WHERE id = ?").get(id2, Number(record2.lastInsertRowid));
  });
  secureHandle("documents:list", (_event, appId) => {
    return db.prepare(`SELECT d.id, a.application_id AS applicationId, d.category, d.file_name AS fileName, d.added_at AS addedAt
      FROM documents d JOIN applications a ON a.id = d.application_id
      WHERE d.application_id = ? ORDER BY d.added_at DESC`).all(validId(appId));
  });
  secureHandle("documents:list-all", () => listAllDocuments(db));
  secureHandle("documents:open", async (_event, documentId) => {
    const item = db.prepare("SELECT file_path FROM documents WHERE id = ?").get(validId(documentId));
    if (!item || !node_fs.existsSync(item.file_path)) throw new Error("Document file not found.");
    const error = await electron.shell.openPath(item.file_path);
    if (error) throw new Error(error);
  });
  secureHandle("settings:get", () => {
    const rows = db.prepare("SELECT key, value FROM app_settings").all();
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return {
      companyName: values.companyName ?? "Blue Line Travel",
      language: values.language === "ar" ? "ar" : "en",
      companyLogoDataUrl: readImageDataUrl(values.companyLogoPath ?? "")
    };
  });
  secureHandle("settings:save", (_event, settings) => {
    if (!settings || typeof settings.companyName !== "string" || settings.companyName.trim().length < 2 || !["en", "ar"].includes(settings.language)) throw new Error("Invalid settings.");
    const save = db.transaction(() => {
      db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)").run("companyName", settings.companyName.trim());
      db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)").run("language", settings.language);
    });
    save();
  });
  secureHandle("settings:users:list", () => {
    requireAdministrator();
    return listApplicationUsers(db);
  });
  secureHandle("settings:users:create", (_event, input) => {
    requireAdministrator();
    return createApplicationUser(db, input);
  });
  secureHandle("settings:users:update", (_event, input) => {
    const actor = requireAdministrator();
    const updated = updateApplicationUser(db, actor.id, input);
    if (updated.id === actor.id) authenticatedUser = updated;
    return updated;
  });
  secureHandle("settings:users:delete", (_event, id2) => {
    const actor = requireAdministrator();
    deleteApplicationUser(db, actor.id, validId(id2));
  });
  secureHandle("settings:set-logo", async () => {
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Company logo", extensions: ["png", "jpg", "jpeg"] }] });
    if (canceled || !filePaths[0]) return null;
    const source = filePaths[0];
    const details2 = await promises.stat(source);
    if (!details2.isFile() || details2.size > 5 * 1024 * 1024) throw new Error("Company logo must be smaller than 5 MB.");
    const extension = node_path.extname(source).toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(extension)) throw new Error("Unsupported logo format.");
    const directory = node_path.join(root, "branding");
    await promises.mkdir(directory, { recursive: true });
    const destination = node_path.join(directory, `company-logo${extension}`);
    await promises.copyFile(source, destination);
    const old = db.prepare("SELECT value FROM app_settings WHERE key = 'companyLogoPath'").get();
    db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('companyLogoPath', ?)").run(destination);
    if (old?.value && old.value !== destination && node_fs.existsSync(old.value)) await promises.rm(old.value, { force: true });
    return readImageDataUrl(destination);
  });
  secureHandle("settings:remove-logo", async () => {
    const old = db.prepare("SELECT value FROM app_settings WHERE key = 'companyLogoPath'").get();
    db.prepare("DELETE FROM app_settings WHERE key = 'companyLogoPath'").run();
    if (old?.value && node_fs.existsSync(old.value)) await promises.rm(old.value, { force: true });
  });
  secureHandle("gemini:settings:get", () => geminiScanner.getSettings());
  secureHandle("gemini:models:list", (_event, apiKey) => {
    if (apiKey !== void 0 && typeof apiKey !== "string") throw new Error("The Gemini API key format is invalid.");
    return geminiScanner.listModels(apiKey);
  });
  secureHandle("gemini:settings:save", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Gemini settings.");
    return geminiScanner.saveSettings(input);
  });
  secureHandle("gemini:connection:test", (_event, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Gemini connection test settings.");
    return geminiScanner.testConnection(input);
  });
  secureHandle("passport:provider:get", async () => (await geminiScanner.getSettings()).provider);
  secureHandle("passport:provider:save", async (_event, provider) => {
    if (provider !== "ocr" && provider !== "gemini") throw new Error("Select a supported passport recognition engine.");
    const settings = await geminiScanner.getSettings();
    return (await geminiScanner.saveSettings({ model: settings.model, provider, apiKey: void 0 })).provider;
  });
  secureHandle("reports:csv", async () => {
    const { canceled, filePath } = await electron.dialog.showSaveDialog({ defaultPath: "BlueLine-Visa-CRM-Applications.csv", filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (canceled || !filePath) return false;
    const rows = listApplications(db);
    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "Application ID,Customer,Phone,Country,Visa Type,Status,Employee,Application Date,Follow-up Date",
      ...rows.map((row) => [row.applicationId, row.customerName, row.phone, row.country, row.visaType, row.status, row.employee, row.applicationDate, row.followUpDate].map(escape).join(","))
    ].join("\r\n");
    await promises.writeFile(filePath, `\uFEFF${csv}`, "utf8");
    return true;
  });
  secureHandle("backup:create", async () => {
    const { canceled, filePath } = await electron.dialog.showSaveDialog({ defaultPath: `BlueLine-Backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.zip`, filters: [{ name: "ZIP backup", extensions: ["zip"] }] });
    if (canceled || !filePath) return false;
    const backupRoot = node_path.join(root, "backups");
    node_fs.mkdirSync(backupRoot, { recursive: true });
    const snapshot = node_path.join(backupRoot, `snapshot-${Date.now()}.db`);
    try {
      await db.backup(snapshot);
      await new Promise((resolve2, reject) => {
        const output = node_fs.createWriteStream(filePath);
        const archive = new yazl.ZipFile();
        archive.outputStream.on("error", reject);
        output.on("error", reject);
        output.on("close", resolve2);
        archive.outputStream.pipe(output);
        archive.addFile(snapshot, "database/blueline.db");
        if (node_fs.existsSync(docsDir)) void addDocuments(archive, docsDir, "documents").then(() => {
          archive.addBuffer(Buffer.from(JSON.stringify({ product: "Blue Line Visa CRM", createdAt: (/* @__PURE__ */ new Date()).toISOString(), format: 1 }, null, 2)), "backup.json");
          archive.end();
        }).catch(reject);
        else {
          archive.addBuffer(Buffer.from(JSON.stringify({ product: "Blue Line Visa CRM", createdAt: (/* @__PURE__ */ new Date()).toISOString(), format: 1 }, null, 2)), "backup.json");
          archive.end();
        }
      });
    } finally {
      await promises.rm(snapshot, { force: true });
    }
    return true;
  });
  secureHandle("passport:inspect", async (event, filePath, preprocessingVariants, requestedProvider) => {
    let extension = "";
    let provider = requestedProvider === "gemini" ? "gemini" : "ocr";
    try {
      if (typeof filePath !== "string" || !filePath.trim()) throw new Error("PASSPORT_VALIDATION_ERROR: Choose a passport image or PDF to inspect.");
      extension = node_path.extname(filePath).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".pdf"].includes(extension)) throw new Error("PASSPORT_VALIDATION_ERROR: Passport inspection supports JPG, JPEG, PNG, or PDF files.");
      const details2 = await promises.stat(filePath).catch((error) => {
        throw new Error(`IMAGE_PROCESSING_ERROR: Unable to access the selected passport file. ${error instanceof Error ? error.message : String(error)}`);
      });
      if (!details2.isFile()) throw new Error("IMAGE_PROCESSING_ERROR: The selected passport scan is not a file.");
      if (details2.size > 25 * 1024 * 1024) throw new Error("IMAGE_PROCESSING_ERROR: Passport scan files must be smaller than 25 MB.");
      if (requestedProvider !== void 0 && requestedProvider !== "ocr" && requestedProvider !== "gemini") {
        throw new Error("PASSPORT_VALIDATION_ERROR: Select a supported passport recognition engine.");
      }
      const mimeType = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : "image/jpeg";
      const variants = validatePassportVariants(preprocessingVariants);
      provider = requestedProvider === "gemini" ? "gemini" : requestedProvider === "ocr" ? "ocr" : (await geminiScanner.getSettings()).provider;
      let ocr = extension === ".pdf" ? { text: "", pages: [], mrz: null, extraction: extractIraqiPassport([], null) } : await recognizePassport(filePath, root, variants, "eng").catch((error) => {
        if (provider === "ocr") throw error;
        recordDiagnostic("passport-ocr-fallback-failed", new Error("Local OCR was unavailable during Gemini-assisted recognition."), false);
        return { text: "", pages: [], mrz: null, extraction: extractIraqiPassport([], null) };
      });
      let diagnostics;
      if (provider === "gemini") {
        const settings = await geminiScanner.getSettings();
        try {
          const result = await geminiScanner.inspectImage(filePath, mimeType, ocr.extraction, settings.model);
          ocr = { ...ocr, extraction: result.extraction };
          diagnostics = result.diagnostics;
        } catch (error) {
          const failure = error instanceof GeminiPassportError ? error : new GeminiPassportError("IPC_HANDLER_ERROR", `IPC_HANDLER_ERROR: ${error instanceof Error ? error.message : "Unexpected Gemini scanner failure."}`, {
            model: settings.model,
            stages: { apiConnection: "pending", imageProcessing: "success", request: "failed", response: "pending", jsonParsing: "pending", validation: "pending" },
            category: "IPC_HANDLER_ERROR",
            message: error instanceof Error ? error.message : "Unexpected Gemini scanner failure."
          });
          diagnostics = failure.diagnostics;
          recordDiagnostic("gemini-passport-scan-failed", new Error(failure.category), false);
        }
      }
      const image = await promises.readFile(filePath);
      const token = node_crypto.randomUUID();
      for (const [key, pending] of pendingPassports) {
        if (pending.expiresAt < Date.now()) pendingPassports.delete(key);
      }
      pendingPassports.set(token, {
        path: filePath,
        owner: event.sender.id,
        fileName: node_path.basename(filePath),
        mimeType,
        expiresAt: Date.now() + 10 * 60 * 1e3
      });
      return {
        token,
        fileName: node_path.basename(filePath),
        mimeType,
        previewDataUrl: `data:${mimeType};base64,${image.toString("base64")}`,
        text: ocr.text,
        fields: ocr.extraction.fields,
        assessments: ocr.extraction.assessments,
        profile: ocr.extraction.profile,
        mrz: ocr.mrz,
        ...diagnostics ? { diagnostics } : {}
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unexpected passport inspection failure.";
      const category = detail.match(/^(API_AUTHENTICATION_ERROR|API_CONNECTION_ERROR|MODEL_NOT_AVAILABLE|IMAGE_PROCESSING_ERROR|IMAGE_UPLOAD_ERROR|GEMINI_EMPTY_RESPONSE|GEMINI_RESPONSE_PARSE_ERROR|PASSPORT_VALIDATION_ERROR|IPC_HANDLER_ERROR)/)?.[1] ?? "IPC_HANDLER_ERROR";
      recordDiagnostic("passport-inspection-failed", new Error(category), false);
      throw new Error(detail.includes(":") ? detail : `${category}: ${detail}`);
    }
  });
  secureHandle("scanner:passport", async () => {
    const { canceled, filePaths } = await electron.dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Passport image", extensions: ["jpg", "jpeg", "png"] }] });
    if (canceled || !filePaths[0]) return null;
    const file = filePaths[0];
    const details2 = await promises.stat(file);
    if (!details2.isFile() || details2.size > 25 * 1024 * 1024) throw new Error("Passport image must be a file smaller than 25 MB.");
    return { fileName: node_path.basename(file), text: (await recognizePassport(file, root)).text };
  });
  await createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) void createWindow().catch(showStartupError);
  });
}).catch(showStartupError);
function showStartupError(error) {
  recordDiagnostic("application-startup-failed", error, true);
  const detail = error instanceof Error ? error.message : String(error);
  electron.dialog.showErrorBox("Blue Line Visa CRM could not start", `${detail}

Please try opening the app again. If the problem continues, share this message with support.`);
  electron.app.quit();
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
function readImageDataUrl(filePath) {
  if (!filePath || !node_fs.existsSync(filePath)) return null;
  const extension = node_path.extname(filePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
  if (!mimeType) return null;
  try {
    const bytes = node_fs.readFileSync(filePath);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    throw new Error(`Unable to read image file: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function readHrEmployeePhotoDataUrl(filePath) {
  if (!filePath || !node_fs.existsSync(filePath)) return null;
  const image = electron.nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scale = Math.min(1, 320 / Math.max(width, height));
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: "good"
  }).toDataURL();
}
function withHrEmployeePhoto(employee) {
  const { photoPath, ...details2 } = employee;
  return { ...details2, photoDataUrl: readHrEmployeePhotoDataUrl(photoPath) };
}
function candidateNameFromFileName(fileName) {
  return node_path.basename(fileName, node_path.extname(fileName)).replace(/[_-]+/g, " ").replace(/^(cv|resume|resumé|curriculum vitae)\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 120);
}
function candidateNameFromText(text2) {
  const ignoredTerms = /\b(curriculum vitae|resume|resumé|personal information|contact details|phone|email|address|profile|summary|objective|experience|education|skills|linkedin)\b/i;
  for (const rawLine of text2.split(/\r?\n/).slice(0, 12)) {
    const line = rawLine.replace(/^[\s*•\-–—]+/, "").trim();
    const words = line.split(/\s+/);
    if (line.length > 80 || words.length < 2 || words.length > 5 || /[\d@:/\\]|https?/i.test(line) || ignoredTerms.test(line) || words.some((word) => word.length > 35)) continue;
    return line;
  }
  return null;
}
function validatePassportVariants(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error("Invalid passport preprocessing data.");
  return value.map((region) => {
    if (!region || typeof region !== "object" || Array.isArray(region)) throw new Error("Invalid passport preprocessing data.");
    const candidate = region;
    if (candidate.label !== "enhanced" && candidate.label !== "deskew-clockwise" && candidate.label !== "deskew-counterclockwise") {
      throw new Error("Invalid passport preprocessing variant.");
    }
    if (!(candidate.imageData instanceof Uint8Array) || candidate.imageData.byteLength === 0 || candidate.imageData.byteLength > 4 * 1024 * 1024 || !Number.isSafeInteger(candidate.width) || Number(candidate.width) < 1 || !Number.isSafeInteger(candidate.height) || Number(candidate.height) < 1) {
      throw new Error("Invalid passport preprocessing image.");
    }
    return { label: candidate.label, imageData: candidate.imageData, width: Number(candidate.width), height: Number(candidate.height) };
  });
}
function recognizePassport(filePath, root, variants = [], languages = "eng+ara") {
  const recognition = passportOcrQueue.then(() => recognizePassportNow(filePath, root, variants, languages));
  passportOcrQueue = recognition.then(() => void 0, () => void 0);
  return recognition.catch((error) => {
    recordDiagnostic("passport-ocr-failed", error, true);
    throw error;
  });
}
async function recognizePassportNow(filePath, root, variants, languages) {
  const require2 = node_module.createRequire(node_path.join(electron.app.getAppPath(), "package.json"));
  const modelsDir = node_path.join(root, "ocr-data");
  await promises.mkdir(modelsDir, { recursive: true });
  for (const language of languages.split("+")) {
    const source = node_path.join(node_path.dirname(require2.resolve(`@tesseract.js-data/${language}`)), "4.0.0_best_int", `${language}.traineddata.gz`);
    const destination = node_path.join(modelsDir, `${language}.traineddata.gz`);
    if (!node_fs.existsSync(destination)) await promises.copyFile(source, destination);
  }
  let workerPromise = passportOcrWorkers.get(languages);
  if (!workerPromise) {
    workerPromise = tesseract_js.createWorker(languages, 1, {
      langPath: modelsDir,
      gzip: true,
      corePath: require2.resolve("tesseract.js-core/tesseract-core.wasm.js")
    });
    passportOcrWorkers.set(languages, workerPromise);
  }
  let worker;
  try {
    worker = await workerPromise;
  } catch (error) {
    if (passportOcrWorkers.get(languages) === workerPromise) passportOcrWorkers.delete(languages);
    throw error;
  }
  const pages = [];
  const texts = [];
  const inputs = [
    { source: "original", image: filePath },
    ...variants.map(({ label, imageData }) => ({ source: label, image: Buffer.from(imageData) }))
  ];
  const originalSize = electron.nativeImage.createFromPath(filePath).getSize();
  if (!originalSize.width || !originalSize.height) throw new Error("The passport image could not be decoded.");
  let extraction2 = extractIraqiPassport([], null);
  let mrz = null;
  for (const input of inputs) {
    await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: tesseract_js.PSM.AUTO });
    const { data } = await worker.recognize(input.image, {}, { blocks: true });
    texts.push(data.text);
    const variant = variants.find((item) => item.label === input.source);
    const imageSize = variant ? { width: variant.width, height: variant.height } : originalSize;
    const page = {
      source: input.source,
      width: imageSize.width,
      height: imageSize.height,
      words: (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))).map((word) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      }))
    };
    pages.push(page);
    const pageMrz = parsePassportMrz(data.text);
    if (pageMrz && (!mrz || pageMrz.checkDigitsValid && !mrz.checkDigitsValid)) mrz = pageMrz;
    extraction2 = extractIraqiPassport(pages, mrz);
    const unresolved = Object.values(extraction2.assessments).some((field) => field.needsReview);
    if (!unresolved) break;
  }
  return { text: texts.join("\n"), pages, mrz, extraction: extraction2 };
}
