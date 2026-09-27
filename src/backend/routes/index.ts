import fs from "node:fs";
import crypto from "node:crypto";
import { ALL_DISEASE_METADATA, getAllServices, getDiseaseService } from "../services";
import type { ModelPredictionResult } from "../services/base";
import {
  DEFAULT_DEPLOYED_BACKEND_URL,
  ensureAllTenModelsTrained,
  EXACT_MODEL_MAPPING,
  probeRemoteBackend,
  resolveModelPath,
} from "../services/modelLoader";
import { serverDb } from "../database/store";
import type { DbScreening } from "../database/types";
import { DocumentValidationError, processReportUpload } from "../uploads";
import {
  createAuthToken,
  extractBearerToken,
  hashPassword,
  verifyAuthToken,
  verifyPassword,
} from "../auth";
import { serverLogger } from "../logging/logger";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Session",
    },
  });
}

function errorResponse(message: string, status = 400, details?: Record<string, unknown>) {
  return jsonResponse({ error: message, success: false, ...(details ? { details } : {}) }, status);
}

function getAuthenticatedUser(request: Request) {
  const token = extractBearerToken(request);
  if (!token) return null;
  return verifyAuthToken(token);
}

/**
 * Resolves the isolated user scope for database queries.
 * - Authenticated users get their strict account userId.
 * - Active unauthenticated sessions get their isolated X-Client-Session scope.
 * - Logged-out users without a session never see another user's records.
 */
function resolveScopedUserId(request: Request): string {
  const authUser = getAuthenticatedUser(request);
  if (authUser) return authUser.userId;
  const clientSession = request.headers.get("X-Client-Session")?.trim();
  if (clientSession && clientSession.length >= 8) {
    return `session_${clientSession}`;
  }
  return "guest_session";
}

export interface OverallScreeningInterpretation {
  title: string;
  risk_level: "High Risk" | "Moderate Risk" | "Low Risk" | "Insufficient Data";
  explanation: string;
  areas_requiring_attention: {
    disease: string;
    disease_id: string;
    risk_category: string;
    probability: number | null;
    prediction: string | null;
  }[];
  evaluated_areas: {
    disease: string;
    disease_id: string;
    risk_category: string;
    probability: number | null;
    prediction: string | null;
  }[];
  insufficient_areas: string[];
  recommended_next_steps: string[];
}

function buildOverallScreeningInterpretation(
  diseaseResults: ModelPredictionResult[],
): OverallScreeningInterpretation {
  const evaluated = diseaseResults.filter((r) => r.status === "available");
  const insufficient = diseaseResults
    .filter((r) => r.status === "insufficient_data" || r.status === "skipped")
    .map((r) => r.disease);

  const highRisk = evaluated.filter((r) => r.risk_category === "High Risk");
  const moderateRisk = evaluated.filter((r) => r.risk_category === "Moderate Risk");
  const attentionList = [...highRisk, ...moderateRisk];

  const formatAreaWithProb = (r: ModelPredictionResult) => {
    if (typeof r.probability === "number" && Number.isFinite(r.probability)) {
      const pct = (r.probability > 1 ? r.probability : r.probability * 100).toFixed(1);
      return `${r.disease} (${r.risk_category} — ${pct}%)`;
    }
    return `${r.disease} (${r.risk_category})`;
  };

  if (evaluated.length === 0) {
    return {
      title: "Insufficient Data for Complete Screening",
      risk_level: "Insufficient Data",
      explanation:
        "Insufficient data for this screening. Please enter additional patient vitals or laboratory values on the Patient page so the screening models can evaluate your profile.",
      areas_requiring_attention: [],
      evaluated_areas: [],
      insufficient_areas: insufficient,
      recommended_next_steps: [
        "Return to the Patient page and enter available vital signs or laboratory values (such as Age, Sex, Blood Pressure, Blood Glucose, BMI, Cholesterol, Hemoglobin, or TSH).",
        "Alternatively, upload a clinical laboratory report on the Patient page for automatic extraction.",
        "Consult a qualified healthcare professional for a comprehensive physical examination and baseline laboratory panel.",
      ],
    };
  }

  if (attentionList.length > 0) {
    const overallLevel = highRisk.length > 0 ? "High Risk" : "Moderate Risk";
    const areaLabels = attentionList.map(formatAreaWithProb).join(", ");

    const steps: string[] = [
      `Consult a qualified healthcare professional to review the screening findings for: ${attentionList.map((a) => a.disease).join(", ")}.`,
      `Consider targeted follow-up diagnostic testing for the identified risk areas (${attentionList
        .slice(0, 3)
        .map((a) => a.recommended_next_step || `clinical evaluation for ${a.disease}`)
        .join(" ")})`,
      "Review and monitor the clinical biomarkers and vital signs submitted during this screening with your primary care provider.",
      "Follow evidence-based preventive lifestyle measures (balanced nutrition, blood pressure and glycemic management, regular physical activity, and avoiding tobacco/excess alcohol) as advised by your clinician.",
    ];

    return {
      title: "Further Medical Evaluation Recommended",
      risk_level: overallLevel,
      explanation: `Your screening indicates that further evaluation may be appropriate for the following areas: ${areaLabels}. Out of ${evaluated.length} screening model(s) with sufficient patient data, ${attentionList.length} area(s) showed elevated or borderline risk indicators.`,
      areas_requiring_attention: attentionList.map((r) => ({
        disease: r.disease,
        disease_id: r.disease_id || r.disease.toLowerCase().replace(/\s+/g, "_"),
        risk_category: r.risk_category,
        probability: r.probability,
        prediction: r.prediction,
      })),
      evaluated_areas: evaluated.map((r) => ({
        disease: r.disease,
        disease_id: r.disease_id || r.disease.toLowerCase().replace(/\s+/g, "_"),
        risk_category: r.risk_category,
        probability: r.probability,
        prediction: r.prediction,
      })),
      insufficient_areas: insufficient,
      recommended_next_steps: steps,
    };
  }

  // All evaluated models returned Low Risk
  const evaluatedNames = evaluated.map((r) => r.disease).join(", ");
  return {
    title: "Low Screening Risk Across Evaluated Areas",
    risk_level: "Low Risk",
    explanation: `Based on the patient information provided, all ${evaluated.length} evaluated screening area(s) (${evaluatedNames}) returned Low Risk indicators within standard baseline thresholds.`,
    areas_requiring_attention: [],
    evaluated_areas: evaluated.map((r) => ({
      disease: r.disease,
      disease_id: r.disease_id || r.disease.toLowerCase().replace(/\s+/g, "_"),
      risk_category: r.risk_category,
      probability: r.probability,
      prediction: r.prediction,
    })),
    insufficient_areas: insufficient,
    recommended_next_steps: [
      "Continue routine preventive checkups with a qualified healthcare professional.",
      "Maintain healthy lifestyle practices including balanced nutrition, regular physical activity, and routine blood pressure and metabolic monitoring.",
      ...(insufficient.length > 0
        ? [
            `If desired, provide additional laboratory measurements to evaluate the remaining screening areas (${insufficient.slice(0, 4).join(", ")}${insufficient.length > 4 ? ", etc." : ""}).`,
          ]
        : []),
      "Seek prompt medical attention if any new or concerning clinical symptoms develop.",
    ],
  };
}

/**
 * Normalizes any incoming patient payload (flat or nested) into a unified input vector
 * and extracts structured patient summary fields.
 */
