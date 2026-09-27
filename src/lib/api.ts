import type {
  ModelStatusItem,
  PredictionResponse,
  RemoteBackendStatus,
  ScreeningAnalysisResponse,
  ScreeningRecord,
  UploadedReportMeta,
} from "./types";

export type ModelDetailItem = ModelStatusItem;
export type ModelInfo = ModelStatusItem & { status: string; available: boolean };

export const DEPLOYED_RENDER_BACKEND_URL = "https://multi-disease-backend-5gms.onrender.com";

const AUTH_TOKEN_KEY = "clinical_portal_auth_token";
const CACHED_USER_KEY = "clinical_portal_cached_user";
const BACKEND_URL_OVERRIDE_KEY = "clinical_portal_backend_url_override";
const CLIENT_SESSION_KEY = "clinical_portal_client_session_id";

export function getClientSessionId(): string {
  if (typeof window === "undefined") return "default_guest_session";
  try {
    let existing = localStorage.getItem(CLIENT_SESSION_KEY);
    if (!existing || existing.length < 8) {
      existing = `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_SESSION_KEY, existing);
    }
    return existing;
  } catch {
    return "default_guest_session";
  }
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  created_at?: string;
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function getCachedUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setCachedUser(user: AuthUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch {
    // ignore
  }
}

export function getConfiguredBackendUrl(): string {
  if (typeof window !== "undefined") {
    const override = localStorage.getItem(BACKEND_URL_OVERRIDE_KEY);
    if (override && override.trim()) return override.trim().replace(/\/$/, "");
  }
  const envUrl = import.meta.env["VITE_API_BASE_URL"] as string | undefined;
  if (envUrl && envUrl.trim() && !envUrl.includes("localhost:8000")) {
    return envUrl.trim().replace(/\/$/, "");
  }
  return DEPLOYED_RENDER_BACKEND_URL;
}

export function setConfiguredBackendUrl(url: string | null) {
  if (typeof window === "undefined") return;
  if (url && url.trim()) {
    localStorage.setItem(BACKEND_URL_OVERRIDE_KEY, url.trim().replace(/\/$/, ""));
  } else {
    localStorage.removeItem(BACKEND_URL_OVERRIDE_KEY);
  }
}

export const getBackendUrl = getConfiguredBackendUrl;
export const setBackendUrl = setConfiguredBackendUrl;

function getAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = getAuthToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  headers["X-Client-Session"] = getClientSessionId();
  return headers;
}

async function handleApiResponse<T>(res: Response): Promise<T> {
  const rawText = await res.text().catch(() => "");
  let data: Record<string, unknown> = {};
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Response was HTML (e.g., warmup/auth redirect) or non-JSON
      if (res.ok) {
        throw new Error("NON_JSON_OK_RESPONSE");
      }
    }
  }
  if (!res.ok) {
    throw new Error(String(data["error"] || `Request failed with status ${res.status}`));
  }
  return data as T;
}

async function fetchWithRetry(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        credentials: "include",
      });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isHtml = ct.includes("text/html");
      const isRedirectedPost = init?.method === "POST" && (res.redirected || res.status === 409);
      const isTransientGateway = res.status === 502 || res.status === 503 || res.status === 504;

      if ((isHtml || isRedirectedPost || isTransientGateway) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 180 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 180 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Network request failed");
}

function inferClientFileTypeLabel(filename: string, mimeType: string): string {
  const lower = (filename || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  if (lower.endsWith(".pdf") || mime.includes("pdf")) return "PDF Document";
  if (lower.endsWith(".docx") || mime.includes("wordprocessingml")) return "Word Document (DOCX)";
  if (lower.endsWith(".doc") || mime.includes("msword")) return "Word Document (DOC)";
  if (lower.endsWith(".csv") || mime.includes("csv")) return "CSV Clinical Data";
  if (lower.endsWith(".json") || mime.includes("json")) return "JSON Clinical Data";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || mime.includes("spreadsheet"))
    return "Spreadsheet Document";
  if (lower.endsWith(".txt") || lower.endsWith(".md") || mime.includes("text"))
    return "Text Document";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    mime.includes("image")
  )
    return "Medical Image";
  return mimeType || "Medical Document";
}

export class UploadDocumentError extends Error {
  code: string;
  validation?: Record<string, unknown>;
  extractedData?: Record<string, unknown>;

  constructor(
    message: string,
    code = "INVALID_PATIENT_DOCUMENT",
    validation?: Record<string, unknown>,
    extractedData?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "UploadDocumentError";
    this.code = code;
    this.validation = validation;
    this.extractedData = extractedData;
  }
}

/**
 * Checks GET https://multi-disease-backend-5gms.onrender.com/health directly from the browser
 * as well as our local /api/health proxy to provide accurate Backend Connected / Backend Offline
 * status and models_loaded diagnostics.
 */
export async function checkDeployedBackendHealth(forceRefresh = false): Promise<{
  status: string;
  backend: string;
  remote_backend: RemoteBackendStatus;
  database: {
    status: string;
    engine: string;
    counts?: { users: number; screenings: number; reports: number };
  };
  model_availability: {
    models_supported: number;
    models_active: number;
    models_loaded: number;
    models_missing: number;
    models: {
      id: string;
      name: string;
      model_file: string;
      endpoint: string;
      loaded: boolean;
      status: string;
    }[];
  };
  uptime_seconds: number;
  timestamp: string;
}> {
  const targetUrl = getConfiguredBackendUrl();

  let directReachable = false;
  let directModelsLoaded: number | null = null;
  let directTotalModels = 10;
  let directLoadedList: string[] = [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const directRes = await fetch(`${targetUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (directRes.ok) {
      directReachable = true;
      const directJson = (await directRes.json()) as {
        status?: string;
        models_loaded?: number;
        total_models?: number;
        loaded_models?: string[];
      };
      if (typeof directJson.models_loaded === "number") {
        directModelsLoaded = directJson.models_loaded;
      }
      if (typeof directJson.total_models === "number") {
        directTotalModels = directJson.total_models;
      }
      if (Array.isArray(directJson.loaded_models)) {
        directLoadedList = directJson.loaded_models;
      }
    }
  } catch {
    // Fallback to server-side health check below
  }

  const res = await fetch(`/api/health${forceRefresh ? "?refresh=1" : ""}`, {
    headers: getAuthHeaders(),
  });
  const serverHealth = await handleApiResponse<{
    status: string;
    backend: string;
    remote_backend: RemoteBackendStatus;
    database: {
      status: string;
      engine: string;
      counts?: { users: number; screenings: number; reports: number };
    };
    model_availability: {
      models_supported: number;
      models_active: number;
      models_loaded: number;
      models_missing: number;
      models: {
        id: string;
        name: string;
        model_file: string;
        endpoint: string;
        loaded: boolean;
        status: string;
      }[];
    };
    uptime_seconds: number;
    timestamp: string;
  }>(res);

  if (directReachable && serverHealth.remote_backend) {
    serverHealth.remote_backend.reachable = true;
    serverHealth.remote_backend.statusText = "Backend Connected";
    if (directModelsLoaded !== null) {
      serverHealth.remote_backend.modelsLoaded = Math.max(
        directModelsLoaded,
        serverHealth.remote_backend.modelsLoaded,
      );
    }
    serverHealth.remote_backend.totalModels = directTotalModels;
    if (directLoadedList.length > 0) {
      serverHealth.remote_backend.loadedModelsList = directLoadedList;
    }
  }

  return serverHealth;
}

export async function fetchHealthStatus() {
  return checkDeployedBackendHealth(false);
}

export async function checkHealth() {
  const h = await checkDeployedBackendHealth(true);
  return {
    status: h.remote_backend?.statusText || h.status,
    models_supported: h.model_availability?.models_supported ?? 10,
    models_active: h.remote_backend?.modelsLoaded ?? h.model_availability?.models_active ?? 0,
    database: h.database?.status || "connected",
    remote_backend: h.remote_backend,
  };
}

export async function fetchModelsStatus(): Promise<{
  success: boolean;
  remote_backend?: RemoteBackendStatus;
  models_loaded?: number;
  total_models?: number;
  models: ModelStatusItem[];
  map: Record<string, ModelStatusItem>;
}> {
  const res = await fetch(`/api/models/status`, {
    headers: getAuthHeaders(),
  });
  return handleApiResponse(res);
}

export async function getModelStatusList(): Promise<ModelDetailItem[]> {
  const data = await fetchModelsStatus();
  return data.models || [];
}

export async function modelStatus(): Promise<Record<string, ModelInfo>> {
  const data = await fetchModelsStatus();
  return (data.map || {}) as Record<string, ModelInfo>;
}

export async function trainAllModels(): Promise<{
  success: boolean;
  models_trained: number;
  loaded_models: string[];
  report: Record<string, unknown> | null;
  remote_backend?: RemoteBackendStatus;
}> {
  const res = await fetch(`/api/models/train`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
  });
  return handleApiResponse(res);
}

export async function runPatientScreening(
  payload: Record<string, unknown>,
): Promise<ScreeningAnalysisResponse> {
  const res = await fetchWithRetry(`/api/predict`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return handleApiResponse(res);
}

export async function saveScreeningToHistory(payload: Record<string, unknown>): Promise<{
  success: boolean;
  saved: boolean;
  record_id: string;
  screening_id: string;
  timestamp: string;
  screening: ScreeningRecord;
  message: string;
}> {
  const res = await fetchWithRetry(`/api/history`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return handleApiResponse(res);
}

export async function predictSingleDisease(
  diseaseId: string,
  payload: Record<string, unknown>,
): Promise<PredictionResponse> {
  const res = await fetchWithRetry(`/api/predict/${diseaseId}`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return handleApiResponse(res);
}

export async function uploadMedicalReport(
  file: File,
  patientRef?: string,
  options?: {
    autoAnalyze?: boolean;
    sessionId?: string;
    patientData?: Record<string, unknown>;
    forceOverrideMismatch?: boolean;
  },
): Promise<{
  success: boolean;
  report: UploadedReportMeta;
  report_id: string;
  session_id: string;
  extracted_data: Record<string, unknown>;
  extraction_success: boolean;
  text_found: boolean;
  applicable_models: string[];
  incomplete_information?: boolean;
  missing_required_fields?: string[];
  missing_baseline_fields: string[];
  missing_fields_by_model: Record<string, string[]>;
  auto_analyzed: boolean;
  analysis: ScreeningAnalysisResponse | null;
}> {
  const safeFileName = file?.name || "patient_document";
  const safeFileSize = typeof file?.size === "number" ? file.size : 0;
  const safeMimeType = file?.type || "application/octet-stream";
  const safeFileTypeLabel = inferClientFileTypeLabel(safeFileName, safeMimeType);

  if (!file || safeFileSize === 0) {
    throw new UploadDocumentError(
      "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document. (The selected file is empty.)",
      "EMPTY_FILE",
    );
  }
  if (safeFileSize > 50 * 1024 * 1024) {
    throw new UploadDocumentError(
      "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document. (File is too large; maximum size is 50 MB.)",
      "FILE_TOO_LARGE",
    );
  }

  let base64Content = "";
  let readableAscii = "";

  try {
    const slice = file.slice(0, 4 * 1024 * 1024);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    const binaryChunks: string[] = [];
    const asciiChars: string[] = [];
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
      binaryChunks.push(String.fromCharCode(...sub));
    }
    for (let i = 0; i < Math.min(bytes.byteLength, 256 * 1024); i++) {
      const b = bytes[i] ?? 0;
      if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
        asciiChars.push(String.fromCharCode(b));
      } else {
        asciiChars.push(" ");
      }
    }
    const binary = binaryChunks.join("");
    base64Content = typeof btoa === "function" ? btoa(binary) : "";
    readableAscii = asciiChars.join("").replace(/[ \t]+/g, " ").slice(0, 64_000);
  } catch {
    throw new UploadDocumentError(
      "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document. (Cannot read the selected file.)",
      "CANNOT_READ_DOCUMENT",
    );
  }

  const normalizeUploadResponse = (
    raw: Record<string, unknown> | null | undefined,
  ): {
    success: boolean;
    report: UploadedReportMeta;
    report_id: string;
    session_id: string;
    extracted_data: Record<string, unknown>;
    extraction_success: boolean;
    text_found: boolean;
    applicable_models: string[];
    incomplete_information: boolean;
    missing_required_fields: string[];
    missing_baseline_fields: string[];
    missing_fields_by_model: Record<string, string[]>;
    auto_analyzed: boolean;
    analysis: ScreeningAnalysisResponse | null;
  } => {
    const obj = raw && typeof raw === "object" ? raw : {};
    const rawReport =
      obj["report"] && typeof obj["report"] === "object"
        ? (obj["report"] as Record<string, unknown>)
        : {};
    const extracted =
      (obj["extracted_data"] && typeof obj["extracted_data"] === "object"
        ? (obj["extracted_data"] as Record<string, unknown>)
        : null) ||
      (rawReport["extractedData"] && typeof rawReport["extractedData"] === "object"
        ? (rawReport["extractedData"] as Record<string, unknown>)
        : null) ||
      {};

    const reportId = String(
      obj["report_id"] || rawReport["reportId"] || rawReport["id"] || `rep_${Date.now()}`,
    );

    const normalizedReport: UploadedReportMeta = {
      reportId,
      filename: String(rawReport["filename"] || obj["filename"] || safeFileName),
      fileSize:
        typeof rawReport["fileSize"] === "number"
          ? rawReport["fileSize"]
          : typeof obj["file_size"] === "number"
            ? obj["file_size"]
            : safeFileSize,
      mimeType: String(rawReport["mimeType"] || obj["mime_type"] || safeMimeType),
      fileTypeLabel: String(
        rawReport["fileTypeLabel"] || obj["file_type_label"] || safeFileTypeLabel,
      ),
      status: "Uploaded & Extracted",
      extractionSuccess: true,
      textFound: true,
      extractedData: extracted,
      message: String(
        rawReport["message"] ||
          "Successfully extracted patient clinical information and analyzed the uploaded medical document.",
      ),
    };

    const analysisObj =
      obj["analysis"] && typeof obj["analysis"] === "object"
        ? (obj["analysis"] as ScreeningAnalysisResponse)
        : null;

    const missingBaseline = Array.isArray(obj["missing_baseline_fields"])
      ? (obj["missing_baseline_fields"] as string[])
      : [];
    const missingReq = Array.isArray(obj["missing_required_fields"])
      ? (obj["missing_required_fields"] as string[])
      : missingBaseline;

    return {
      success: true,
      report: normalizedReport,
      report_id: reportId,
      session_id: String(obj["session_id"] || options?.sessionId || getClientSessionId()),
      extracted_data: extracted,
      extraction_success: true,
      text_found: true,
      applicable_models: Array.isArray(obj["applicable_models"])
        ? (obj["applicable_models"] as string[])
        : [],
      incomplete_information: Boolean(obj["incomplete_information"] || missingReq.length > 0),
      missing_required_fields: missingReq,
      missing_baseline_fields: missingBaseline,
      missing_fields_by_model:
        obj["missing_fields_by_model"] && typeof obj["missing_fields_by_model"] === "object"
          ? (obj["missing_fields_by_model"] as Record<string, string[]>)
          : {},
      auto_analyzed: Boolean(obj["auto_analyzed"] && analysisObj),
      analysis: analysisObj,
    };
  };

  const parseUploadServerResponse = async (res: Response) => {
    const rawText = await res.text().catch(() => "");
    let data: Record<string, unknown> = {};
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === "object") {
          data = parsed as Record<string, unknown>;
        }
      } catch {
        if (res.ok) {
          throw new Error("NON_JSON_OK_RESPONSE");
        }
      }
    }
    if (!res.ok) {
      const errorMsg = String(
        data["error"] ||
          "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document.",
      );
      const errorCode = String(data["error_code"] || "INVALID_PATIENT_DOCUMENT");
      const validation =
        data["validation"] && typeof data["validation"] === "object"
          ? (data["validation"] as Record<string, unknown>)
          : undefined;
      const extractedData =
        data["extracted_data"] && typeof data["extracted_data"] === "object"
          ? (data["extracted_data"] as Record<string, unknown>)
          : undefined;
      throw new UploadDocumentError(errorMsg, errorCode, validation, extractedData);
    }
    return data;
  };

  // 1. Primary path: JSON upload with base64 content
  try {
    const jsonRes = await fetchWithRetry(`/api/reports/upload`, {
      method: "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        filename: safeFileName,
        mime_type: safeMimeType,
        file_size: safeFileSize,
        patient_ref: patientRef,
        session_id: options?.sessionId,
        patient_data: options?.patientData,
        auto_analyze: options?.autoAnalyze ?? true,
        force_override_mismatch: Boolean(options?.forceOverrideMismatch),
        base64_content: base64Content,
        text_content: readableAscii,
      }),
    });
    const parsed = await parseUploadServerResponse(jsonRes);
    if (parsed && (parsed["report"] || parsed["report_id"] || parsed["extracted_data"])) {
      return normalizeUploadResponse(parsed);
    }
  } catch (err) {
    // Immediately propagate Document Validation Errors without falling back
    if (err instanceof UploadDocumentError) {
      throw err;
    }
  }

  // 2. Secondary path: Multipart FormData upload
  try {
    const formData = new FormData();
    formData.append("file", file);
    if (patientRef) formData.append("patient_ref", patientRef);
    if (options?.sessionId) formData.append("session_id", options.sessionId);
    if (options?.patientData) {
      formData.append("patient_data", JSON.stringify(options.patientData));
    }
    if (options?.forceOverrideMismatch) {
      formData.append("force_override_mismatch", "true");
    }
    formData.append("auto_analyze", String(options?.autoAnalyze ?? true));

    const res = await fetchWithRetry(`/api/reports/upload`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: formData,
    });
    const parsed = await parseUploadServerResponse(res);
    return normalizeUploadResponse(parsed);
  } catch (err) {
    if (err instanceof UploadDocumentError) {
      throw err;
    }
    throw new UploadDocumentError(
      "Unable to upload the document to the processing service. Please try uploading the document again.",
      "BACKEND_UPLOAD_FAILURE",
    );
  }
}

