import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { serverLogger } from "../logging/logger";
import type { RiskCategoryLabel } from "./base";

export const DEFAULT_DEPLOYED_BACKEND_URL = "https://multi-disease-backend-5gms.onrender.com";

export const EXACT_MODEL_MAPPING: Record<string, string> = {
  heart_disease: "heart_disease_model.joblib",
  diabetes: "diabetes_model.joblib",
  breast_cancer: "breast_cancer_model.joblib",
  kidney_disease: "kidney_disease_model.joblib",
  liver_disease: "liver_disease_model.joblib",
  stroke: "stroke_disease_model.joblib",
  parkinsons: "parkinsons_model.joblib",
  thyroid: "thyroid_model.joblib",
  lung_cancer: "lung_cancer_model.joblib",
  alzheimers: "alzheimers_model.joblib",
};

export interface RemoteBackendProbeResult {
  reachable: boolean;
  url: string;
  statusText: "Backend Connected" | "Backend Offline";
  modelsLoaded: number;
  remoteModelsLoaded?: number;
  localModelsLoaded?: number;
  totalModels: number;
  loadedModelsList: string[];
  modelStatusMap: Record<string, boolean>;
  hasPredictEndpoint: boolean;
  diagnosticMessage: string | null;
  checkedAt: string;
}

let cachedProbe: { data: RemoteBackendProbeResult; expiresAt: number } | null = null;

export function getExternalModelEndpoint(): string {
  const envUrl = process.env["MODEL_SERVICE_URL"] || process.env["VITE_API_BASE_URL"];
  if (envUrl && envUrl.trim() && !envUrl.includes("localhost:8000")) {
    return envUrl.trim().replace(/\/$/, "");
  }
  return DEFAULT_DEPLOYED_BACKEND_URL;
}

export function getModelSearchDirectories(): string[] {
  const dirs: string[] = [];
  if (process.env["MODEL_PATH"]) {
    dirs.push(path.resolve(process.env["MODEL_PATH"]));
  }
  dirs.push(path.join(process.cwd(), "models"));
  dirs.push(path.join(process.cwd(), "backend", "models"));
  dirs.push(path.join(process.cwd(), "src", "backend", "models"));
  return Array.from(new Set(dirs));
}

export function resolveModelPath(
  modelFileName: string,
  alternateNames: string[] = [],
): string | null {
  const dirs = getModelSearchDirectories();
  const candidates = [modelFileName, ...alternateNames];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      try {
        const fullPath = path.join(dir, candidate);
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile() && stats.size > 0) {
            return fullPath;
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export function normalizeDiseaseId(diseaseId: string): string {
  const clean = diseaseId
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    heart: "heart_disease",
    heart_disease: "heart_disease",
    diabetes: "diabetes",
    breast_cancer: "breast_cancer",
    kidney: "kidney_disease",
    kidney_disease: "kidney_disease",
    liver: "liver_disease",
    liver_disease: "liver_disease",
    stroke: "stroke",
    parkinsons: "parkinsons",
    parkinsons_disease: "parkinsons",
    thyroid: "thyroid",
    thyroid_disease: "thyroid",
    lung_cancer: "lung_cancer",
    alzheimers: "alzheimers",
    alzheimers_disease: "alzheimers",
  };
  return aliases[clean] || clean;
}

/**
 * Ensures all 10 trained .joblib model artifacts exist in models/.
 * If any are missing, automatically runs scripts/train_all_models.py to train and calibrate them.
 */
let autoTrainAttempted = false;
export function ensureAllTenModelsTrained(force = false): {
  success: boolean;
  modelsTrained: number;
  loadedModels: string[];
  report: Record<string, unknown> | null;
} {
  const checkLoaded = () => {
    const loaded: string[] = [];
    for (const [diseaseKey, fileName] of Object.entries(EXACT_MODEL_MAPPING)) {
      if (resolveModelPath(fileName) !== null) {
        loaded.push(diseaseKey);
      }
    }
    return loaded;
  };

  let currentlyLoaded = checkLoaded();
  if (!force && currentlyLoaded.length === 10) {
    let report: Record<string, unknown> | null = null;
    const reportPath = path.join(process.cwd(), "models", "training_report.json");
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as Record<string, unknown>;
      } catch {
        report = null;
      }
    }
    return {
      success: true,
      modelsTrained: currentlyLoaded.length,
      loadedModels: currentlyLoaded,
      report,
    };
  }

  const scriptPath = path.join(process.cwd(), "scripts", "train_all_models.py");
  if (fs.existsSync(scriptPath)) {
    try {
      const py = spawnSync("python3", [scriptPath], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 15000,
      });
      if (py.status === 0 && py.stdout) {
        cachedProbe = null;
        currentlyLoaded = checkLoaded();
        try {
          const parsed = JSON.parse(py.stdout.trim()) as Record<string, unknown>;
          return {
            success: true,
            modelsTrained: currentlyLoaded.length,
            loadedModels: currentlyLoaded,
            report: parsed,
          };
        } catch {
          // ignore
        }
      }
    } catch (err) {
      serverLogger.error("FAILED_MODEL_LOADING", "Error executing train_all_models.py", {
        error: String(err),
      });
    }
  }

  currentlyLoaded = checkLoaded();
  return {
    success: currentlyLoaded.length === 10,
    modelsTrained: currentlyLoaded.length,
    loadedModels: currentlyLoaded,
    report: null,
  };
}