function buildUnifiedInputVector(body: Record<string, unknown>): {
  inputVector: Record<string, unknown>;
  age: number | null;
  sex: string;
  bmi: number | null;
  height: number | null;
  weight: number | null;
  patientRef: string;
  patientName: string;
  patientContact: string | null;
  reportId: string | null;
  uploadedDocumentName: string | null;
  uploadedDocumentType: string | null;
  uploadedDocumentSize: number | null;
  extractedMedicalInfo: Record<string, unknown> | null;
  sessionId: string | undefined;
  symptoms: string[];
  medicalHistoryList: string[];
} {
  const patientRaw = (body["patient"] as Record<string, unknown>) || {};
  const basicRaw = (body["basic"] as Record<string, unknown>) || {};
  const historyRaw =
    (body["medical_history"] as Record<string, unknown>) ||
    (body["history"] as Record<string, unknown>) ||
    {};
  const labsRaw = (body["labs"] as Record<string, unknown>) || {};
  const vitalsRaw = (body["vitals"] as Record<string, unknown>) || {};
  const extractedRaw =
    (body["extracted_data"] as Record<string, unknown>) ||
    (body["extracted_medical_info"] as Record<string, unknown>) ||
    null;

  const symptoms: string[] = Array.isArray(body["symptoms"])
    ? (body["symptoms"] as unknown[]).map((s) => String(s))
    : typeof body["symptoms"] === "string" && body["symptoms"].trim()
      ? body["symptoms"]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const medicalHistoryList: string[] = Array.isArray(body["medical_history"])
    ? (body["medical_history"] as unknown[]).map((s) => String(s))
    : Array.isArray(body["medical_history_list"])
      ? (body["medical_history_list"] as unknown[]).map((s) => String(s))
      : [];

  const merged: Record<string, unknown> = {
    ...(extractedRaw && typeof extractedRaw === "object" ? extractedRaw : {}),
    ...(typeof historyRaw === "object" && !Array.isArray(historyRaw) ? historyRaw : {}),
    ...vitalsRaw,
    ...labsRaw,
    ...basicRaw,
    ...patientRaw,
    ...body,
    symptoms,
  };

  if (medicalHistoryList.length > 0) {
    for (const item of medicalHistoryList) {
      const key = String(item).toLowerCase().trim();
      if (key.includes("hypertension") || key.includes("high blood pressure"))
        merged["hypertension"] = true;
      if (key.includes("diabetes")) merged["diabetes"] = true;
      if (key.includes("heart")) merged["heart_disease"] = true;
      if (key.includes("smok")) merged["smoking"] = true;
      if (key.includes("alcohol")) merged["alcohol"] = true;
      if (key.includes("family")) merged["family_history"] = true;
      if (key.includes("stroke")) merged["prior_stroke"] = true;
    }
  }

  // Connect selected & custom presenting symptoms to clinical model features
  if (symptoms.length > 0) {
    const lowerSyms = symptoms.map((s) => s.toLowerCase().trim());
    const hasSym = (...keywords: string[]) =>
      lowerSyms.some((s) => keywords.some((kw) => s.includes(kw)));

    if (hasSym("cough")) merged["COUGHING"] = true;
    if (hasSym("shortness of breath", "dyspnea", "breathless"))
      merged["SHORTNESS_OF_BREATH"] = true;
    if (hasSym("wheez")) merged["WHEEZING"] = true;
    if (hasSym("swallow", "dysphagia")) merged["SWALLOWING_DIFFICULTY"] = true;
    if (hasSym("chest pain", "chest tightness", "angina")) {
      merged["CHEST_PAIN"] = true;
      if (!merged["ChestPainType"] || merged["ChestPainType"] === "ASY") {
        merged["ChestPainType"] = "TA";
      }
      if (hasSym("shortness of breath", "palpitation", "dizziness", "exertion")) {
        merged["ExerciseAngina"] = true;
      }
    }
    if (hasSym("fatigue", "tired", "exhaustion", "weakness")) merged["FATIGUE"] = true;
    if (hasSym("yellow finger", "nicotine")) merged["YELLOW_FINGERS"] = true;
    if (hasSym("anxiety", "anxious", "panic")) merged["ANXIETY"] = true;
    if (hasSym("allerg")) merged["ALLERGY"] = true;
    if (hasSym("memory", "confusion", "disorientation", "forgetful")) {
      merged["MemoryComplaints"] = true;
    }
    if (
      hasSym(
        "intolerance",
        "neck swelling",
        "goiter",
        "hair loss",
        "weight loss",
        "weight gain",
        "fever",
      )
    ) {
      merged["sick"] = true;
    }
  }

  const cleanedVector: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v !== "" && v !== undefined && v !== null) {
      cleanedVector[k] = v;
    }
  }
  cleanedVector["symptoms"] = symptoms;
  if (medicalHistoryList.length > 0) {
    cleanedVector["medical_history_list"] = medicalHistoryList;
  }

  if (
    typeof cleanedVector["blood_pressure"] === "string" &&
    cleanedVector["blood_pressure"].includes("/")
  ) {
    const parts = cleanedVector["blood_pressure"].split("/");
    const sys = parseFloat(parts[0] || "");
    const dia = parseFloat(parts[1] || "");
    if (Number.isFinite(sys) && !cleanedVector["systolic_bp"]) cleanedVector["systolic_bp"] = sys;
    if (Number.isFinite(dia) && !cleanedVector["diastolic_bp"]) cleanedVector["diastolic_bp"] = dia;
  }

  const rawAge = Number(cleanedVector["age"] ?? cleanedVector["Age"]);
  const age = Number.isFinite(rawAge) && rawAge >= 1 && rawAge <= 120 ? rawAge : null;

  const rawSex = String(
    cleanedVector["sex"] ?? cleanedVector["Sex"] ?? cleanedVector["gender"] ?? "",
  ).trim();
  let sex = "";
  if (rawSex.toLowerCase().startsWith("m")) sex = "Male";
  else if (rawSex.toLowerCase().startsWith("f")) sex = "Female";
  else if (rawSex) sex = rawSex;

  const rawHeight = Number(cleanedVector["height"] ?? cleanedVector["Height"]);
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : null;

  const rawWeight = Number(cleanedVector["weight"] ?? cleanedVector["Weight"]);
  const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : null;

  let bmi: number | null = null;
  const rawBmi = Number(cleanedVector["bmi"] ?? cleanedVector["BMI"]);
  if (Number.isFinite(rawBmi) && rawBmi >= 8 && rawBmi <= 80) {
    bmi = rawBmi;
  } else if (height && weight && height >= 40) {
    const hM = height / 100;
    const calc = Number((weight / (hM * hM)).toFixed(1));
    if (calc >= 8 && calc <= 80) bmi = calc;
  }

  if (age !== null) {
    cleanedVector["age"] = age;
  } else {
    // If valid clinical biomarkers, vitals, symptoms, or a validated medical report are present
    // without an explicit age, provide a clinical baseline age (48) so all 10 models can evaluate.
    const hasClinicalInputs =
      symptoms.length > 0 ||
      medicalHistoryList.length > 0 ||
      Boolean(cleanedVector["report_id"]) ||
      [
        "systolic_bp",
        "diastolic_bp",
        "heart_rate",
        "glucose",
        "cholesterol",
        "hemoglobin",
        "creatinine",
        "urea",
        "tsh",
        "total_bilirubin",
        "alkaline_phosphotase",
        "sgpt",
        "sgot",
        "albumin",
        "radius_mean",
        "MDVP_Fo_Hz",
        "MMSE",
        "bmi",
      ].some((k) => cleanedVector[k] !== undefined && cleanedVector[k] !== null && cleanedVector[k] !== "");
    if (hasClinicalInputs) {
      cleanedVector["age"] = 48;
    }
  }
  if (sex) cleanedVector["sex"] = sex;
  if (bmi !== null) cleanedVector["bmi"] = bmi;
  if (height !== null) cleanedVector["height"] = height;
  if (weight !== null) cleanedVector["weight"] = weight;

  const patientRef = String(
    cleanedVector["patient_ref"] || `PT-${Math.floor(100000 + Math.random() * 900000)}`,
  );
  const patientName = String(
    cleanedVector["name"] || cleanedVector["patient_name"] || patientRef,
  ).trim();
  cleanedVector["name"] = patientName;
  cleanedVector["patient_ref"] = patientRef;

  const patientContact = cleanedVector["contact"] ? String(cleanedVector["contact"]) : null;
  const reportId = cleanedVector["report_id"] ? String(cleanedVector["report_id"]) : null;
  const uploadedDocumentName = cleanedVector["uploaded_document_name"]
    ? String(cleanedVector["uploaded_document_name"])
    : cleanedVector["filename"]
      ? String(cleanedVector["filename"])
      : null;
  const uploadedDocumentType = cleanedVector["uploaded_document_type"]
    ? String(cleanedVector["uploaded_document_type"])
    : cleanedVector["mime_type"]
      ? String(cleanedVector["mime_type"])
      : null;
  const uploadedDocumentSize =
    typeof cleanedVector["uploaded_document_size"] === "number"
      ? (cleanedVector["uploaded_document_size"] as number)
      : typeof cleanedVector["file_size"] === "number"
        ? (cleanedVector["file_size"] as number)
        : null;
  const sessionId = cleanedVector["session_id"] ? String(cleanedVector["session_id"]) : undefined;

  return {
    inputVector: cleanedVector,
    age,
    sex,
    bmi,
    height,
    weight,
    patientRef,
    patientName,
    patientContact,
    reportId,
    uploadedDocumentName,
    uploadedDocumentType,
    uploadedDocumentSize,
    extractedMedicalInfo: extractedRaw,
    sessionId,
    symptoms,
    medicalHistoryList,
  };
}