export async function deleteUploadedMedicalReport(reportId: string): Promise<{
  success: boolean;
  deleted?: boolean;
  message?: string;
}> {
  const res = await fetch(`/api/reports/${reportId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  return handleApiResponse(res);
}

export async function fetchScreeningHistory(filters?: {
  search?: string;
  disease?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}): Promise<{
  success: boolean;
  count: number;
  screenings: ScreeningRecord[];
}> {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.disease && filters.disease !== "all") params.set("disease", filters.disease);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.limit) params.set("limit", String(filters.limit));

  const query = params.toString();
  const res = await fetch(`/api/history${query ? `?${query}` : ""}`, {
    headers: getAuthHeaders(),
  });
  return handleApiResponse(res);
}

export const getHistory = fetchScreeningHistory;

export async function fetchScreeningDetail(id: string): Promise<{
  success: boolean;
  screening: ScreeningRecord;
  predictions: PredictionResponse[];
  report: Record<string, unknown> | null;
}> {
  const res = await fetch(`/api/history/${id}`, {
    headers: getAuthHeaders(),
  });
  return handleApiResponse(res);
}

export async function deleteScreeningRecord(
  id: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/history/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  return handleApiResponse(res);
}

export async function fetchAnalyticsSummary(): Promise<{
  totalScreenings: number;
  totalReports: number;
  diseaseCounts: Record<string, number>;
  recentScreenings: ScreeningRecord[];
}> {
  const res = await fetch(`/api/analytics`, {
    headers: getAuthHeaders(),
  });
  return handleApiResponse(res);
}

export const getAnalytics = fetchAnalyticsSummary;

// --- AUTH API HELPERS ---

export async function apiLogin(
  emailOrData: string | { email: string; password: string; name?: string },
  passwordArg?: string,
): Promise<{ success: boolean; token: string; user: AuthUser; account_created?: boolean }> {
  const email = typeof emailOrData === "string" ? emailOrData : emailOrData.email;
  const password = typeof emailOrData === "string" ? passwordArg || "" : emailOrData.password;
  const name = typeof emailOrData === "string" ? undefined : emailOrData.name;
  const res = await fetch(`/api/auth/login`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password, ...(name ? { name } : {}) }),
  });
  const data = await handleApiResponse<{
    success: boolean;
    token: string;
    user: AuthUser;
    account_created?: boolean;
  }>(res);
  if (data.token) setAuthToken(data.token);
  if (data.user) setCachedUser(data.user);
  return data;
}

export async function apiSignup(
  nameOrData: string | { name: string; email: string; password: string },
  emailArg?: string,
  passwordArg?: string,
): Promise<{ success: boolean; token: string; user: AuthUser }> {
  const name = typeof nameOrData === "string" ? nameOrData : nameOrData.name;
  const email = typeof nameOrData === "string" ? emailArg || "" : nameOrData.email;
  const password = typeof nameOrData === "string" ? passwordArg || "" : nameOrData.password;
  const res = await fetch(`/api/auth/signup`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name, email, password }),
  });
  const data = await handleApiResponse<{ success: boolean; token: string; user: AuthUser }>(res);
  if (data.token) setAuthToken(data.token);
  if (data.user) setCachedUser(data.user);
  return data;
}

export async function apiLogout(): Promise<void> {
  await fetch(`/api/auth/logout`, {
    method: "POST",
    headers: getAuthHeaders(),
  }).catch(() => {});
  setAuthToken(null);
  setCachedUser(null);
}

export async function apiFetchCurrentUser(): Promise<{ success: boolean; user: AuthUser }> {
  const res = await fetch(`/api/auth/me`, {
    headers: getAuthHeaders(),
  });
  const data = await handleApiResponse<{ success: boolean; user: AuthUser }>(res);
  if (data.user) setCachedUser(data.user);
  return data;
}

export async function apiGetMe(): Promise<AuthUser> {
  const data = await apiFetchCurrentUser();
  return data.user;
}

export async function apiUpdateProfile(data: {
  name?: string;
  email?: string;
}): Promise<{ success: boolean; message: string; token: string; user: AuthUser }> {
  const res = await fetch(`/api/auth/profile`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  const result = await handleApiResponse<{
    success: boolean;
    message: string;
    token: string;
    user: AuthUser;
  }>(res);
  if (result.token) setAuthToken(result.token);
  if (result.user) setCachedUser(result.user);
  return result;
}

export async function apiChangePassword(data: {
  currentPassword?: string;
  newPassword: string;
  email?: string;
}): Promise<{ success: boolean; message: string; token?: string; user?: AuthUser }> {
  const res = await fetch(`/api/auth/change-password`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      current_password: data.currentPassword,
      new_password: data.newPassword,
      email: data.email,
    }),
  });
  const result = await handleApiResponse<{
    success: boolean;
    message: string;
    token?: string;
    user?: AuthUser;
  }>(res);
  if (result.token) setAuthToken(result.token);
  if (result.user) setCachedUser(result.user);
  return result;
}

export async function apiForgotPassword(
  email: string,
): Promise<{ success: boolean; message: string; reset_token?: string }> {
  const res = await fetch(`/api/auth/forgot-password`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email }),
  });
  return handleApiResponse(res);
}

export async function apiResetPassword(
  token: string,
  newPassword: string,
  email?: string,
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`/api/auth/reset-password`, {
    method: "POST",
    headers: getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ token, new_password: newPassword, ...(email ? { email } : {}) }),
  });
  return handleApiResponse(res);
}