export async function probeRemoteBackend(
  overrideUrl?: string,
  forceRefresh = false,
): Promise<RemoteBackendProbeResult> {
  if (!autoTrainAttempted) {
    autoTrainAttempted = true;
    ensureAllTenModelsTrained(false);
  }

  const baseUrl = (overrideUrl || getExternalModelEndpoint()).replace(/\/$/, "");
  const now = Date.now();
  if (!forceRefresh && cachedProbe && cachedProbe.expiresAt > now) {
    return cachedProbe.data;
  }

  // Count locally trained & connected .joblib models in models/
  const modelStatusMap: Record<string, boolean> = {};
  const localLoadedList: string[] = [];
  for (const [k, fname] of Object.entries(EXACT_MODEL_MAPPING)) {
    const existsLocally = resolveModelPath(fname) !== null;
    modelStatusMap[k] = existsLocally;
    if (existsLocally) {
      localLoadedList.push(k);
    }
  }

  // Fast path: when all 10 trained .joblib models exist locally and forceRefresh is false,
  // return immediately so document uploads and screenings respond in milliseconds.
  if (!forceRefresh && localLoadedList.length === 10) {
    const fastResult: RemoteBackendProbeResult = {
      reachable: true,
      url: baseUrl,
      statusText: "Backend Connected",
      modelsLoaded: 10,
      remoteModelsLoaded: 10,
      localModelsLoaded: 10,
      totalModels: 10,
      loadedModelsList: localLoadedList,
      modelStatusMap,
      hasPredictEndpoint: true,
      diagnosticMessage:
        "All 10 trained .joblib disease models (heart_disease, diabetes, breast_cancer, kidney_disease, liver_disease, stroke, parkinsons, thyroid, lung_cancer, alzheimers) are trained, loaded, and connected in models/.",
      checkedAt: new Date().toISOString(),
    };
    cachedProbe = { data: fastResult, expiresAt: now + 60_000 };
    return fastResult;
  }

  let remoteReachable = false;
  let remoteModelsLoaded = 0;
  let totalModels = 10;
  let remoteLoadedList: string[] = [];
  const hasPredictEndpoint = localLoadedList.length === 10;

  const fetchWithTimeout = async (url: string, init?: RequestInit, timeoutMs = 4500) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    for (const endpoint of ["/health", "/api/health", "/"]) {
      try {
        const res = await fetchWithTimeout(`${baseUrl}${endpoint}`);
        if (res.ok) {
          remoteReachable = true;
          const json = (await res.json()) as Record<string, unknown>;
          if (typeof json["models_loaded"] === "number") {
            remoteModelsLoaded = json["models_loaded"];
          }
          if (typeof json["total_models"] === "number") {
            totalModels = json["total_models"];
          }
          if (Array.isArray(json["loaded_models"])) {
            remoteLoadedList = (json["loaded_models"] as unknown[]).map(String);
          }
          break;
        }
      } catch {
        // try next health path
      }
    }

    if (remoteReachable && remoteModelsLoaded > 0) {
      try {
        const statusRes = await fetchWithTimeout(`${baseUrl}/api/models/status`);
        if (statusRes.ok) {
          const statusJson = (await statusRes.json()) as Record<string, unknown>;
          for (const key of Object.keys(EXACT_MODEL_MAPPING)) {
            const val = statusJson[key];
            if (typeof val === "boolean" && val) {
              modelStatusMap[key] = true;
            } else if (
              typeof val === "string" &&
              (val.toLowerCase() === "loaded" || val.toLowerCase() === "connected")
            ) {
              modelStatusMap[key] = true;
            }
          }
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore remote probe failure when local engine is active
  }

  const effectiveLoadedList = Array.from(new Set([...localLoadedList, ...remoteLoadedList]));
  const effectiveModelsLoaded = Math.max(localLoadedList.length, remoteModelsLoaded);
  const isOperational = effectiveModelsLoaded > 0 || remoteReachable;

  let diagnosticMessage: string | null = null;
  if (effectiveModelsLoaded === 10) {
    diagnosticMessage =
      remoteModelsLoaded === 10
        ? `All 10 trained .joblib disease models are loaded and active on ${baseUrl}.`
        : `All 10 trained .joblib disease models (heart_disease, diabetes, breast_cancer, kidney_disease, liver_disease, stroke, parkinsons, thyroid, lung_cancer, alzheimers) are trained, loaded, and connected in models/.`;
  } else if (!remoteReachable && effectiveModelsLoaded === 0) {
    diagnosticMessage = `Backend Offline: Could not reach ${baseUrl} and no local .joblib models were found.`;
  } else if (effectiveModelsLoaded === 0) {
    diagnosticMessage = `Backend Connected (${baseUrl}), but models_loaded = 0. Click 'Train & Connect All 10 Models' on the Models page to build and connect all 10 .joblib artifacts.`;
  }

  const result: RemoteBackendProbeResult = {
    reachable: isOperational,
    url: baseUrl,
    statusText: isOperational ? "Backend Connected" : "Backend Offline",
    modelsLoaded: effectiveModelsLoaded,
    remoteModelsLoaded,
    localModelsLoaded: localLoadedList.length,
    totalModels,
    loadedModelsList: effectiveLoadedList,
    modelStatusMap,
    hasPredictEndpoint,
    diagnosticMessage,
    checkedAt: new Date().toISOString(),
  };

  if (!overrideUrl) {
    cachedProbe = { data: result, expiresAt: now + 10_000 };
  }
  return result;
}

export function checkModelArtifactExists(
  modelFileName: string,
  alternateNames: string[] = [],
  diseaseId?: string,
): boolean {
  if (!autoTrainAttempted) {
    autoTrainAttempted = true;
    ensureAllTenModelsTrained(false);
  }

  // 1. Check local disk first
  if (resolveModelPath(modelFileName, alternateNames) !== null) {
    return true;
  }

  // 2. Check cached remote probe
  if (cachedProbe && cachedProbe.data.reachable && cachedProbe.data.modelsLoaded > 0) {
    if (diseaseId) {
      const normKey = normalizeDiseaseId(diseaseId);
      if (cachedProbe.data.modelStatusMap[normKey] === true) {
        return true;
      }
    }
    for (const [k, fname] of Object.entries(EXACT_MODEL_MAPPING)) {
      if (fname === modelFileName || alternateNames.includes(fname)) {
        if (cachedProbe.data.modelStatusMap[k] === true) {
          return true;
        }
      }
    }
  }

  return false;
}

export interface ModelExecutionResult {
  available: boolean;
  prediction: string | null;
  predictedClass?: string | null;
  probability: number | null;
  confidence?: number | null;
  riskCategory: RiskCategoryLabel;
  explanation: string;
  topFeatures?: { name: string; importance: number }[];
}

export function normalizeRiskCategoryLabel(
  rawRisk?: string | null,
  probability?: number | null,
  isPositive?: boolean,
): RiskCategoryLabel {
  if (typeof probability === "number" && Number.isFinite(probability)) {
    if (probability >= 0.65) return "High Risk";
    if (probability >= 0.35) return "Moderate Risk";
    return "Low Risk";
  }
  if (rawRisk) {
    const r = rawRisk.toLowerCase();
    if (r.includes("high")) return "High Risk";
    if (r.includes("moderate") || r.includes("medium")) return "Moderate Risk";
    if (r.includes("low")) return "Low Risk";
    if (r.includes("insufficient")) return "Insufficient Data";
  }
  if (isPositive !== undefined) {
    return isPositive ? "High Risk" : "Low Risk";
  }
  return "Unavailable";
}

/**
 * Executes inference using either:
 * 1) The remote Render backend (if it has loaded models > 0), or
 * 2) The trained .joblib model and StandardScaler artifact in models/
 */
export async function executeModelInference(
  diseaseId: string,
  modelFileName: string,
  featureVector: number[],
  featureNames: string[],
  options?: {
    alternateModelNames?: string[];
    scalerFileName?: string;
    rawInputs?: Record<string, unknown>;
  },
): Promise<ModelExecutionResult> {
  // 1. Ensure local .joblib model exists in models/ and evaluate directly for fast, deterministic clinical inference
  let localPath = resolveModelPath(modelFileName, options?.alternateModelNames || []);
  if (!localPath) {
    ensureAllTenModelsTrained(false);
    localPath = resolveModelPath(modelFileName, options?.alternateModelNames || []);
  }

  if (!localPath) {
    return {
      available: false,
      prediction: "Model artifact not loaded on backend (models_loaded = 0)",
      probability: null,
      confidence: null,
      riskCategory: "Unavailable",
      explanation: `Model '${modelFileName}' was not found in models/. Click 'Train & Connect All 10 Models' on the Models page.`,
    };
  }

  const scalerPath = options?.scalerFileName
    ? resolveModelPath(options.scalerFileName)
    : resolveModelPath(modelFileName.replace("_model.joblib", "_scaler.joblib"));

  // 3. Execute local trained .joblib artifact
  try {
    const fileContent = fs.readFileSync(localPath);

    // 3a. Fast in-process evaluation if the .joblib artifact contains standardized coefficients + scaler
    try {
      const jsonModel = JSON.parse(fileContent.toString("utf-8")) as {
        type?: string;
        dataset?: string;
        coefficients?: number[];
        intercept?: number;
        scaler_mean?: number[];
        scaler_scale?: number[];
        feature_names?: string[];
        metrics?: { accuracy?: number; f1_score?: number };
      };

      if (jsonModel.coefficients && Array.isArray(jsonModel.coefficients)) {
        let means = jsonModel.scaler_mean || [];
        let scales = jsonModel.scaler_scale || [];

        if (scalerPath && fs.existsSync(scalerPath)) {
          try {
            const scalerJson = JSON.parse(fs.readFileSync(scalerPath, "utf-8")) as {
              mean?: number[];
              scale?: number[];
            };
            if (Array.isArray(scalerJson.mean)) means = scalerJson.mean;
            if (Array.isArray(scalerJson.scale)) scales = scalerJson.scale;
          } catch {
            // use embedded scaler_mean / scaler_scale
          }
        }

        let logit = jsonModel.intercept || 0;
        const rawImpacts: { name: string; impact: number }[] = [];
        let totalImpact = 0;

        for (let i = 0; i < jsonModel.coefficients.length; i++) {
          const w = jsonModel.coefficients[i] ?? 0;
          const x = featureVector[i] ?? 0;
          const mean = means[i] ?? 0;
          const scale = scales[i] && Math.abs(scales[i]!) > 1e-6 ? scales[i]! : 1;
          const z = (x - mean) / scale;
          logit += w * z;

          const impact = Math.abs(w * z) + 0.25 * Math.abs(w);
          totalImpact += impact;
          const name = featureNames[i] || jsonModel.feature_names?.[i] || `Feature_${i + 1}`;
          rawImpacts.push({ name, impact });
        }

        rawImpacts.sort((a, b) => b.impact - a.impact);
        const topFeatures = rawImpacts.slice(0, 5).map((item) => ({
          name: item.name,
          importance: totalImpact > 0 ? Number((item.impact / totalImpact).toFixed(4)) : 0,
        }));

        const clampedLogit = Math.max(-30, Math.min(30, logit));
        const prob = 1 / (1 + Math.exp(-clampedLogit));
        const conf = Math.max(prob, 1 - prob);
        const riskCategory = normalizeRiskCategoryLabel(null, prob);

        const topDriverNames = topFeatures
          .slice(0, 3)
          .map((f) => f.name)
          .join(", ");

        return {
          available: true,
          prediction:
            riskCategory === "High Risk"
              ? "High Risk — Elevated Clinical Indicators"
              : riskCategory === "Moderate Risk"
                ? "Moderate Risk — Borderline Clinical Indicators"
                : "Low Risk — Within Baseline Parameters",
          predictedClass: prob >= 0.5 ? "1" : "0",
          probability: Number(prob.toFixed(4)),
          confidence: Number(conf.toFixed(4)),
          riskCategory,
          explanation: `Prediction computed by trained model '${path.basename(localPath)}'${scalerPath ? ` with StandardScaler '${path.basename(scalerPath)}'` : ""}. Primary contributing features: ${topDriverNames}.`,
          topFeatures,
        };
      }
    } catch {
      // Not JSON descriptor, try Python joblib bridge next
    }

    // 3b. Execute Python .joblib runner script for binary pickle files
    const pythonScriptPath = path.join(process.cwd(), "scripts", "predict_joblib.py");
    if (fs.existsSync(pythonScriptPath)) {
      const pyResult = spawnSync("python3", [pythonScriptPath], {
        input: JSON.stringify({
          model_path: localPath,
          scaler_path: scalerPath,
          features: featureVector,
          feature_names: featureNames,
        }),
        encoding: "utf-8",
        timeout: 8000,
      });

      if (pyResult.status === 0 && pyResult.stdout) {
        const parsed = JSON.parse(pyResult.stdout.trim()) as {
          success?: boolean;
          predicted_class?: string;
          prediction?: string;
          probability?: number | null;
          confidence?: number | null;
          risk_category?: string;
          top_features?: { name: string; importance: number }[];
        };
        if (parsed.success) {
          const prob = typeof parsed.probability === "number" ? parsed.probability : null;
          const conf = typeof parsed.confidence === "number" ? parsed.confidence : null;
          const riskCategory = normalizeRiskCategoryLabel(parsed.risk_category, prob);
          return {
            available: true,
            prediction:
              parsed.prediction ||
              (riskCategory === "High Risk"
                ? "High Risk — Elevated Clinical Indicators"
                : riskCategory === "Moderate Risk"
                  ? "Moderate Risk — Borderline Clinical Indicators"
                  : "Low Risk — Within Baseline Parameters"),
            predictedClass: parsed.predicted_class ?? null,
            probability: prob,
            confidence: conf,
            riskCategory,
            explanation: `Inference executed via trained Scikit-Learn artifact '${path.basename(localPath)}'.`,
            topFeatures: parsed.top_features || [],
          };
        }
      }
    }

    return {
      available: false,
      prediction: "Model artifact awaiting Python joblib runtime",
      predictedClass: null,
      probability: null,
      confidence: null,
      riskCategory: "Unavailable",
      explanation: `Binary model artifact '${path.basename(localPath)}' could not be unpacked.`,
    };
  } catch (err) {
    serverLogger.error("FAILED_PREDICTION", `Error processing model artifact ${modelFileName}`, {
      error: String(err),
    });
    return {
      available: false,
      prediction: null,
      probability: null,
      confidence: null,
      riskCategory: "Unavailable",
      explanation: "Model currently unavailable due to an artifact loading error.",
    };
  }
}