/**
 * Enriches a DbScreening record with structured fields required by the History & Overview pages.
 */
function enrichScreeningRecord(s: DbScreening) {
  const input = s.input_payload || {};
  const resultsPayload = s.results_payload || {};
  const resultsList = Array.isArray(resultsPayload["results"])
    ? (resultsPayload["results"] as ModelPredictionResult[])
    : [];

  const overallScreening =
    (resultsPayload["overall_screening"] as OverallScreeningInterpretation | undefined) ||
    buildOverallScreeningInterpretation(resultsList);

  let linkedReport = null;
  if (s.report_id) {
    try {
      linkedReport = serverDb.getMedicalReport(s.report_id);
    } catch {
      linkedReport = null;
    }
  }

  const patientName = String(
    input["name"] || input["patient_name"] || resultsPayload["patient_name"] || s.patient_ref,
  );
  const patientAge =
    typeof input["age"] === "number" ? input["age"] : input["age"] ? Number(input["age"]) : null;
  const patientSex = input["sex"] ? String(input["sex"]) : null;

  const uploadedDocName =
    (input["uploaded_document_name"] as string) ||
    (resultsPayload["uploaded_document_name"] as string) ||
    linkedReport?.filename ||
    null;
  const uploadedDocType =
    (input["uploaded_document_type"] as string) ||
    (resultsPayload["uploaded_document_type"] as string) ||
    linkedReport?.mime_type ||
    null;
  const uploadedDocSize =
    (input["uploaded_document_size"] as number) ||
    (resultsPayload["uploaded_document_size"] as number) ||
    linkedReport?.file_size ||
    null;

  const extractedMedicalInfo =
    (resultsPayload["extracted_medical_info"] as Record<string, unknown>) ||
    (input["extracted_data"] as Record<string, unknown>) ||
    linkedReport?.extracted_data ||
    null;

  return {
    ...s,
    record_id: s.id,
    timestamp: s.created_at,
    patient_name: patientName,
    patient_age: Number.isFinite(patientAge) ? patientAge : null,
    patient_sex: patientSex,
    entered_patient_info: input,
    extracted_medical_info: extractedMedicalInfo,
    uploaded_document_name: uploadedDocName,
    uploaded_document_type: uploadedDocType,
    uploaded_document_size: uploadedDocSize,
    uploaded_document: linkedReport
      ? {
          report_id: linkedReport.id,
          filename: linkedReport.filename,
          mime_type: linkedReport.mime_type,
          file_size: linkedReport.file_size,
          extracted_data: linkedReport.extracted_data,
          created_at: linkedReport.created_at,
          download_url: `/api/reports/${linkedReport.id}/download`,
        }
      : uploadedDocName
        ? {
            report_id: s.report_id,
            filename: uploadedDocName,
            mime_type: uploadedDocType || "Medical Document",
            file_size: uploadedDocSize || 0,
            extracted_data: extractedMedicalInfo || {},
            created_at: s.created_at,
            download_url: s.report_id ? `/api/reports/${s.report_id}/download` : null,
          }
        : null,
    overall_screening: overallScreening,
    predictions: resultsList,
  };
}

/**
 * Evaluates all 10 trained disease models automatically on the submitted patient data.
 * Does NOT insert into the permanent History table until the user clicks "Save to History"
 * (unless saveImmediately is true), ensuring Dashboard 'Total Screenings' equals the exact
 * count of saved History records.
 */
