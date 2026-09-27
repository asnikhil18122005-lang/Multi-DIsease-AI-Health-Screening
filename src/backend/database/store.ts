import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DbMedicalReport,
  DbPatient,
  DbPatientSession,
  DbPrediction,
  DbScreening,
  DbUser,
} from "./types";
import { serverLogger } from "../logging/logger";

class PersistentDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor() {
    const dataDir = process.env["STORAGE_DIR"]
      ? path.resolve(process.env["STORAGE_DIR"])
      : path.join(process.cwd(), ".data");

    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        console.warn("Could not create data directory:", err);
      }
    }

    const configuredDbUrl = process.env["DATABASE_URL"];
    if (configuredDbUrl && configuredDbUrl.endsWith(".db")) {
      this.dbPath = path.resolve(configuredDbUrl);
    } else {
      this.dbPath = path.join(dataDir, "health_screening.db");
    }

    try {
      this.db = new DatabaseSync(this.dbPath);
      this.initSchema();
      serverLogger.info("SERVER_STARTUP", "Connected to persistent SQLite database", {
        path: this.dbPath,
      });
    } catch (err) {
      serverLogger.error("DATABASE_ERROR", "Failed to initialize SQLite database", {
        error: String(err),
      });
      throw err;
    }
  }

  private initSchema() {
    try {
      // Enable WAL mode for high concurrency
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = NORMAL;");

      // Users table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          name TEXT NOT NULL,
          reset_token TEXT,
          reset_token_expires INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      `);

      // Patients table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS patients (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          patient_ref TEXT NOT NULL,
          age INTEGER NOT NULL,
          sex TEXT NOT NULL,
          contact TEXT,
          height REAL,
          weight REAL,
          bmi REAL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_patients_user_id ON patients (user_id);
      `);

      // Screenings table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS screenings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          patient_id TEXT,
          patient_ref TEXT NOT NULL,
          selected_diseases TEXT NOT NULL,
          models_run INTEGER NOT NULL,
          status TEXT NOT NULL,
          summary TEXT NOT NULL,
          input_payload TEXT NOT NULL,
          results_payload TEXT NOT NULL,
          report_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_screenings_user ON screenings (user_id, created_at);
      `);

      // Predictions table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS predictions (
          id TEXT PRIMARY KEY,
          screening_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          disease TEXT NOT NULL,
          status TEXT NOT NULL,
          prediction TEXT,
          predicted_class TEXT,
          probability REAL,
          risk_category TEXT NOT NULL,
          explanation TEXT NOT NULL,
          top_features TEXT,
          inputs_used TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_predictions_screening ON predictions (screening_id);
      `);

      // Medical Reports table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS medical_reports (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          storage_path TEXT NOT NULL,
          extracted_data TEXT NOT NULL,
          text_content TEXT,
          screening_id TEXT,
          patient_ref TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reports_user ON medical_reports (user_id);
      `);

      // Patient Sessions table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS patient_sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          patient_data TEXT NOT NULL,
          uploaded_documents TEXT NOT NULL,
          extracted_data TEXT NOT NULL,
          predictions TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON patient_sessions (user_id);
      `);
    } catch (err) {
      serverLogger.error("DATABASE_ERROR", "Error executing schema initialization", {
        error: String(err),
      });
      throw err;
    }
  }

  // --- Users ---
  createUser(user: { email: string; password_hash: string; salt: string; name: string }): DbUser {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, salt, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      user.email.toLowerCase().trim(),
      user.password_hash,
      user.salt,
      user.name.trim(),
      now,
      now,
    );
    return {
      id,
      email: user.email.toLowerCase().trim(),
      password_hash: user.password_hash,
      salt: user.salt,
      name: user.name.trim(),
      created_at: now,
      updated_at: now,
    };
  }

  getUserByEmail(email: string): DbUser | null {
    const stmt = this.db.prepare("SELECT * FROM users WHERE email = ?");
    const row = stmt.get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapUser(row);
  }

  getUserById(id: string): DbUser | null {
    const stmt = this.db.prepare("SELECT * FROM users WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapUser(row);
  }

  setPasswordResetToken(email: string, token: string, expiresAt: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE users SET reset_token = ?, reset_token_expires = ?, updated_at = ? WHERE email = ?
    `);
    const res = stmt.run(token, expiresAt, new Date().toISOString(), email.toLowerCase().trim());
    return Boolean(res.changes && res.changes > 0);
  }

  resetPasswordWithToken(token: string, newHash: string, newSalt: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, salt = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = ?
      WHERE reset_token = ? AND reset_token_expires > ?
    `);
    const res = stmt.run(newHash, newSalt, new Date().toISOString(), token, now);
    return Boolean(res.changes && res.changes > 0);
  }

  updateUserPasswordByEmail(email: string, newHash: string, newSalt: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, salt = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = ?
      WHERE email = ?
    `);
    const res = stmt.run(newHash, newSalt, new Date().toISOString(), email.toLowerCase().trim());
    return Boolean(res.changes && res.changes > 0);
  }

  updateUserPassword(userId: string, newHash: string, newSalt: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE users
      SET password_hash = ?, salt = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = ?
      WHERE id = ?
    `);
    const res = stmt.run(newHash, newSalt, new Date().toISOString(), userId);
    return Boolean(res.changes && res.changes > 0);
  }

  updateUserProfile(userId: string, updates: { name?: string; email?: string }): DbUser | null {
    const existing = this.getUserById(userId);
    if (!existing) return null;

    const nextName = updates.name !== undefined ? updates.name.trim() : existing.name;
    const nextEmail =
      updates.email !== undefined ? updates.email.toLowerCase().trim() : existing.email;
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE users
      SET name = ?, email = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(nextName, nextEmail, now, userId);
    return this.getUserById(userId);
  }

  migrateGuestRecordsToUser(guestScopedId: string, targetUserId: string): void {
    if (!guestScopedId || !targetUserId || guestScopedId === targetUserId) return;
    try {
      this.db
        .prepare("UPDATE patients SET user_id = ? WHERE user_id = ?")
        .run(targetUserId, guestScopedId);
      this.db
        .prepare("UPDATE screenings SET user_id = ? WHERE user_id = ?")
        .run(targetUserId, guestScopedId);
      this.db
        .prepare("UPDATE predictions SET user_id = ? WHERE user_id = ?")
        .run(targetUserId, guestScopedId);
      this.db
        .prepare("UPDATE medical_reports SET user_id = ? WHERE user_id = ?")
        .run(targetUserId, guestScopedId);
      this.db
        .prepare("UPDATE patient_sessions SET user_id = ? WHERE user_id = ?")
        .run(targetUserId, guestScopedId);
    } catch {
      // Ignore non-critical migration errors
    }
  }

  private mapUser(row: Record<string, unknown>): DbUser {
    return {
      id: String(row["id"]),
      email: String(row["email"]),
      password_hash: String(row["password_hash"]),
      salt: String(row["salt"]),
      name: String(row["name"]),
      reset_token: (row["reset_token"] as string) || null,
      reset_token_expires: (row["reset_token_expires"] as number) || null,
      created_at: String(row["created_at"]),
      updated_at: String(row["updated_at"]),
    };
  }

  // --- Patients ---
  createPatient(patient: Omit<DbPatient, "id" | "created_at">): DbPatient {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO patients (id, user_id, name, patient_ref, age, sex, contact, height, weight, bmi, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      patient.user_id,
      patient.name,
      patient.patient_ref,
      patient.age,
      patient.sex,
      patient.contact || null,
      patient.height || null,
      patient.weight || null,
      patient.bmi || null,
      now,
    );
    return {
      ...patient,
      id,
      created_at: now,
    };
  }

  getPatient(id: string): DbPatient | null {
    const stmt = this.db.prepare("SELECT * FROM patients WHERE id = ?");
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row["id"]),
      user_id: String(row["user_id"]),
      name: String(row["name"]),
      patient_ref: String(row["patient_ref"]),
      age: Number(row["age"]),
      sex: String(row["sex"]),
      contact: (row["contact"] as string) || null,
      height: row["height"] !== null ? Number(row["height"]) : null,
      weight: row["weight"] !== null ? Number(row["weight"]) : null,
      bmi: row["bmi"] !== null ? Number(row["bmi"]) : null,
      created_at: String(row["created_at"]),
    };
  }

  // --- Screenings ---
  createScreening(screening: Omit<DbScreening, "id" | "created_at">): DbScreening {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO screenings (id, user_id, patient_id, patient_ref, selected_diseases, models_run, status, summary, input_payload, results_payload, report_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      screening.user_id,
      screening.patient_id || null,
      screening.patient_ref,
      JSON.stringify(screening.selected_diseases),
      screening.models_run,
      screening.status,
      screening.summary,
      JSON.stringify(screening.input_payload),
      JSON.stringify(screening.results_payload),
      screening.report_id || null,
      now,
    );
    return {
      ...screening,
      id,
      created_at: now,
    };
  }

  getScreening(id: string, userId?: string): DbScreening | null {
    let sql = "SELECT * FROM screenings WHERE id = ?";
    const params: (string | number)[] = [id];
    if (userId) {
      sql += " AND user_id = ?";
      params.push(userId);
    }
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapScreening(row);
  }

  listScreenings(options?: {
    userId?: string;
    search?: string;
    disease?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): DbScreening[] {
    let sql = "SELECT * FROM screenings WHERE 1=1";
    const params: (string | number)[] = [];

    if (options?.userId) {
      sql += " AND user_id = ?";
      params.push(options.userId);
    }

    if (options?.search) {
      sql +=
        " AND (id LIKE ? OR patient_ref LIKE ? OR summary LIKE ? OR input_payload LIKE ? OR results_payload LIKE ? OR created_at LIKE ?)";
      const pattern = `%${options.search}%`;
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    if (options?.disease && options.disease !== "all") {
      sql += " AND selected_diseases LIKE ?";
      params.push(`%${options.disease}%`);
    }

    if (options?.dateFrom) {
      sql += " AND created_at >= ?";
      params.push(options.dateFrom);
    }

    if (options?.dateTo) {
      sql += " AND created_at <= ?";
      params.push(options.dateTo + "T23:59:59Z");
    }

    sql += " ORDER BY created_at DESC";

    if (options?.limit && options.limit > 0) {
      sql += " LIMIT ?";
      params.push(options.limit);
    } else {
      sql += " LIMIT 100";
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapScreening(r));
  }

  deleteScreening(id: string, userId?: string): boolean {
    let sql = "DELETE FROM screenings WHERE id = ?";
    const params: string[] = [id];
    if (userId) {
      sql += " AND user_id = ?";
      params.push(userId);
    }
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...params);

    if (res.changes && res.changes > 0) {
      // Also delete corresponding predictions
      const predStmt = this.db.prepare("DELETE FROM predictions WHERE screening_id = ?");
      predStmt.run(id);
      return true;
    }
    return false;
  }

  private mapScreening(row: Record<string, unknown>): DbScreening {
    let selectedDiseases: string[] = [];
    try {
      selectedDiseases = JSON.parse(String(row["selected_diseases"] || "[]"));
    } catch {
      selectedDiseases = [];
    }

    let inputPayload: Record<string, unknown> = {};
    try {
      inputPayload = JSON.parse(String(row["input_payload"] || "{}"));
    } catch {
      inputPayload = {};
    }

    let resultsPayload: Record<string, unknown> = {};
    try {
      resultsPayload = JSON.parse(String(row["results_payload"] || "{}"));
    } catch {
      resultsPayload = {};
    }

    return {
      id: String(row["id"]),
      user_id: String(row["user_id"]),
      patient_id: (row["patient_id"] as string) || null,
      patient_ref: String(row["patient_ref"]),
      selected_diseases: selectedDiseases,
      models_run: Number(row["models_run"]),
      status: (row["status"] as "completed" | "partial" | "error") || "completed",
      summary: String(row["summary"]),
      input_payload: inputPayload,
      results_payload: resultsPayload,
      report_id: (row["report_id"] as string) || null,
      created_at: String(row["created_at"]),
    };
  }

  // --- Predictions ---
  createPrediction(prediction: Omit<DbPrediction, "id" | "created_at">): DbPrediction {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO predictions (id, screening_id, user_id, disease, status, prediction, predicted_class, probability, risk_category, explanation, top_features, inputs_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      prediction.screening_id,
      prediction.user_id,
      prediction.disease,
      prediction.status,
      prediction.prediction || null,
      prediction.predicted_class || null,
      prediction.probability !== null && prediction.probability !== undefined
        ? prediction.probability
        : null,
      prediction.risk_category,
      prediction.explanation,
      JSON.stringify(prediction.top_features || []),
      JSON.stringify(prediction.inputs_used || {}),
      now,
    );
    return {
      ...prediction,
      id,
      created_at: now,
    };
  }

  getPredictionsByScreening(screeningId: string): DbPrediction[] {
    const stmt = this.db.prepare("SELECT * FROM predictions WHERE screening_id = ?");
    const rows = stmt.all(screeningId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r["id"]),
      screening_id: String(r["screening_id"]),
      user_id: String(r["user_id"]),
      disease: String(r["disease"]),
      status: (r["status"] as "available" | "unavailable" | "error") || "unavailable",
      prediction: (r["prediction"] as string) || null,
      predicted_class: (r["predicted_class"] as string) || null,
      probability: r["probability"] !== null ? Number(r["probability"]) : null,
      risk_category: String(r["risk_category"]),
      explanation: String(r["explanation"]),
      top_features: JSON.parse(String(r["top_features"] || "[]")),
      inputs_used: JSON.parse(String(r["inputs_used"] || "{}")),
      created_at: String(r["created_at"]),
    }));
  }

  // --- Medical Reports ---
  createMedicalReport(report: Omit<DbMedicalReport, "id" | "created_at">): DbMedicalReport {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO medical_reports (id, user_id, filename, mime_type, file_size, storage_path, extracted_data, text_content, screening_id, patient_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      report.user_id,
      report.filename,
      report.mime_type,
      report.file_size,
      report.storage_path,
      JSON.stringify(report.extracted_data),
      report.text_content || null,
      report.screening_id || null,
      report.patient_ref || null,
      now,
    );
    return {
      ...report,
      id,
      created_at: now,
    };
  }

  getMedicalReport(id: string, userId?: string): DbMedicalReport | null {
    let sql = "SELECT * FROM medical_reports WHERE id = ?";
    const params: string[] = [id];
    if (userId) {
      sql += " AND user_id = ?";
      params.push(userId);
    }
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row["id"]),
      user_id: String(row["user_id"]),
      filename: String(row["filename"]),
      mime_type: String(row["mime_type"]),
      file_size: Number(row["file_size"]),
      storage_path: String(row["storage_path"]),
      extracted_data: JSON.parse(String(row["extracted_data"] || "{}")),
      text_content: (row["text_content"] as string) || null,
      screening_id: (row["screening_id"] as string) || null,
      patient_ref: (row["patient_ref"] as string) || null,
      created_at: String(row["created_at"]),
    };
  }

  linkReportToScreening(reportId: string, screeningId: string) {
    const stmt = this.db.prepare("UPDATE medical_reports SET screening_id = ? WHERE id = ?");
    stmt.run(screeningId, reportId);
  }

  deleteMedicalReport(id: string, userId?: string): boolean {
    const existing = this.getMedicalReport(id, userId);
    if (!existing) return false;

    if (
      existing.storage_path &&
      existing.storage_path !== "in-memory" &&
      fs.existsSync(existing.storage_path)
    ) {
      try {
        fs.unlinkSync(existing.storage_path);
      } catch {
        // Ignore file unlink failure
      }
    }

    this.db.prepare("UPDATE screenings SET report_id = NULL WHERE report_id = ?").run(id);
    const stmt = userId
      ? this.db.prepare("DELETE FROM medical_reports WHERE id = ? AND user_id = ?")
      : this.db.prepare("DELETE FROM medical_reports WHERE id = ?");
    const res = userId ? stmt.run(id, userId) : stmt.run(id);
    return res.changes > 0;
  }

  // --- Patient Sessions ---
  upsertSession(session: {
    session_id?: string;
    user_id: string;
    patient_data?: Record<string, unknown>;
    uploaded_documents?: Record<string, unknown>[];
    extracted_data?: Record<string, unknown>;
    predictions?: Record<string, unknown>[];
  }): DbPatientSession {
    const id = session.session_id || crypto.randomUUID();
    const existing = this.getSession(id);
    const now = new Date().toISOString();

    const patientData = session.patient_data ?? existing?.patient_data ?? {};
    const uploadedDocuments = session.uploaded_documents ?? existing?.uploaded_documents ?? [];
    const extractedData = session.extracted_data ?? existing?.extracted_data ?? {};
    const predictions = session.predictions ?? existing?.predictions ?? [];
    const createdAt = existing?.created_at ?? now;

    const stmt = this.db.prepare(`
      INSERT INTO patient_sessions (session_id, user_id, patient_data, uploaded_documents, extracted_data, predictions, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        patient_data = excluded.patient_data,
        uploaded_documents = excluded.uploaded_documents,
        extracted_data = excluded.extracted_data,
        predictions = excluded.predictions,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      id,
      session.user_id,
      JSON.stringify(patientData),
      JSON.stringify(uploadedDocuments),
      JSON.stringify(extractedData),
      JSON.stringify(predictions),
      createdAt,
      now,
    );

    return {
      session_id: id,
      user_id: session.user_id,
      patient_data: patientData,
      uploaded_documents: uploadedDocuments,
      extracted_data: extractedData,
      predictions,
      created_at: createdAt,
      updated_at: now,
    };
  }

  getSession(sessionId: string): DbPatientSession | null {
    const stmt = this.db.prepare("SELECT * FROM patient_sessions WHERE session_id = ?");
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      session_id: String(row["session_id"]),
      user_id: String(row["user_id"]),
      patient_data: JSON.parse(String(row["patient_data"] || "{}")),
      uploaded_documents: JSON.parse(String(row["uploaded_documents"] || "[]")),
      extracted_data: JSON.parse(String(row["extracted_data"] || "{}")),
      predictions: JSON.parse(String(row["predictions"] || "[]")),
      created_at: String(row["created_at"]),
      updated_at: String(row["updated_at"]),
    };
  }

  // --- Analytics ---
  getAnalytics(userId?: string) {
    let screeningsCountSql = "SELECT COUNT(*) as cnt FROM screenings";
    let reportsCountSql = "SELECT COUNT(*) as cnt FROM medical_reports";
    const params: (string | number)[] = [];

    if (userId) {
      screeningsCountSql += " WHERE user_id = ?";
      reportsCountSql += " WHERE user_id = ?";
      params.push(userId);
    }

    const scrRow = this.db.prepare(screeningsCountSql).get(...params) as
      { cnt: number } | undefined;
    const repRow = this.db.prepare(reportsCountSql).get(...params) as { cnt: number } | undefined;

    const recentScreenings = this.listScreenings({ userId, limit: 5 });

    const diseaseCounts: Record<string, number> = {};
    for (const s of recentScreenings) {
      for (const d of s.selected_diseases) {
        diseaseCounts[d] = (diseaseCounts[d] || 0) + 1;
      }
    }

    return {
      totalScreenings: scrRow?.cnt ?? 0,
      totalReports: repRow?.cnt ?? 0,
      diseaseCounts,
      recentScreenings,
    };
  }

  // --- Backup Strategy ---
  backupDatabase(): { success: boolean; backupPath: string } {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupDir = path.join(path.dirname(this.dbPath), "backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const backupPath = path.join(backupDir, `health_screening_backup_${timestamp}.db`);
      fs.copyFileSync(this.dbPath, backupPath);

      serverLogger.info("DATABASE_BACKUP", "Database snapshot backup created", { backupPath });
      return { success: true, backupPath };
    } catch (err) {
      serverLogger.error("DATABASE_ERROR", "Failed to create database backup snapshot", {
        error: String(err),
      });
      return { success: false, backupPath: "" };
    }
  }

  getHealthInfo() {
    try {
      const userCount =
        (this.db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number })?.cnt ?? 0;
      const screeningCount =
        (this.db.prepare("SELECT COUNT(*) as cnt FROM screenings").get() as { cnt: number })?.cnt ??
        0;
      const reportCount =
        (this.db.prepare("SELECT COUNT(*) as cnt FROM medical_reports").get() as { cnt: number })
          ?.cnt ?? 0;
      return {
        status: "connected",
        engine: "sqlite",
        path: this.dbPath,
        counts: {
          users: userCount,
          screenings: screeningCount,
          reports: reportCount,
        },
      };
    } catch (err) {
      return {
        status: "error",
        engine: "sqlite",
        error: String(err),
      };
    }
  }
}

export const serverDb = new PersistentDatabase();