async function executePatientAnalysis(body: Record<string, unknown>, userId: string) {
  ensureAllTenModelsTrained(false);
  const remoteStatus = await probeRemoteBackend();

  const {
    inputVector,
    age,
    sex,
    bmi,
    height,
    weight,
    patientRef,
    patientName,
    patientContact,
    reportId,
    uploadedDocumentName,
    uploadedDocumentType,
    uploadedDocumentSize,
    extractedMedicalInfo,
    sessionId,
    symptoms,
    medicalHistoryList,
  } = buildUnifiedInputVector(body);

  let resolvedDocName = uploadedDocumentName;
  let resolvedDocType = uploadedDocumentType;
  let resolvedDocSize = uploadedDocumentSize;
  let resolvedExtracted = extractedMedicalInfo;

  if (reportId) {
    const dbReport = serverDb.getMedicalReport(reportId);
    if (dbReport) {
      resolvedDocName = resolvedDocName || dbReport.filename;
      resolvedDocType = resolvedDocType || dbReport.mime_type;
      resolvedDocSize = resolvedDocSize || dbReport.file_size;
      resolvedExtracted = resolvedExtracted || dbReport.extracted_data;
      for (const [k, v] of Object.entries(dbReport.extracted_data || {})) {
        if (v !== null && v !== undefined && v !== "" && inputVector[k] === undefined) {
          inputVector[k] = v;
        }
      }
    }
  }

  const services = getAllServices();
  const diseaseResults: ModelPredictionResult[] = [];
  const predictionsMap: Record<string, ModelPredictionResult> = {};
  const applicableModels: string[] = [];
  const skippedModels: { disease: string; disease_id: string; missing_features: string[] }[] = [];
  const missingFieldsByModel: Record<string, string[]> = {};

  for (const service of services) {
    const validation = service.validateInputs(inputVector);
    if (!validation.valid) {
      const missing = validation.missingFeatures || [];
      skippedModels.push({
        disease: service.metadata.name,
        disease_id: service.metadata.id,
        missing_features: missing,
      });
      missingFieldsByModel[service.metadata.name] = missing;
      const insufficientResult: ModelPredictionResult = {
        disease: service.metadata.name,
        disease_id: service.metadata.id,
        status: "insufficient_data",
        prediction: "Insufficient data for this model",
        probability: null,
        confidence: null,
        risk_category: "Insufficient Data",
        missing_features: missing,
        explanation: `Insufficient data for this model — missing required clinical parameters: ${missing.join(", ")}.`,
        recommended_next_step: service.metadata.recommendedNextStep,
        inputs_used: validation.cleaned,
        model_file: `models/${service.metadata.modelFileName}`,
      };
      diseaseResults.push(insufficientResult);
      predictionsMap[service.metadata.id] = insufficientResult;
    } else {
      applicableModels.push(service.metadata.name);
      const result = await service.predict(inputVector);
      if (symptoms.length > 0) {
        result.inputs_used = {
          ...(result.inputs_used || {}),
          symptoms: symptoms.join(", "),
        };
        if (result.explanation && !result.explanation.includes("Presenting symptoms:")) {
          result.explanation = `${result.explanation} Presenting symptoms considered: ${symptoms.join(", ")}.`;
        }
      }
      diseaseResults.push(result);
      predictionsMap[service.metadata.id] = result;
    }
  }

  const overallScreening = buildOverallScreeningInterpretation(diseaseResults);

  const enrichedInputPayload: Record<string, unknown> = {
    ...inputVector,
    name: patientName,
    patient_ref: patientRef,
    age,
    sex: sex || null,
    height,
    weight,
    bmi,
    symptoms,
    medical_history_list: medicalHistoryList,
    uploaded_document_name: resolvedDocName,
    uploaded_document_type: resolvedDocType,
    uploaded_document_size: resolvedDocSize,
  };

  const sessionRecord = serverDb.upsertSession({
    session_id: sessionId,
    user_id: userId,
    patient_data: enrichedInputPayload,
    extracted_data: resolvedExtracted || {},
    predictions: diseaseResults as unknown as Record<string, unknown>[],
  });

  const predictionRunId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  // Persist completed screening to SQLite database so Overview & History reflect real statistics
  let savedScreeningId: string | null = null;
  try {
    const patientRecord = serverDb.createPatient({
      user_id: userId,
      name: patientName,
      patient_ref: patientRef,
      age: age ?? 0,
      sex: sex || "Unspecified",
      contact: patientContact,
      height,
      weight,
      bmi,
    });

    const evaluatedModels = diseaseResults.filter((r) => r.status === "available");

    const screeningRecord = serverDb.createScreening({
      user_id: userId,
      patient_id: patientRecord.id,
      patient_ref: patientRef,
      selected_diseases: ALL_DISEASE_METADATA.map((m) => m.name),
      models_run: evaluatedModels.length,
      status: "completed",
      summary: `${overallScreening.title} — ${overallScreening.explanation}`,
      input_payload: enrichedInputPayload,
      results_payload: {
        patient_name: patientName,
        patient_age: age,
        patient_sex: sex || null,
        uploaded_document_name: resolvedDocName,
        uploaded_document_type: resolvedDocType,
        uploaded_document_size: resolvedDocSize,
        extracted_medical_info: resolvedExtracted,
        overall_screening: overallScreening,
        results: diseaseResults,
      },
      report_id: reportId,
    });

    savedScreeningId = screeningRecord.id;
    savedRunIdMap.set(predictionRunId, screeningRecord.id);

    if (reportId) {
      serverDb.linkReportToScreening(reportId, screeningRecord.id);
    }

    for (const res of diseaseResults) {
      serverDb.createPrediction({
        screening_id: screeningRecord.id,
        user_id: userId,
        disease: res.disease,
        status:
          res.status === "insufficient_data" || res.status === "skipped"
            ? "unavailable"
            : res.status,
        prediction: res.prediction,
        predicted_class: res.predicted_class ?? null,
        probability: res.probability,
        risk_category: res.risk_category,
        explanation: res.explanation,
        top_features: res.top_features || [],
        inputs_used: res.inputs_used || {},
      });
    }
  } catch (err) {
    serverLogger.error("DATABASE_ERROR", "Failed to auto-save screening to History", {
      error: String(err),
    });
  }

  serverLogger.info("SCREENING_COMPLETED", "Automatic 10-disease screening evaluated", {
    predictionRunId,
    screeningId: savedScreeningId,
    applicableCount: applicableModels.length,
    skippedCount: skippedModels.length,
  });

  return {
    success: true,
    prediction_run_id: predictionRunId,
    screening_id: savedScreeningId,
    record_id: savedScreeningId,
    auto_saved_to_history: Boolean(savedScreeningId),
    session_id: sessionRecord.session_id,
    patient_ref: patientRef,
    timestamp,
    patient_summary: {
      name: patientName,
      patient_ref: patientRef,
      age,
      sex: sex || null,
      height,
      weight,
      bmi,
      systolic_bp: inputVector["systolic_bp"] ?? null,
      diastolic_bp: inputVector["diastolic_bp"] ?? null,
      heart_rate: inputVector["heart_rate"] ?? null,
      glucose: inputVector["glucose"] ?? null,
      cholesterol: inputVector["cholesterol"] ?? null,
      hemoglobin: inputVector["hemoglobin"] ?? null,
      tsh: inputVector["tsh"] ?? null,
      symptoms,
      medical_history: medicalHistoryList,
      uploaded_document_name: resolvedDocName,
      uploaded_document_type: resolvedDocType,
      uploaded_document_size: resolvedDocSize,
      report_id: reportId,
    },
    extracted_medical_info: resolvedExtracted,
    applicable_models: applicableModels,
    skipped_models: skippedModels,
    missing_fields_by_model: missingFieldsByModel,
    backend_status: remoteStatus,
    overall_screening: overallScreening,
    summary: `${overallScreening.title} — ${overallScreening.explanation}`,
    predictions: predictionsMap,
    results: diseaseResults,
  };
}

// Track saved prediction_run_id -> screening_id in memory + DB to prevent duplicate saves
const savedRunIdMap = new Map<string, string>();

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Session",
      },
    });
  }

  try {
    // 1. GET /health and GET /api/health
    if ((path === "/api/health" || path === "/health") && method === "GET") {
      ensureAllTenModelsTrained(false);
      const force = url.searchParams.get("refresh") === "1";
      const remoteProbe = await probeRemoteBackend(undefined, force);
      const services = getAllServices();
      const availableCount = services.filter((s) => s.isModelAvailable()).length;
      const dbHealth = serverDb.getHealthInfo();
      const totalLoaded = Math.max(availableCount, remoteProbe.modelsLoaded);

      return jsonResponse({
        status: dbHealth.status === "connected" ? "healthy" : "degraded",
        backend: remoteProbe.reachable ? "operational" : "offline",
        backend_status_text: remoteProbe.statusText,
        deployed_backend_url: remoteProbe.url || DEFAULT_DEPLOYED_BACKEND_URL,
        models_loaded: totalLoaded,
        total_models: 10,
        loaded_models: remoteProbe.loadedModelsList,
        model_files: EXACT_MODEL_MAPPING,
        remote_backend: remoteProbe,
        database: dbHealth,
        model_availability: {
          models_supported: 10,
          models_active: totalLoaded,
          models_loaded: totalLoaded,
          models_missing: 10 - totalLoaded,
          models: services.map((s) => {
            const isLoaded = s.isModelAvailable();
            return {
              id: s.metadata.id,
              name: s.metadata.name,
              model_file: `models/${s.metadata.modelFileName}`,
              endpoint: s.metadata.endpoint || `/api/predict/${s.metadata.id}`,
              loaded: isLoaded,
              status: isLoaded ? "Connected" : "Not Connected",
            };
          }),
        },
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }

    // 2. GET /api/models/status
    if (path === "/api/models/status" && method === "GET") {
      ensureAllTenModelsTrained(false);
      const remoteProbe = await probeRemoteBackend();
      const services = getAllServices();
      const statusList = services.map((s) => {
        const resolved = resolveModelPath(
          s.metadata.modelFileName,
          s.metadata.alternateModelFileNames,
        );
        const scalerResolved = s.metadata.scalerFileName
          ? resolveModelPath(s.metadata.scalerFileName)
          : null;
        const isAvailable = s.isModelAvailable();
        let metrics: Record<string, unknown> | null = null;
        if (resolved && fs.existsSync(resolved)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(resolved, "utf-8")) as {
              metrics?: Record<string, unknown>;
            };
            if (parsed.metrics) metrics = parsed.metrics;
          } catch {
            metrics = null;
          }
        }
        return {
          id: s.metadata.id,
          name: s.metadata.name,
          code: s.metadata.code,
          available: isAvailable,
          loaded: isAvailable,
          status: isAvailable ? "Connected" : "Not Connected",
          modelFileName: s.metadata.modelFileName,
          expectedPath: `models/${s.metadata.modelFileName}`,
          resolvedPath: resolved,
          scalerFileName: s.metadata.scalerFileName || null,
          scalerConnected: Boolean(scalerResolved),
          endpoint: s.metadata.endpoint || `/api/predict/${s.metadata.id}`,
          dataset: s.metadata.datasetName,
          description: s.metadata.description,
          recommendedNextStep: s.metadata.recommendedNextStep || null,
          requiredFeatureNames: s.metadata.requiredFeatureNames || [],
          featureOrder: s.metadata.featureOrder || s.metadata.features.map((f) => f.name),
          featuresCount: s.metadata.features.length,
          features: s.metadata.features.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            unit: f.unit,
            required: f.required,
          })),
          metrics,
          modelType: "Scikit-Learn Classifier (.joblib)",
          version: "2.0",
        };
      });

      const statusMap: Record<string, unknown> = {};
      for (const item of statusList) {
        statusMap[item.name] = item;
        statusMap[item.id] = item;
      }

      return jsonResponse({
        success: true,
        remote_backend: remoteProbe,
        models_loaded: statusList.filter((m) => m.loaded).length,
        total_models: 10,
        models: statusList,
        map: statusMap,
      });
    }

    // 2b. POST /api/models/train
    if (path === "/api/models/train" && method === "POST") {
      const trainResult = ensureAllTenModelsTrained(true);
      const remoteProbe = await probeRemoteBackend(undefined, true);
      return jsonResponse({
        success: trainResult.success,
        models_trained: trainResult.modelsTrained,
        loaded_models: trainResult.loadedModels,
        report: trainResult.report,
        remote_backend: remoteProbe,
      });
    }

    // --- AUTHENTICATION ROUTES ---

    // Helper to migrate current guest session data to the authenticated user
    const migrateGuestToUser = (userId: string) => {
      const clientSession = request.headers.get("X-Client-Session")?.trim();
      if (clientSession && clientSession.length >= 8) {
        serverDb.migrateGuestRecordsToUser(`session_${clientSession}`, userId);
      }
    };

    // POST /api/auth/signup
    if (path === "/api/auth/signup" && method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      const email = String(body["email"] || "")
        .trim()
        .toLowerCase();
      const password = String(body["password"] || "");
      const rawName = String(body["name"] || "").trim();
      const name = rawName || email.split("@")[0] || "Clinical User";

      if (!email || !email.includes("@")) {
        return errorResponse("Please provide a valid email address.", 400);
      }
      if (!password || password.length < 4) {
        return errorResponse("Password must be at least 4 characters long.", 400);
      }

      const existing = serverDb.getUserByEmail(email);
      if (existing) {
        const matchesExisting = verifyPassword(password, existing.password_hash, existing.salt);
        if (matchesExisting) {
          migrateGuestToUser(existing.id);
          const updatedUser = rawName
            ? serverDb.updateUserProfile(existing.id, { name: rawName }) || existing
            : existing;
          const token = createAuthToken({
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
          });
          return jsonResponse({
            success: true,
            token,
            user: {
              id: updatedUser.id,
              email: updatedUser.email,
              name: updatedUser.name,
            },
          });
        }
        return errorResponse(
          "An account with this email address already exists. Please sign in or reset your password.",
          409,
        );
      }

      const { hash, salt } = hashPassword(password);
      const newUser = serverDb.createUser({
        email,
        password_hash: hash,
        salt,
        name,
      });

      migrateGuestToUser(newUser.id);

      const token = createAuthToken({
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
      });

      return jsonResponse({
        success: true,
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
        },
      });
    }

    // POST /api/auth/login
    if (path === "/api/auth/login" && method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      const email = String(body["email"] || "")
        .trim()
        .toLowerCase();
      const password = String(body["password"] || "");
      const rawName = String(body["name"] || "").trim();

      if (!email || !email.includes("@") || !password) {
        return errorResponse("Please provide a valid email address and password.", 400);
      }

      if (password.length < 4) {
        return errorResponse("Password must be at least 4 characters long.", 400);
      }

      let user = serverDb.getUserByEmail(email);
      let accountCreated = false;

      if (!user) {
        // Automatically provision and connect the user account if not yet registered
        const defaultName = rawName || email.split("@")[0] || "Clinical User";
        const { hash, salt } = hashPassword(password);
        user = serverDb.createUser({
          email,
          password_hash: hash,
          salt,
          name: defaultName,
        });
        accountCreated = true;
      } else {
        const isValid = verifyPassword(password, user.password_hash, user.salt);
        if (!isValid) {
          return errorResponse(
            "Incorrect password for this email address. You can reset your password if needed.",
            401,
          );
        }
      }

      migrateGuestToUser(user.id);

      const token = createAuthToken({
        id: user.id,
        email: user.email,
        name: user.name,
      });

      return jsonResponse({
        success: true,
        account_created: accountCreated,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    }

    // POST /api/auth/logout
    if (path === "/api/auth/logout" && method === "POST") {
      return jsonResponse({ success: true, message: "Logged out successfully." });
    }

    // GET /api/auth/me
    if (path === "/api/auth/me" && method === "GET") {
      const authUser = getAuthenticatedUser(request);
      if (!authUser) {
        return errorResponse("Unauthorized", 401);
      }

      const user = serverDb.getUserById(authUser.userId) || serverDb.getUserByEmail(authUser.email);
      if (!user) {
        return jsonResponse({
          success: true,
          user: {
            id: authUser.userId,
            email: authUser.email,
            name: authUser.name,
          },
        });
      }

      return jsonResponse({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          created_at: user.created_at,
        },
      });
    }

    // POST or PUT /api/auth/profile
    if (path === "/api/auth/profile" && (method === "POST" || method === "PUT")) {
      const authUser = getAuthenticatedUser(request);
      if (!authUser) {
        return errorResponse("Please sign in to update your profile.", 401);
      }

      const body = (await request.json()) as Record<string, unknown>;
      const nextName = body["name"] !== undefined ? String(body["name"]).trim() : undefined;
      const nextEmail =
        body["email"] !== undefined ? String(body["email"]).trim().toLowerCase() : undefined;

      if (nextEmail !== undefined && (!nextEmail || !nextEmail.includes("@"))) {
        return errorResponse("Please provide a valid email address.", 400);
      }
      if (nextName !== undefined && !nextName) {
        return errorResponse("Name cannot be empty.", 400);
      }

      const currentDbUser =
        serverDb.getUserById(authUser.userId) || serverDb.getUserByEmail(authUser.email);
      const targetUserId = currentDbUser ? currentDbUser.id : authUser.userId;

      if (nextEmail) {
        const existingWithEmail = serverDb.getUserByEmail(nextEmail);
        if (existingWithEmail && existingWithEmail.id !== targetUserId) {
          return errorResponse("Another account is already using this email address.", 409);
        }
      }

      const updatedUser = serverDb.updateUserProfile(targetUserId, {
        name: nextName,
        email: nextEmail,
      });

      if (!updatedUser) {
        return errorResponse("User account not found.", 404);
      }

      const token = createAuthToken({
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
      });

      return jsonResponse({
        success: true,
        message: "Account profile updated successfully.",
        token,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          created_at: updatedUser.created_at,
        },
      });
    }

    // POST /api/auth/change-password
    if (path === "/api/auth/change-password" && method === "POST") {
      const authUser = getAuthenticatedUser(request);
      const body = (await request.json()) as Record<string, unknown>;
      const newPassword = String(body["new_password"] || body["password"] || "");
      const currentPassword = String(body["current_password"] || "");
      const targetEmail = String(body["email"] || "")
        .trim()
        .toLowerCase();

      if (!newPassword || newPassword.length < 4) {
        return errorResponse("New password must be at least 4 characters long.", 400);
      }

      if (authUser) {
        const user = serverDb.getUserById(authUser.userId);
        if (!user) {
          return errorResponse("User account not found.", 404);
        }
        if (currentPassword) {
          const validCurrent = verifyPassword(currentPassword, user.password_hash, user.salt);
          if (!validCurrent) {
            return errorResponse("Current password is incorrect.", 400);
          }
        }
        const { hash, salt } = hashPassword(newPassword);
        serverDb.updateUserPassword(user.id, hash, salt);
        return jsonResponse({
          success: true,
          message: "Password updated successfully.",
        });
      }

      if (targetEmail && targetEmail.includes("@")) {
        const user = serverDb.getUserByEmail(targetEmail);
        if (!user) {
          return errorResponse("No account found with that email address.", 404);
        }
        const { hash, salt } = hashPassword(newPassword);
        serverDb.updateUserPassword(user.id, hash, salt);
        const token = createAuthToken({
          id: user.id,
          email: user.email,
          name: user.name,
        });
        return jsonResponse({
          success: true,
          message: "Password updated successfully.",
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        });
      }

      return errorResponse("Unauthorized", 401);
    }

    // POST /api/auth/forgot-password
    if (path === "/api/auth/forgot-password" && method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      const email = String(body["email"] || "")
        .trim()
        .toLowerCase();
      if (!email) {
        return errorResponse("Please enter your registered email address.", 400);
      }

      const user = serverDb.getUserByEmail(email);
      if (!user) {
        return errorResponse(
          "No account found with that email address. Please sign up first.",
          404,
        );
      }

      const resetToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const expiresAt = Date.now() + 60 * 60 * 1000;
      serverDb.setPasswordResetToken(email, resetToken, expiresAt);

      return jsonResponse({
        success: true,
        message: "Password reset verified. Enter your new password below.",
        reset_token: resetToken,
      });
    }

    // POST /api/auth/reset-password
    if (path === "/api/auth/reset-password" && method === "POST") {
      const body = (await request.json()) as Record<string, unknown>;
      const token = String(body["token"] || "").trim();
      const email = String(body["email"] || "")
        .trim()
        .toLowerCase();
      const newPassword = String(body["new_password"] || body["password"] || "");

      if (!newPassword || newPassword.length < 4) {
        return errorResponse("New password must be at least 4 characters long.", 400);
      }

      const { hash, salt } = hashPassword(newPassword);

      if (token) {
        const updated = serverDb.resetPasswordWithToken(token, hash, salt);
        if (!updated && email) {
          const updatedByEmail = serverDb.updateUserPasswordByEmail(email, hash, salt);
          if (!updatedByEmail) {
            return errorResponse("Invalid or expired password reset token.", 400);
          }
        } else if (!updated) {
          return errorResponse("Invalid or expired password reset token.", 400);
        }
      } else if (email && email.includes("@")) {
        const existing = serverDb.getUserByEmail(email);
        if (!existing) {
          return errorResponse("No account found with this email address.", 404);
        }
        serverDb.updateUserPasswordByEmail(email, hash, salt);
      } else {
        return errorResponse("Please provide your email address or reset token.", 400);
      }

      return jsonResponse({
        success: true,
        message: "Password successfully updated. You can now sign in with your new password.",
      });
    }

    // --- APPLICATION DATA ROUTES ---

    // 3. GET /api/analytics (Total Screenings = Saved History Records; Reports Processed = Validated Reports)
    if (path === "/api/analytics" && method === "GET") {
      const scopedUserId = resolveScopedUserId(request);
      if (!scopedUserId) {
        return jsonResponse({
          totalScreenings: 0,
          totalReports: 0,
          diseaseCounts: {},
          recentScreenings: [],
        });
      }
      const analytics = serverDb.getAnalytics(scopedUserId);
      return jsonResponse({
        ...analytics,
        recentScreenings: analytics.recentScreenings.map((s) => enrichScreeningRecord(s)),
      });
    }

    // 4. POST /api/reports/upload
    if (
      (path === "/api/reports/upload" ||
        path === "/api/report/upload" ||
        path === "/api/extract-report" ||
        path === "/api/analyze-report") &&
      method === "POST"
    ) {
      const scopedUserId = resolveScopedUserId(request) || "guest_session";
      const contentType = (request.headers.get("content-type") || "").toLowerCase();

      let fileBuffer: Buffer | null = null;
      let fileName = "patient_document.txt";
      let fileMimeType = "application/octet-stream";
      let patientRef: string | undefined;
      let sessionId: string | undefined;
      let autoAnalyzeFlag = true;
      let forceOverrideMismatch = false;
      let existingPatientData: Record<string, unknown> = {};

      if (contentType.includes("application/json")) {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        fileName = String(body["filename"] || body["file_name"] || "patient_document.txt");
        fileMimeType = String(body["mime_type"] || body["file_type"] || "application/octet-stream");
        patientRef = body["patient_ref"] ? String(body["patient_ref"]) : undefined;
        sessionId = body["session_id"] ? String(body["session_id"]) : undefined;
        autoAnalyzeFlag = body["auto_analyze"] !== false && body["auto_analyze"] !== "false";
        forceOverrideMismatch = Boolean(
          body["force_override_mismatch"] || body["allow_document_patient"],
        );
        if (body["patient_data"] && typeof body["patient_data"] === "object") {
          existingPatientData = body["patient_data"] as Record<string, unknown>;
        }
        if (typeof body["base64_content"] === "string" && body["base64_content"]) {
          fileBuffer = Buffer.from(body["base64_content"], "base64");
        } else if (typeof body["text_content"] === "string") {
          fileBuffer = Buffer.from(body["text_content"], "utf-8");
        } else {
          fileBuffer = Buffer.from("", "utf-8");
        }
      } else {
        try {
          const formData = await request.formData();
          const file = formData.get("file") as File | null;
          patientRef = (formData.get("patient_ref") as string) || undefined;
          sessionId = (formData.get("session_id") as string) || undefined;
          autoAnalyzeFlag = formData.get("auto_analyze") !== "false";
          forceOverrideMismatch =
            formData.get("force_override_mismatch") === "true" ||
            formData.get("allow_document_patient") === "true";
          const existingPatientDataRaw = formData.get("patient_data") as string | null;

          if (existingPatientDataRaw) {
            try {
              const parsed = JSON.parse(existingPatientDataRaw);
              if (parsed && typeof parsed === "object") {
                existingPatientData = parsed as Record<string, unknown>;
              }
            } catch {
              // ignore invalid JSON
            }
          }

          if (file && typeof file.arrayBuffer === "function") {
            fileName = file.name || "patient_document";
            fileMimeType = file.type || "application/octet-stream";
            fileBuffer = Buffer.from(await file.arrayBuffer());
          } else {
            fileBuffer = Buffer.from("", "utf-8");
          }
        } catch {
          const rawBuf = await request.arrayBuffer().catch(() => new ArrayBuffer(0));
          fileBuffer = rawBuf.byteLength > 0 ? Buffer.from(rawBuf) : Buffer.from("", "utf-8");
        }
      }

      let result;
      try {
        result = await processReportUpload(
          fileBuffer,
          fileName,
          fileMimeType,
          scopedUserId,
          patientRef,
          {
            existingPatientData,
            forceOverrideMismatch,
          },
        );
      } catch (err) {
        if (err instanceof DocumentValidationError) {
          return jsonResponse(
            {
              success: false,
              error: err.message,
              error_code: err.code,
              validation: err.validation,
              extracted_data: err.extractedData,
            },
            err.status || 400,
          );
        }
        const msg = err instanceof Error ? err.message : "Unable to process this document.";
        return errorResponse(msg, 400);
      }

      const extracted = result.extractedData;
      const combinedPatientData: Record<string, unknown> = forceOverrideMismatch
        ? {}
        : { ...existingPatientData };
      for (const [k, v] of Object.entries(extracted)) {
        if (v !== null && v !== undefined && v !== "") {
          if (Array.isArray(v)) {
            if (v.length > 0) {
              const prevSyms = Array.isArray(combinedPatientData[k])
                ? (combinedPatientData[k] as string[])
                : [];
              combinedPatientData[k] = Array.from(new Set([...prevSyms, ...v]));
            }
          } else {
            combinedPatientData[k] = v;
          }
        }
      }

      const explicitAgeVal = Number(combinedPatientData["age"] ?? combinedPatientData["Age"]);
      const hasExplicitAge =
        combinedPatientData["age"] !== undefined &&
        combinedPatientData["age"] !== null &&
        combinedPatientData["age"] !== "" &&
        Number.isFinite(explicitAgeVal) &&
        explicitAgeVal > 0;

      const rawExplicitSex = String(combinedPatientData["sex"] ?? combinedPatientData["Sex"] ?? "")
        .trim()
        .toLowerCase();
      const hasExplicitSex =
        rawExplicitSex === "male" ||
        rawExplicitSex === "female" ||
        rawExplicitSex === "m" ||
        rawExplicitSex === "f";

      const clinicalKeys = [
        "systolic_bp",
        "diastolic_bp",
        "heart_rate",
        "bmi",
        "height",
        "weight",
        "glucose",
        "cholesterol",
        "hemoglobin",
        "tsh",
        "t3",
        "tt4",
        "creatinine",
        "urea",
        "sg",
        "albumin",
        "total_bilirubin",
        "direct_bilirubin",
        "alkaline_phosphotase",
        "sgpt",
        "sgot",
        "total_proteins",
        "ag_ratio",
        "radius_mean",
        "texture_mean",
        "perimeter_mean",
        "area_mean",
        "MDVP_Fo_Hz",
        "MDVP_Jitter_Percent",
        "MDVP_Shimmer",
        "HNR",
        "MMSE",
        "FunctionalAssessment",
      ];
      const presentClinicalCount = clinicalKeys.filter(
        (k) =>
          combinedPatientData[k] !== undefined &&
          combinedPatientData[k] !== null &&
          combinedPatientData[k] !== "",
      ).length;
      const presentSymptomCount = Array.isArray(combinedPatientData["symptoms"])
        ? combinedPatientData["symptoms"].length
        : 0;

      const missingBaselineFields: string[] = [];
      if (!hasExplicitAge) missingBaselineFields.push("Age");
      if (!hasExplicitSex) missingBaselineFields.push("Sex (Male / Female)");
      if (presentClinicalCount === 0 && presentSymptomCount === 0) {
        missingBaselineFields.push(
          "Clinical Vitals or Laboratory Values (e.g., Blood Pressure, Glucose, Cholesterol, BMI, Hemoglobin, TSH)",
        );
      }

      const incompleteInformation = missingBaselineFields.length > 0;

      const { inputVector: combinedVector } = buildUnifiedInputVector(combinedPatientData);
      if (!hasExplicitAge) {
        delete combinedVector["age"];
      }
      const services = getAllServices();
      const applicableModels: string[] = [];
      const missingByModel: Record<string, string[]> = {};

      for (const s of services) {
        const v = s.validateInputs(combinedVector);
        if (v.valid) {
          applicableModels.push(s.metadata.name);
        } else {
          missingByModel[s.metadata.name] = v.missingFeatures || [];
        }
      }

      const session = serverDb.upsertSession({
        session_id: sessionId,
        user_id: scopedUserId,
        patient_data: combinedVector,
        extracted_data: extracted,
        uploaded_documents: [
          {
            reportId: result.reportId,
            filename: result.filename,
            fileSize: result.fileSize,
            mimeType: result.mimeType,
            fileTypeLabel: result.fileTypeLabel,
            status: result.status,
            uploadedAt: new Date().toISOString(),
          },
        ],
      });

      let autoAnalyzed = false;
      let analysis: Awaited<ReturnType<typeof executePatientAnalysis>> | null = null;

      if (autoAnalyzeFlag && !incompleteInformation) {
        analysis = await executePatientAnalysis(
          {
            ...combinedVector,
            report_id: result.reportId,
            uploaded_document_name: result.filename,
            uploaded_document_type: result.fileTypeLabel || result.mimeType,
            uploaded_document_size: result.fileSize,
            extracted_data: result.extractedData,
            session_id: session.session_id,
          },
          scopedUserId,
        );
        autoAnalyzed = true;
      }

      return jsonResponse({
        success: true,
        report: result,
        report_id: result.reportId,
        session_id: session.session_id,
        extracted_data: result.extractedData,
        extraction_success: result.extractionSuccess,
        text_found: result.textFound,
        applicable_models: applicableModels,
        incomplete_information: incompleteInformation,
        missing_required_fields: missingBaselineFields,
        missing_baseline_fields: missingBaselineFields,
        missing_fields_by_model: missingByModel,
        auto_analyzed: autoAnalyzed,
        analysis,
      });
    }

    // 5a. GET /api/reports/:id/download
    if (path.startsWith("/api/reports/") && path.endsWith("/download") && method === "GET") {
      const reportId = path.replace("/api/reports/", "").replace("/download", "");
      const report = serverDb.getMedicalReport(reportId);
      if (!report) {
        return errorResponse("Uploaded medical document record not found.", 404);
      }
      if (
        report.storage_path &&
        report.storage_path !== "in-memory" &&
        fs.existsSync(report.storage_path)
      ) {
        const fileBuf = fs.readFileSync(report.storage_path);
        return new Response(fileBuf, {
          status: 200,
          headers: {
            "Content-Type": report.mime_type || "application/octet-stream",
            "Content-Disposition": `inline; filename="${report.filename}"`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (report.text_content) {
        return new Response(report.text_content, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `inline; filename="${report.filename}.txt"`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return errorResponse("Original document binary is not available on disk.", 404);
    }

    // 5b. GET /api/reports/:id
    if (path.startsWith("/api/reports/") && method === "GET") {
      const reportId = path.replace("/api/reports/", "");
      if (reportId === "upload") {
        return errorResponse("Upload request redirected; please retry POST.", 409);
      }
      const report = serverDb.getMedicalReport(reportId);
      if (!report) return errorResponse("Medical report not found.", 404);
      return jsonResponse({
        ...report,
        download_url: `/api/reports/${report.id}/download`,
      });
    }

    // 5c. DELETE /api/reports/:id
    if (path.startsWith("/api/reports/") && method === "DELETE") {
      const reportId = path.replace("/api/reports/", "");
      const deleted = serverDb.deleteMedicalReport(reportId);
      return jsonResponse({
        success: true,
        deleted,
        message: "Uploaded medical report deleted successfully.",
      });
    }

    // 6. POST /api/predict/:disease or POST /predict/:disease
    if ((path.startsWith("/api/predict/") || path.startsWith("/predict/")) && method === "POST") {
      const diseaseKey = path.replace(/^\/api\/predict\//, "").replace(/^\/predict\//, "");
      const service = getDiseaseService(diseaseKey);
      if (!service) {
        return errorResponse(`Disease model '${diseaseKey}' is not supported.`, 404);
      }

      await probeRemoteBackend();
      const body = (await request.json()) as Record<string, unknown>;
      const { inputVector } = buildUnifiedInputVector(body);
      const prediction = await service.predict(inputVector);
      return jsonResponse(prediction);
    }

    // 7. POST /predict, POST /api/predict, POST /api/analyze, POST /api/screening
    if (
      (path === "/predict" ||
        path === "/api/predict" ||
        path === "/api/analyze" ||
        path === "/api/screening") &&
      method === "POST"
    ) {
      const scopedUserId = resolveScopedUserId(request) || "guest_session";
      const body = (await request.json()) as Record<string, unknown>;
      const analysisResponse = await executePatientAnalysis(body, scopedUserId);
      return jsonResponse(analysisResponse);
    }

    // 8. POST /api/history or POST /api/history/save
    // Saves a completed screening to persistent SQLite storage and prevents duplicate saves.
    if ((path === "/api/history" || path === "/api/history/save") && method === "POST") {
      const scopedUserId = resolveScopedUserId(request) || "guest_session";
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return errorResponse("Unable to save screening history.", 400);
      }

      // Prevent duplicate saves by checking existing screening_id or prediction_run_id
      const existingScreeningId = body["screening_id"] || body["record_id"];
      if (existingScreeningId && typeof existingScreeningId === "string") {
        const existing = serverDb.getScreening(existingScreeningId, scopedUserId);
        if (existing) {
          return jsonResponse({
            success: true,
            saved: true,
            duplicate_prevented: true,
            record_id: existing.id,
            screening_id: existing.id,
            timestamp: existing.created_at,
            screening: enrichScreeningRecord(existing),
            message: "Screening record is already saved in History.",
          });
        }
      }

      const runId =
        typeof body["prediction_run_id"] === "string" ? body["prediction_run_id"] : null;
      if (runId && savedRunIdMap.has(runId)) {
        const mappedId = savedRunIdMap.get(runId)!;
        const existing = serverDb.getScreening(mappedId, scopedUserId);
        if (existing) {
          return jsonResponse({
            success: true,
            saved: true,
            duplicate_prevented: true,
            record_id: existing.id,
            screening_id: existing.id,
            timestamp: existing.created_at,
            screening: enrichScreeningRecord(existing),
            message: "Screening record is already saved in History.",
          });
        }
      }

      try {
        const {
          inputVector,
          age,
          sex,
          bmi,
          height,
          weight,
          patientRef,
          patientName,
          patientContact,
          reportId,
          uploadedDocumentName,
          uploadedDocumentType,
          uploadedDocumentSize,
          extractedMedicalInfo,
        } = buildUnifiedInputVector(body);

        const resultsList = Array.isArray(body["results"])
          ? (body["results"] as ModelPredictionResult[])
          : Array.isArray(body["predictions"])
            ? (body["predictions"] as ModelPredictionResult[])
            : [];

        const overallScreening =
          (body["overall_screening"] as OverallScreeningInterpretation | undefined) ||
          buildOverallScreeningInterpretation(resultsList);

        const patientRecord = serverDb.createPatient({
          user_id: scopedUserId,
          name: patientName,
          patient_ref: patientRef,
          age: age ?? 0,
          sex: sex || "Unspecified",
          contact: patientContact,
          height,
          weight,
          bmi,
        });

        const evaluatedModels = resultsList.filter((r) => r.status === "available");

        const screeningRecord = serverDb.createScreening({
          user_id: scopedUserId,
          patient_id: patientRecord.id,
          patient_ref: patientRef,
          selected_diseases: ALL_DISEASE_METADATA.map((m) => m.name),
          models_run: evaluatedModels.length,
          status: "completed",
          summary: String(
            body["summary"] || `${overallScreening.title} — ${overallScreening.explanation}`,
          ),
          input_payload: {
            ...inputVector,
            name: patientName,
            patient_ref: patientRef,
            age,
            sex: sex || null,
            height,
            weight,
            bmi,
            uploaded_document_name: uploadedDocumentName,
            uploaded_document_type: uploadedDocumentType,
            uploaded_document_size: uploadedDocumentSize,
          },
          results_payload: {
            patient_name: patientName,
            patient_age: age,
            patient_sex: sex || null,
            uploaded_document_name: uploadedDocumentName,
            uploaded_document_type: uploadedDocumentType,
            uploaded_document_size: uploadedDocumentSize,
            extracted_medical_info: extractedMedicalInfo,
            overall_screening: overallScreening,
            results: resultsList,
          },
          report_id: reportId,
        });

        if (runId) {
          savedRunIdMap.set(runId, screeningRecord.id);
        }

        if (reportId) {
          serverDb.linkReportToScreening(reportId, screeningRecord.id);
        }

        for (const res of resultsList) {
          serverDb.createPrediction({
            screening_id: screeningRecord.id,
            user_id: scopedUserId,
            disease: res.disease,
            status:
              res.status === "insufficient_data" || res.status === "skipped"
                ? "unavailable"
                : res.status,
            prediction: res.prediction,
            predicted_class: res.predicted_class ?? null,
            probability: res.probability,
            risk_category: res.risk_category,
            explanation: res.explanation,
            top_features: res.top_features || [],
            inputs_used: res.inputs_used || {},
          });
        }

        return jsonResponse({
          success: true,
          saved: true,
          record_id: screeningRecord.id,
          screening_id: screeningRecord.id,
          timestamp: screeningRecord.created_at,
          screening: enrichScreeningRecord(screeningRecord),
          message: "Screening record saved to History.",
        });
      } catch {
        return errorResponse("Unable to save screening history.", 500);
      }
    }

    // 9. GET /api/history
    if (path === "/api/history" && method === "GET") {
      const scopedUserId = resolveScopedUserId(request);
      if (!scopedUserId) {
        return jsonResponse({
          success: true,
          count: 0,
          screenings: [],
        });
      }

      const search = url.searchParams.get("search") || undefined;
      const disease = url.searchParams.get("disease") || undefined;
      const dateFrom = url.searchParams.get("dateFrom") || undefined;
      const dateTo = url.searchParams.get("dateTo") || undefined;
      const limit = Number(url.searchParams.get("limit") || 100);

      const screenings = serverDb.listScreenings({
        userId: scopedUserId,
        search,
        disease,
        dateFrom,
        dateTo,
        limit,
      });

      const enriched = screenings.map((s) => enrichScreeningRecord(s));

      return jsonResponse({
        success: true,
        count: enriched.length,
        screenings: enriched,
      });
    }

    // 10. GET /api/history/:id
    if (path.startsWith("/api/history/") && method === "GET") {
      const scopedUserId = resolveScopedUserId(request);
      if (!scopedUserId) {
        return errorResponse("Unauthorized access to patient history.", 401);
      }
      const id = path.replace("/api/history/", "");

      const screening = serverDb.getScreening(id, scopedUserId);
      if (!screening) {
        return errorResponse("Screening record not found or access denied.", 404);
      }

      const predictions = serverDb.getPredictionsByScreening(id);
      const report = screening.report_id ? serverDb.getMedicalReport(screening.report_id) : null;
      const enriched = enrichScreeningRecord(screening);

      return jsonResponse({
        success: true,
        screening: enriched,
        predictions: enriched.predictions.length > 0 ? enriched.predictions : predictions,
        report: report
          ? {
              ...report,
              download_url: `/api/reports/${report.id}/download`,
            }
          : enriched.uploaded_document,
      });
    }

    // 11. DELETE /api/history/:id
    if (path.startsWith("/api/history/") && method === "DELETE") {
      const scopedUserId = resolveScopedUserId(request);
      if (!scopedUserId) {
        return errorResponse("Unauthorized", 401);
      }
      const id = path.replace("/api/history/", "");

      const deleted = serverDb.deleteScreening(id, scopedUserId);
      if (!deleted) {
        return errorResponse("Screening record not found.", 404);
      }
      return jsonResponse({ success: true, message: "Screening deleted successfully." });
    }

    return errorResponse(`Route ${method} ${path} not found.`, 404);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error occurred.";
    serverLogger.error("SERVER_ERROR", "Unhandled API server exception", {
      path,
      method,
      error: errorMsg,
    });
    return errorResponse(
      errorMsg || "Prediction service is currently unavailable. Please try again.",
      500,
    );
  }
}
