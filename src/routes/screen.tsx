import React, { useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";
import { SYMPTOM_OPTIONS } from "../lib/diseases";
import { INITIAL_PATIENT_INPUT, useScreeningStore } from "../lib/store";
import type { PatientSessionInput } from "../lib/types";
import {
  deleteUploadedMedicalReport,
  runPatientScreening,
  UploadDocumentError,
  uploadMedicalReport,
} from "../lib/api";

export const Route = createFileRoute("/screen")({
  component: PatientScreeningPage,
});

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function hasVal(val: unknown): boolean {
  return val !== "" && val !== null && val !== undefined;
}

function evaluateReadinessForInput(p: PatientSessionInput) {
  const ageOk = hasVal(p.age) && Number(p.age) > 0;
  const sexOk = p.sex === "Male" || p.sex === "Female";
  const bmiOk = hasVal(p.bmi) || (hasVal(p.height) && hasVal(p.weight) && Number(p.height) > 40);
  const hasSymptoms = Array.isArray(p.symptoms) && p.symptoms.length > 0;

  return [
    {
      id: "heart_disease",
      name: "Heart Disease",
      modelFile: "heart_disease_model.joblib",
      ready:
        ageOk ||
        hasVal(p.systolic_bp) ||
        hasVal(p.cholesterol) ||
        hasVal(p.heart_rate),
      missing:
        ageOk || hasVal(p.systolic_bp) || hasVal(p.cholesterol) || hasVal(p.heart_rate)
          ? []
          : ["Age or Vitals (BP / Cholesterol / Heart Rate)"],
    },
    {
      id: "diabetes",
      name: "Diabetes",
      modelFile: "diabetes_model.joblib",
      ready: ageOk || bmiOk || hasVal(p.glucose),
      missing:
        ageOk || bmiOk || hasVal(p.glucose)
          ? []
          : ["Age, BMI, or Blood Glucose"],
    },
    {
      id: "breast_cancer",
      name: "Breast Cancer",
      modelFile: "breast_cancer_model.joblib",
      ready:
        ageOk ||
        hasVal(p.radius_mean) ||
        hasVal(p.texture_mean) ||
        hasVal(p.perimeter_mean) ||
        hasVal(p.area_mean) ||
        hasSymptoms,
      missing:
        ageOk ||
        hasVal(p.radius_mean) ||
        hasVal(p.texture_mean) ||
        hasVal(p.perimeter_mean) ||
        hasVal(p.area_mean) ||
        hasSymptoms
          ? []
          : ["Patient Age or Biopsy Morphometrics"],
    },
    {
      id: "kidney_disease",
      name: "Kidney Disease",
      modelFile: "kidney_disease_model.joblib",
      ready:
        ageOk ||
        hasVal(p.creatinine) ||
        hasVal(p.hemoglobin) ||
        hasVal(p.urea) ||
        hasVal(p.albumin),
      missing:
        ageOk ||
        hasVal(p.creatinine) ||
        hasVal(p.hemoglobin) ||
        hasVal(p.urea) ||
        hasVal(p.albumin)
          ? []
          : ["Age or Renal Labs (Creatinine / Hemoglobin)"],
    },
    {
      id: "liver_disease",
      name: "Liver Disease",
      modelFile: "liver_disease_model.joblib",
      ready:
        ageOk ||
        hasVal(p.total_bilirubin) ||
        hasVal(p.alkaline_phosphotase) ||
        hasVal(p.sgpt) ||
        hasVal(p.sgot) ||
        hasVal(p.albumin),
      missing:
        ageOk ||
        hasVal(p.total_bilirubin) ||
        hasVal(p.alkaline_phosphotase) ||
        hasVal(p.sgpt) ||
        hasVal(p.sgot) ||
        hasVal(p.albumin)
          ? []
          : ["Age or Liver Panel (Bilirubin / ALT / ALP)"],
    },
    {
      id: "stroke",
      name: "Stroke",
      modelFile: "stroke_disease_model.joblib",
      ready: ageOk || bmiOk || hasVal(p.glucose) || hasVal(p.systolic_bp),
      missing:
        ageOk || bmiOk || hasVal(p.glucose) || hasVal(p.systolic_bp)
          ? []
          : ["Age, BP, BMI, or Blood Glucose"],
    },
    {
      id: "parkinsons",
      name: "Parkinson's Disease",
      modelFile: "parkinsons_model.joblib",
      ready:
        ageOk ||
        hasVal(p.MDVP_Fo_Hz) ||
        hasVal(p.MDVP_Jitter_Percent) ||
        hasVal(p.MDVP_Shimmer) ||
        hasVal(p.HNR) ||
        hasSymptoms,
      missing:
        ageOk ||
        hasVal(p.MDVP_Fo_Hz) ||
        hasVal(p.MDVP_Jitter_Percent) ||
        hasVal(p.MDVP_Shimmer) ||
        hasVal(p.HNR) ||
        hasSymptoms
          ? []
          : ["Patient Age, Symptoms, or Vocal Biomarkers"],
    },
    {
      id: "thyroid",
      name: "Thyroid Disease",
      modelFile: "thyroid_model.joblib",
      ready: ageOk || hasVal(p.tsh) || hasVal(p.t3) || hasVal(p.tt4),
      missing:
        ageOk || hasVal(p.tsh) || hasVal(p.t3) || hasVal(p.tt4)
          ? []
          : ["Age or Thyroid Labs (TSH / T3 / TT4)"],
    },
    {
      id: "lung_cancer",
      name: "Lung Cancer",
      modelFile: "lung_cancer_model.joblib",
      ready: ageOk || sexOk || hasSymptoms,
      missing: ageOk || sexOk || hasSymptoms ? [] : ["Age or Sex"],
    },
    {
      id: "alzheimers",
      name: "Alzheimer's Disease",
      modelFile: "alzheimers_model.joblib",
      ready:
        ageOk ||
        hasVal(p.MMSE) ||
        hasVal(p.FunctionalAssessment) ||
        hasSymptoms,
      missing:
        ageOk || hasVal(p.MMSE) || hasVal(p.FunctionalAssessment) || hasSymptoms
          ? []
          : ["Age, Cognitive Symptoms, or MMSE Score"],
    },
  ];
}

function mergeExtractedIntoPatientInput(
  prev: PatientSessionInput,
  ext: Record<string, unknown>,
): PatientSessionInput {
  const next = { ...prev };
  if (typeof ext["name"] === "string" && ext["name"]) next.name = ext["name"];
  if (typeof ext["patient_ref"] === "string" && ext["patient_ref"])
    next.patient_ref = ext["patient_ref"];
  if (typeof ext["age"] === "number") next.age = ext["age"];
  if (ext["sex"] === "Male" || ext["sex"] === "Female") next.sex = ext["sex"];
  if (typeof ext["height"] === "number") next.height = ext["height"];
  if (typeof ext["weight"] === "number") next.weight = ext["weight"];
  if (typeof ext["bmi"] === "number") next.bmi = ext["bmi"];
  if (!hasVal(next.bmi) && hasVal(next.height) && hasVal(next.weight) && Number(next.height) > 40) {
    const hM = Number(next.height) / 100;
    const computed = Number((Number(next.weight) / (hM * hM)).toFixed(1));
    if (Number.isFinite(computed) && computed > 5 && computed < 90) {
      next.bmi = computed;
    }
  }
  if (typeof ext["systolic_bp"] === "number") next.systolic_bp = ext["systolic_bp"];
  if (typeof ext["diastolic_bp"] === "number") next.diastolic_bp = ext["diastolic_bp"];
  if (typeof ext["systolic_bp"] === "number" && typeof ext["diastolic_bp"] === "number") {
    next.blood_pressure = `${ext["systolic_bp"]}/${ext["diastolic_bp"]}`;
  }
  if (typeof ext["heart_rate"] === "number") next.heart_rate = ext["heart_rate"];
  if (typeof ext["glucose"] === "number") next.glucose = ext["glucose"];
  if (typeof ext["cholesterol"] === "number") next.cholesterol = ext["cholesterol"];
  if (typeof ext["hemoglobin"] === "number") next.hemoglobin = ext["hemoglobin"];
  if (typeof ext["tsh"] === "number") next.tsh = ext["tsh"];
  if (typeof ext["t3"] === "number") next.t3 = ext["t3"];
  if (typeof ext["tt4"] === "number") next.tt4 = ext["tt4"];
  if (typeof ext["t4u"] === "number") next.t4u = ext["t4u"];
  if (typeof ext["fti"] === "number") next.fti = ext["fti"];
  if (typeof ext["creatinine"] === "number") next.creatinine = ext["creatinine"];
  if (typeof ext["urea"] === "number") next.urea = ext["urea"];
  if (typeof ext["sg"] === "number") next.sg = ext["sg"];
  if (typeof ext["albumin"] === "number") next.albumin = ext["albumin"];
  if (typeof ext["total_bilirubin"] === "number") next.total_bilirubin = ext["total_bilirubin"];
  if (typeof ext["direct_bilirubin"] === "number") next.direct_bilirubin = ext["direct_bilirubin"];
  if (typeof ext["alkaline_phosphotase"] === "number")
    next.alkaline_phosphotase = ext["alkaline_phosphotase"];
  if (typeof ext["sgpt"] === "number") next.sgpt = ext["sgpt"];
  if (typeof ext["sgot"] === "number") next.sgot = ext["sgot"];
  if (typeof ext["total_proteins"] === "number") next.total_proteins = ext["total_proteins"];
  if (typeof ext["ag_ratio"] === "number") next.ag_ratio = ext["ag_ratio"];
  if (typeof ext["radius_mean"] === "number") next.radius_mean = ext["radius_mean"];
  if (typeof ext["texture_mean"] === "number") next.texture_mean = ext["texture_mean"];
  if (typeof ext["perimeter_mean"] === "number") next.perimeter_mean = ext["perimeter_mean"];
  if (typeof ext["area_mean"] === "number") next.area_mean = ext["area_mean"];
  if (typeof ext["MDVP_Fo_Hz"] === "number") next.MDVP_Fo_Hz = ext["MDVP_Fo_Hz"];
  if (typeof ext["MDVP_Jitter_Percent"] === "number")
    next.MDVP_Jitter_Percent = ext["MDVP_Jitter_Percent"];
  if (typeof ext["MDVP_Shimmer"] === "number") next.MDVP_Shimmer = ext["MDVP_Shimmer"];
  if (typeof ext["HNR"] === "number") next.HNR = ext["HNR"];
  if (typeof ext["MMSE"] === "number") next.MMSE = ext["MMSE"];
  if (typeof ext["FunctionalAssessment"] === "number")
    next.FunctionalAssessment = ext["FunctionalAssessment"];
  if (typeof ext["smoking"] === "boolean") next.smoking = ext["smoking"];
  if (typeof ext["alcohol"] === "boolean") next.alcohol = ext["alcohol"];
  if (typeof ext["hypertension"] === "boolean") next.hypertension = ext["hypertension"];
  if (typeof ext["diabetes"] === "boolean") next.diabetes = ext["diabetes"];
  if (typeof ext["heart_disease"] === "boolean") next.heart_disease = ext["heart_disease"];
  if (typeof ext["family_history"] === "boolean") next.family_history = ext["family_history"];
  if (typeof ext["medical_history_notes"] === "string" && ext["medical_history_notes"]) {
    next.medical_history_notes = ext["medical_history_notes"];
  }
  if (Array.isArray(ext["symptoms"]) && ext["symptoms"].length > 0) {
    const mergedSyms = Array.from(new Set([...prev.symptoms, ...(ext["symptoms"] as string[])]));
    next.symptoms = mergedSyms;
  }
  return next;
}

export function UnifiedScreeningWorkspace(_props?: { defaultMode?: string }) {
  return <PatientScreeningPage />;
}

export function PatientScreeningPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    patientInput,
    setPatientInput,
    updateField,
    uploadedReport,
    setUploadedReport,
    activeReportId,
    setActiveReportId,
    activeScreeningId,
    setActiveScreeningId,
    currentResults,
    setCurrentResults,
  } = useScreeningStore();

  const [isUploading, setIsUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<
    "idle" | "processing" | "extracting" | "screening" | "results" | "incomplete" | "error"
  >("idle");
  const [missingFieldsFromDoc, setMissingFieldsFromDoc] = useState<string[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadErrorCode, setUploadErrorCode] = useState<string | null>(null);
  const [pendingMismatchFile, setPendingMismatchFile] = useState<File | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [patientRefreshNotice, setPatientRefreshNotice] = useState<string | null>(null);
  const [missingInfoPrompt, setMissingInfoPrompt] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showSpecializedPanels, setShowSpecializedPanels] = useState(false);

  // Evaluate which of the 10 models currently have sufficient inputs vs missing inputs
  const modelReadiness = useMemo(() => evaluateReadinessForInput(patientInput), [patientInput]);
  const readyModelsCount = modelReadiness.filter((m) => m.ready).length;

  const missingRequiredBaselineFields = useMemo(() => {
    const list: string[] = [];
    if (!hasVal(patientInput.age) || Number(patientInput.age) <= 0) {
      list.push("Age (years)");
    }
    if (patientInput.sex !== "Male" && patientInput.sex !== "Female") {
      list.push("Sex (Male / Female)");
    }
    return list;
  }, [patientInput.age, patientInput.sex]);

  // Handle Combined Blood Pressure String (e.g. "128/82")
  const handleBloodPressureTextChange = (raw: string) => {
    updateField("blood_pressure", raw);
    const m = raw.match(/(\d{2,3})\s*[/]\s*(\d{2,3})/);
    if (m && m[1] && m[2]) {
      updateField("systolic_bp", Number(m[1]));
      updateField("diastolic_bp", Number(m[2]));
    }
  };

  const buildMedicalHistorySummary = (input: PatientSessionInput) => {
    const items: string[] = [];
    if (input.hypertension) items.push("Hypertension");
    if (input.diabetes) items.push("Diabetes History");
    if (input.heart_disease) items.push("Prior Heart Disease");
    if (input.smoking) items.push("Active / Past Smoking");
    if (input.alcohol) items.push("Regular Alcohol Use");
    if (input.family_history) items.push("Family History of Chronic Illness");
    if (input.medical_history_notes?.trim()) {
      items.push(input.medical_history_notes.trim());
    }
    return items;
  };

  // Automatic Document Upload -> Validate Patient Details -> Extract -> Show Extracted Info -> Run Screening -> Show Results -> Save to History
  const processSelectedDocumentFile = async (
    file: File,
    opts?: { forceOverrideMismatch?: boolean },
  ) => {
    setIsUploading(true);
    setUploadStep("processing");
    setUploadError(null);
    setUploadErrorCode(null);
    setPendingMismatchFile(null);
    setUploadNotice(null);
    setErrorMsg(null);
    setMissingInfoPrompt(false);
    setMissingFieldsFromDoc([]);
    // Clear any stale results before validating the new document so invalid documents never display old predictions
    setCurrentResults([]);
    setActiveScreeningId(null);

    // Determine if current form identity was manually entered vs auto-populated from a previous uploaded report
    let baseInputForValidation: PatientSessionInput = { ...patientInput };
    if (opts?.forceOverrideMismatch) {
      baseInputForValidation = { ...INITIAL_PATIENT_INPUT };
    } else if (uploadedReport?.extractedData) {
      const prevExt = uploadedReport.extractedData;
      if (prevExt["name"] && baseInputForValidation.name === prevExt["name"]) {
        baseInputForValidation.name = "";
      }
      if (
        prevExt["age"] !== undefined &&
        prevExt["age"] !== null &&
        Number(baseInputForValidation.age) === Number(prevExt["age"])
      ) {
        baseInputForValidation.age = "";
      }
      if (prevExt["sex"] && baseInputForValidation.sex === prevExt["sex"]) {
        baseInputForValidation.sex = "";
      }
    }

    try {
      const response = await uploadMedicalReport(
        file,
        baseInputForValidation.patient_ref || undefined,
        {
          autoAnalyze: true,
          forceOverrideMismatch: Boolean(opts?.forceOverrideMismatch),
          patientData: {
            ...baseInputForValidation,
            medical_history: buildMedicalHistorySummary(baseInputForValidation),
          },
        },
      );

      setUploadStep("extracting");

      const safeFilename = response?.report?.filename || file.name || "patient_document";
      const safeMimeType = response?.report?.mimeType || file.type || "application/octet-stream";
      const safeFileTypeLabel =
        response?.report?.fileTypeLabel || safeMimeType || "Medical Document";
      const safeFileSize =
        typeof response?.report?.fileSize === "number" ? response.report.fileSize : file.size || 0;
      const safeReportId = response?.report_id || response?.report?.reportId || `rep_${Date.now()}`;
      const ext = response?.extracted_data || response?.report?.extractedData || {};

      const safeReport = {
        reportId: safeReportId,
        filename: safeFilename,
        fileSize: safeFileSize,
        mimeType: safeMimeType,
        fileTypeLabel: safeFileTypeLabel,
        status: response?.report?.status || ("Uploaded & Extracted" as const),
        extractionSuccess: response?.report?.extractionSuccess ?? true,
        textFound: response?.report?.textFound ?? true,
        extractedData: ext,
        message:
          response?.report?.message ||
          "Successfully validated patient medical document, extracted clinical information, and analyzed the report.",
      };

      setUploadedReport(safeReport);
      setActiveReportId(safeReportId);

      const baseToMerge = opts?.forceOverrideMismatch ? { ...INITIAL_PATIENT_INPUT } : patientInput;
      const mergedInput = mergeExtractedIntoPatientInput(baseToMerge, ext);
      setPatientInput(mergedInput);

      // Check if valid medical document has incomplete information (e.g. missing Age, Sex, or clinical vitals/labs)
      const missingReq = response?.missing_required_fields || response?.missing_baseline_fields || [];
      if (response?.incomplete_information || missingReq.length > 0) {
        setMissingInfoPrompt(true);
        setMissingFieldsFromDoc(missingReq);
        setUploadStep("incomplete");
        return;
      }

      setUploadStep("screening");

      // 1. If the backend already auto-analyzed and saved to History, display Results immediately!
      if (response?.auto_analyzed && response?.analysis) {
        const results = response.analysis.results || response.analysis.predictions || [];
        setCurrentResults(results);
        setActiveScreeningId(response.analysis.screening_id || response.analysis.record_id || null);
        setUploadStep("results");
        return;
      }

      // 2. Run screening immediately with merged extracted data
      const predResponse = await runPatientScreening({
        ...mergedInput,
        medical_history: buildMedicalHistorySummary(mergedInput),
        report_id: safeReportId,
        uploaded_document_name: safeReport.filename,
        uploaded_document_type: safeReport.fileTypeLabel || safeReport.mimeType,
        uploaded_document_size: safeReport.fileSize,
        extracted_data: ext,
      });
      setCurrentResults(predResponse.results || predResponse.predictions || []);
      setActiveScreeningId(predResponse.screening_id || predResponse.record_id || null);
      setUploadStep("results");
    } catch (err: unknown) {
      setUploadStep("error");
      const msg =
        err instanceof Error
          ? err.message
          : "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document.";
      setUploadError(msg);
      if (err instanceof UploadDocumentError) {
        setUploadErrorCode(err.code);
        if (err.code === "PATIENT_DETAILS_MISMATCH") {
          setPendingMismatchFile(file);
        } else {
          setUploadedReport(null);
          setActiveReportId(null);
        }
      } else {
        setUploadErrorCode("INVALID_PATIENT_DOCUMENT");
        setUploadedReport(null);
        setActiveReportId(null);
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processSelectedDocumentFile(file);
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    if (isUploading || isSubmitting) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    await processSelectedDocumentFile(file);
  };

  // Refresh Upload Medical Report Section
  const handleRefreshUploadSection = () => {
    const reportIdToRemove = activeReportId || uploadedReport?.reportId;
    const extData = uploadedReport?.extractedData;

    if (reportIdToRemove) {
      deleteUploadedMedicalReport(reportIdToRemove).catch(() => null);
    }

    if (extData) {
      setPatientInput((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(extData)) {
          if (val === null || val === undefined || val === "") continue;
          if (key === "symptoms" && Array.isArray(val)) {
            const toRemove = new Set(val as string[]);
            next.symptoms = prev.symptoms.filter((s) => !toRemove.has(s));
          } else if (
            key === "smoking" ||
            key === "hypertension" ||
            key === "diabetes" ||
            key === "heart_disease" ||
            key === "alcohol" ||
            key === "family_history"
          ) {
            next[key] = false;
          } else if (key in next) {
            (next as Record<string, unknown>)[key] = "";
          }
        }
        if (
          (extData["systolic_bp"] !== null && extData["systolic_bp"] !== undefined) ||
          (extData["diastolic_bp"] !== null && extData["diastolic_bp"] !== undefined)
        ) {
          next.blood_pressure = "";
        }
        return next;
      });
    }

    setUploadedReport(null);
    setActiveReportId(null);
    setUploadError(null);
    setUploadErrorCode(null);
    setUploadStep("idle");
    setMissingInfoPrompt(false);
    setMissingFieldsFromDoc([]);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploadNotice("Upload Medical Document section refreshed and ready for a new document.");
    setTimeout(() => setUploadNotice(null), 4000);
  };

  // Delete Uploaded Medical Report
  const handleRemoveUploadedFile = async (clearExtractedValues = false) => {
    const reportIdToRemove = activeReportId || uploadedReport?.reportId;
    const extData = uploadedReport?.extractedData;

    if (reportIdToRemove) {
      deleteUploadedMedicalReport(reportIdToRemove).catch(() => null);
    }

    if (clearExtractedValues && extData) {
      setPatientInput((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(extData)) {
          if (val === null || val === undefined || val === "") continue;
          if (key === "symptoms" && Array.isArray(val)) {
            const toRemove = new Set(val as string[]);
            next.symptoms = prev.symptoms.filter((s) => !toRemove.has(s));
          } else if (
            key === "smoking" ||
            key === "hypertension" ||
            key === "diabetes" ||
            key === "heart_disease" ||
            key === "alcohol" ||
            key === "family_history"
          ) {
            next[key] = false;
          } else if (key in next) {
            (next as Record<string, unknown>)[key] = "";
          }
        }
        if (
          (extData["systolic_bp"] !== null && extData["systolic_bp"] !== undefined) ||
          (extData["diastolic_bp"] !== null && extData["diastolic_bp"] !== undefined)
        ) {
          next.blood_pressure = "";
        }
        return next;
      });
    }

    setUploadedReport(null);
    setActiveReportId(null);
    setUploadError(null);
    setUploadErrorCode(null);
    setUploadStep("idle");
    setMissingInfoPrompt(false);
    setMissingFieldsFromDoc([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setUploadNotice(
      clearExtractedValues
        ? "Uploaded medical report and its extracted values have been deleted."
        : "Uploaded medical report / clinical document has been deleted.",
    );
    setTimeout(() => setUploadNotice(null), 4000);
  };

  // Refresh Patient Information Section
  const handleRefreshPatientInfo = () => {
    setPatientInput({ ...INITIAL_PATIENT_INPUT });
    setErrorMsg(null);
    setMissingInfoPrompt(false);
    setActiveScreeningId(null);
    setCurrentResults([]);
    setPatientRefreshNotice("Patient Information fields have been refreshed and cleared.");
    setTimeout(() => setPatientRefreshNotice(null), 4000);
  };

  // Refresh Both Upload Medical Report & Patient Information
  const handleRefreshAll = () => {
    const reportIdToRemove = activeReportId || uploadedReport?.reportId;
    if (reportIdToRemove) {
      deleteUploadedMedicalReport(reportIdToRemove).catch(() => null);
    }
    setUploadedReport(null);
    setActiveReportId(null);
    setUploadError(null);
    setMissingInfoPrompt(false);
    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPatientInput({ ...INITIAL_PATIENT_INPUT });
    setErrorMsg(null);
    setActiveScreeningId(null);
    setCurrentResults([]);
    setUploadNotice("Upload Medical Report section refreshed.");
    setPatientRefreshNotice("Patient Information refreshed and cleared.");
    setTimeout(() => {
      setUploadNotice(null);
      setPatientRefreshNotice(null);
    }, 4000);
  };

  const displayedSymptomOptions = useMemo(() => {
    const baseList: string[] = [...SYMPTOM_OPTIONS];
    const seen = new Set(baseList.map((s) => s.toLowerCase()));

    for (const sym of patientInput.symptoms) {
      const clean = sym.trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        baseList.push(clean);
      }
    }
    return baseList;
  }, [patientInput.symptoms]);

  const handleToggleSymptomConnected = (symptom: string) => {
    const exists = patientInput.symptoms.includes(symptom);
    const nextSymptoms = exists
      ? patientInput.symptoms.filter((s) => s !== symptom)
      : [...patientInput.symptoms, symptom];

    setPatientInput((prev) => {
      const updated = { ...prev, symptoms: nextSymptoms };
      const lowerList = nextSymptoms.map((s) => s.toLowerCase());
      if (
        lowerList.some((s) => s.includes("chest pain") || s.includes("angina")) &&
        (!prev.chest_pain_type || prev.chest_pain_type === "ASY")
      ) {
        updated.chest_pain_type = "TA";
      }
      if (
        lowerList.some(
          (s) => s.includes("memory") || s.includes("confusion") || s.includes("disorientation"),
        )
      ) {
        updated.MemoryComplaints = "1";
      }
      return updated;
    });
  };

  const extractedEntries = useMemo(() => {
    if (!uploadedReport?.extractedData) return [];
    const entries: { label: string; value: string }[] = [];
    const labelMap: Record<string, string> = {
      name: "Patient Name",
      patient_ref: "Patient Reference",
      age: "Age",
      sex: "Sex",
      height: "Height (cm)",
      weight: "Weight (kg)",
      bmi: "BMI (kg/m²)",
      systolic_bp: "Systolic BP (mmHg)",
      diastolic_bp: "Diastolic BP (mmHg)",
      heart_rate: "Heart Rate (bpm)",
      glucose: "Blood Glucose (mg/dL)",
      cholesterol: "Cholesterol (mg/dL)",
      hemoglobin: "Hemoglobin (g/dL)",
      tsh: "TSH (mIU/L)",
      t3: "T3 (nmol/L)",
      tt4: "Total T4 (nmol/L)",
      creatinine: "Serum Creatinine (mg/dL)",
      urea: "Blood Urea (mg/dL)",
      albumin: "Albumin (g/dL)",
      total_bilirubin: "Total Bilirubin (mg/dL)",
      alkaline_phosphotase: "Alkaline Phosphatase (IU/L)",
      sgpt: "ALT / SGPT (IU/L)",
      sgot: "AST / SGOT (IU/L)",
      radius_mean: "Breast Radius Mean",
      texture_mean: "Breast Texture Mean",
      perimeter_mean: "Breast Perimeter Mean",
      area_mean: "Breast Area Mean",
      MDVP_Fo_Hz: "Vocal Fo (Hz)",
      MDVP_Jitter_Percent: "Vocal Jitter (%)",
      MDVP_Shimmer: "Vocal Shimmer",
      HNR: "Vocal HNR (dB)",
      MMSE: "MMSE Cognitive Score",
      FunctionalAssessment: "Functional Assessment Score",
      smoking: "Smoking Status",
      hypertension: "Hypertension",
      diabetes: "Diabetes History",
      heart_disease: "Prior Heart Disease",
      alcohol: "Alcohol Use",
      family_history: "Family History",
      medical_history_notes: "Medical History Notes",
    };

    for (const [k, v] of Object.entries(uploadedReport.extractedData)) {
      if (v === null || v === undefined || v === "") continue;
      if (Array.isArray(v)) {
        if (v.length > 0) entries.push({ label: "Symptoms", value: v.join(", ") });
        continue;
      }
      if (typeof v === "boolean") {
        entries.push({ label: labelMap[k] || k, value: v ? "Yes" : "No" });
        continue;
      }
      entries.push({ label: labelMap[k] || k, value: String(v) });
    }
    return entries;
  }, [uploadedReport]);

  // Execute Prediction Across All 10 Models -> Automatically Save to History -> Show Results
  const handleRunPrediction = async () => {
    setErrorMsg(null);

    if (readyModelsCount === 0) {
      setMissingInfoPrompt(true);
      setErrorMsg(
        missingRequiredBaselineFields.length > 0
          ? `Please provide the missing required patient information (${missingRequiredBaselineFields.join(", ")}) so the screening models can evaluate the patient.`
          : "Please enter at least Age and Sex (or disease-specific laboratory values) to run the screening.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        ...patientInput,
        medical_history: buildMedicalHistorySummary(patientInput),
        report_id: activeReportId || uploadedReport?.reportId || null,
        uploaded_document_name: uploadedReport?.filename || null,
        uploaded_document_type: uploadedReport?.fileTypeLabel || uploadedReport?.mimeType || null,
        uploaded_document_size: uploadedReport?.fileSize || null,
        extracted_data: uploadedReport?.extractedData || null,
      };

      const response = await runPatientScreening(payload);
      setCurrentResults(response.results || response.predictions || []);
      setActiveScreeningId(response.screening_id || response.record_id || null);
      setMissingInfoPrompt(false);
      setMissingFieldsFromDoc([]);
      setUploadStep("results");
      navigate({ to: "/results" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to run health screening analysis.";
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Streamlined Automatic Workflow Header */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                Automatic Health Screening Workflow
              </span>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Patient Screening — Details &amp; Medical Document Upload
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter patient details and submit, or upload a patient medical document. Predictions
                run automatically and completed screenings are saved directly to History.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-foreground">
                <span className="font-semibold text-primary">1. Enter or Upload</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-foreground">2. Auto-Process</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-emerald-700">3. Results + History</span>
              </div>

              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={isUploading || isSubmitting}
                title="Refresh both Upload Medical Report and Patient Information"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span>↻ Refresh All</span>
              </button>

              <button
                type="button"
                onClick={handleRunPrediction}
                disabled={isSubmitting || isUploading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 transition-opacity cursor-pointer disabled:opacity-50"
              >
                <span>{isSubmitting ? "Processing..." : "Submit & Show Results →"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Active Processing Banner */}
        {(isUploading || isSubmitting) && (
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 text-xs font-semibold text-primary flex items-center justify-between">
            <span>
              {isUploading
                ? "Processing Uploaded Patient Document: Extracting clinical information, running prediction models, and saving to History..."
                : "Processing Patient Details: Running prediction models and automatically saving screening results to History..."}
            </span>
            <span className="animate-pulse font-mono">Processing...</span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs font-medium text-destructive flex items-center justify-between">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="ml-3 text-[11px] font-semibold underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left / Main Column: Document Upload + Patient Information Form */}
          <div className="lg:col-span-8 space-y-6">
            {/* 1. Upload Medical Document Card */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4 mb-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Upload Medical Document
                  </h2>
                  <p className="text-xs font-medium text-primary mt-0.5">
                    Supported formats: PDF, JPG, JPEG, PNG
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Upload a patient medical report, laboratory test result, or clinical document.
                    Each file is validated before extraction and disease screening.
                  </p>
                </div>

                {/* Native computer file input */}
                <input
                  id="medical-report-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.doc,.txt,.csv,.json,.xlsx"
                  onClick={(e) => {
                    (e.currentTarget as HTMLInputElement).value = "";
                    setUploadNotice(null);
                  }}
                  onChange={handleFileChange}
                  className="sr-only"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="medical-report-file-input"
                    className={`inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 transition-opacity ${
                      isUploading || isSubmitting
                        ? "opacity-50 pointer-events-none"
                        : "cursor-pointer"
                    }`}
                  >
                    {isUploading
                      ? "Processing Document..."
                      : uploadedReport
                        ? "Upload Another Document"
                        : "Upload Medical Document"}
                  </label>

                  <button
                    type="button"
                    onClick={handleRefreshUploadSection}
                    disabled={isUploading || isSubmitting}
                    title="Refresh Upload Medical Document section"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <span>↻ Refresh</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRemoveUploadedFile(true)}
                    disabled={!uploadedReport || isUploading || isSubmitting}
                    title={
                      uploadedReport
                        ? "Remove the uploaded medical document"
                        : "No medical document currently uploaded"
                    }
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors ${
                      uploadedReport
                        ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer"
                        : "border-border bg-secondary/40 text-muted-foreground opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <span>Delete Report</span>
                  </button>
                </div>
              </div>

              {/* Step-by-step progress bar for Valid Document Workflow */}
              {(isUploading || uploadStep === "results" || uploadStep === "incomplete") &&
                !uploadError && (
                  <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 font-medium">
                      <span
                        className={
                          uploadStep === "processing"
                            ? "font-bold text-primary animate-pulse"
                            : "text-emerald-700 font-semibold"
                        }
                      >
                        {uploadStep === "processing"
                          ? "→ Processing document..."
                          : "✓ Processing document..."}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={
                          uploadStep === "extracting"
                            ? "font-bold text-primary animate-pulse"
                            : uploadStep === "screening" ||
                                uploadStep === "results" ||
                                uploadStep === "incomplete"
                              ? "text-emerald-700 font-semibold"
                              : "text-muted-foreground"
                        }
                      >
                        {uploadStep === "extracting"
                          ? "Extracting information..."
                          : "✓ Extracting information..."}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={
                          uploadStep === "screening"
                            ? "font-bold text-primary animate-pulse"
                            : uploadStep === "results"
                              ? "text-emerald-700 font-semibold"
                              : "text-muted-foreground"
                        }
                      >
                        {uploadStep === "screening"
                          ? "Running screening..."
                          : uploadStep === "results"
                            ? "✓ Running screening..."
                            : "Running screening..."}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={
                          uploadStep === "results"
                            ? "rounded-md bg-emerald-600 px-2 py-0.5 text-white font-bold"
                            : "text-muted-foreground"
                        }
                      >
                        Results
                      </span>
                    </div>
                  </div>
                )}

              {uploadNotice && (
                <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                  <span>✓ {uploadNotice}</span>
                  <button
                    type="button"
                    onClick={() => setUploadNotice(null)}
                    className="ml-3 text-[11px] font-semibold underline cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {uploadError && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border-2 border-destructive/60 bg-destructive/10 p-4 text-xs text-destructive space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-destructive flex items-center gap-1.5">
                          <span>⚠️</span>
                          <span>Document Error</span>
                        </p>
                        {uploadErrorCode && (
                          <span className="rounded-md border border-destructive/40 bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                            {uploadErrorCode.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-destructive leading-relaxed">
                        The uploaded file does not appear to be a valid medical/patient document.
                        Please upload a valid medical report or patient document.
                      </p>
                      {uploadError !==
                        "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document." && (
                        <p className="text-destructive/90 leading-relaxed">{uploadError}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-destructive/20">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadError(null);
                        setUploadErrorCode(null);
                        setPendingMismatchFile(null);
                        setUploadStep("idle");
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                          fileInputRef.current.click();
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer"
                    >
                      <span>Upload Another Document</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUploadError(null);
                        setUploadErrorCode(null);
                        setPendingMismatchFile(null);
                        setUploadStep("idle");
                        setUploadedReport(null);
                        setActiveReportId(null);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-background px-3.5 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 cursor-pointer"
                    >
                      <span>Remove Invalid File</span>
                    </button>

                    {uploadErrorCode === "PATIENT_DETAILS_MISMATCH" && pendingMismatchFile && (
                      <button
                        type="button"
                        onClick={() =>
                          processSelectedDocumentFile(pendingMismatchFile, {
                            forceOverrideMismatch: true,
                          })
                        }
                        disabled={isUploading || isSubmitting}
                        className="rounded-lg border border-primary/40 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/20 cursor-pointer disabled:opacity-50"
                      >
                        Allow &amp; Screen Using Document&apos;s Patient Details Instead →
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!uploadedReport ? (
                <label
                  htmlFor="medical-report-file-input"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFile(true);
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFile(false);
                  }}
                  onDrop={handleFileDrop}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors cursor-pointer ${
                    isDraggingFile
                      ? "border-primary bg-primary/10"
                      : "border-border bg-secondary/20 hover:border-primary/50 hover:bg-secondary/40"
                  }`}
                >
                  <p className="text-sm font-semibold text-foreground">
                    {isUploading
                      ? "Processing document & extracting medical information..."
                      : "Upload Medical Document"}
                  </p>
                  <p className="mt-1 text-xs font-medium text-primary">
                    Supported formats: PDF, JPG, JPEG, PNG
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Click here or drag &amp; drop a patient medical report or laboratory document to
                    validate, extract clinical values, and run disease screening.
                  </p>
                </label>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-secondary/20 p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">File Name</span>
                        <span className="font-semibold text-foreground break-all">
                          {uploadedReport?.filename || "Uploaded Medical Document"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">File Type</span>
                        <span className="font-medium text-foreground">
                          {uploadedReport?.fileTypeLabel ||
                            uploadedReport?.mimeType ||
                            "Medical Document"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">File Size</span>
                        <span className="font-mono font-medium text-foreground">
                          {formatBytes(uploadedReport?.fileSize || 0)}
                        </span>
                      </div>
                    </div>

                    {extractedEntries.length > 0 && (
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Extracted Medical Information ({extractedEntries.length} fields)
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {extractedEntries.map((item) => (
                            <span
                              key={item.label}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px]"
                            >
                              <span className="text-muted-foreground">{item.label}:</span>
                              <span className="font-semibold text-foreground">{item.value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* If required baseline information was missing from the uploaded document, ask ONLY for the missing fields here */}
                    {(missingInfoPrompt || readyModelsCount === 0) && (
                      <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
                        <div>
                          <h3 className="text-xs font-bold text-amber-950">
                            Additional Required Information Needed to Complete Screening
                          </h3>
                          <p className="mt-0.5 text-xs text-amber-900">
                            We extracted the available medical information from your document without
                            inventing missing values. Please provide only the required missing
                            information below (
                            <span className="font-semibold">
                              {(missingFieldsFromDoc.length > 0
                                ? missingFieldsFromDoc
                                : missingRequiredBaselineFields
                              ).join(", ") || "Age, Sex, or Clinical Vitals"}
                            </span>
                            ) to complete the screening:
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 text-xs">
                          {(!hasVal(patientInput.age) || Number(patientInput.age) <= 0) && (
                            <div>
                              <label className="block font-semibold text-amber-950 mb-1">
                                Age (years) *
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={120}
                                value={patientInput.age}
                                onChange={(e) =>
                                  updateField(
                                    "age",
                                    e.target.value === "" ? "" : Number(e.target.value),
                                  )
                                }
                                placeholder="Enter patient age (e.g. 54)"
                                className="w-full rounded-lg border border-amber-500/50 bg-background px-3 py-1.5 text-sm text-foreground"
                              />
                            </div>
                          )}

                          {patientInput.sex !== "Male" && patientInput.sex !== "Female" && (
                            <div>
                              <label className="block font-semibold text-amber-950 mb-1">
                                Sex *
                              </label>
                              <select
                                value={patientInput.sex}
                                onChange={(e) => updateField("sex", e.target.value)}
                                className="w-full rounded-lg border border-amber-500/50 bg-background px-3 py-1.5 text-sm text-foreground"
                              >
                                <option value="">Select Sex...</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                              </select>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleRunPrediction}
                            disabled={isSubmitting || readyModelsCount === 0}
                            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer disabled:opacity-50"
                          >
                            {isSubmitting
                              ? "Running Screening..."
                              : "Complete Screening & Show Results →"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Automatic Screening Results Preview after Valid Medical Document Upload */}
                    {currentResults.length > 0 && !missingInfoPrompt && (
                      <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold text-foreground">
                                Screening Results
                              </span>
                              <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                                ✓ Automatically Saved to History
                              </span>
                              {activeScreeningId && (
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  ID: {activeScreeningId}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Evaluated across all 10 trained disease models using the extracted
                              patient document values.
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => navigate({ to: "/results" })}
                              className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer"
                            >
                              Open Full Results View →
                            </button>
                            <button
                              type="button"
                              onClick={() => navigate({ to: "/history" })}
                              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary cursor-pointer"
                            >
                              View in History →
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          {currentResults.map((res) => {
                            const isHigh =
                              res.risk_category === "High Risk" ||
                              res.risk_category === "Higher screening risk";
                            const isMod =
                              res.risk_category === "Moderate Risk" ||
                              res.risk_category === "Moderate screening risk";
                            const isInsuff =
                              res.status === "insufficient_data" ||
                              res.risk_category === "Insufficient Data";
                            const pct =
                              typeof res.probability === "number" &&
                              Number.isFinite(res.probability)
                                ? `${(res.probability > 1 ? res.probability : res.probability * 100).toFixed(1)}%`
                                : null;
                            return (
                              <div
                                key={res.disease_id || res.disease}
                                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground truncate">
                                    {res.disease}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground truncate">
                                    {res.prediction}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {pct && (
                                    <span className="font-mono text-[11px] font-bold text-foreground">
                                      {pct}
                                    </span>
                                  )}
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                      isInsuff
                                        ? "bg-slate-500/15 text-slate-700"
                                        : isHigh
                                          ? "bg-destructive/15 text-destructive"
                                          : isMod
                                            ? "bg-amber-500/15 text-amber-800"
                                            : "bg-emerald-500/15 text-emerald-700"
                                    }`}
                                  >
                                    {isInsuff
                                      ? "Insufficient Data"
                                      : isHigh
                                        ? "High Risk"
                                        : isMod
                                          ? "Moderate Risk"
                                          : "Low Risk"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Action bar inside uploaded report card */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {readyModelsCount > 0 && (
                          <button
                            type="button"
                            onClick={handleRunPrediction}
                            disabled={isSubmitting}
                            className="rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer disabled:opacity-50"
                          >
                            {isSubmitting ? "Processing..." : "Run Prediction & Show Results →"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleRefreshUploadSection}
                          className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors cursor-pointer"
                        >
                          ↻ Refresh Upload
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRemoveUploadedFile(false)}
                          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                        >
                          Delete Report Only
                        </button>
                        {extractedEntries.length > 0 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveUploadedFile(true)}
                            className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
                          >
                            Delete Report &amp; Clear Extracted Values
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Patient Information & Demographics */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Patient Information &amp; Demographics
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Enter patient details below and click Submit to immediately run predictions and
                    save results to History.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRefreshPatientInfo}
                    disabled={isSubmitting || isUploading}
                    title="Refresh and clear all Patient Information fields"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/80 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <span>↻ Refresh Patient Info</span>
                  </button>
                </div>
              </div>

              {patientRefreshNotice && (
                <div className="mb-4 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
                  <span>✓ {patientRefreshNotice}</span>
                  <button
                    type="button"
                    onClick={() => setPatientRefreshNotice(null)}
                    className="ml-3 text-[11px] font-semibold underline cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Patient Name
                  </label>
                  <input
                    type="text"
                    value={patientInput.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder="e.g., John Doe"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Patient ID / Reference
                  </label>
                  <input
                    type="text"
                    value={patientInput.patient_ref}
                    onChange={(e) => updateField("patient_ref", e.target.value)}
                    placeholder="Auto-generated if blank"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Age (years)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={patientInput.age}
                    onChange={(e) =>
                      updateField("age", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 54"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">Sex</label>
                  <select
                    value={patientInput.sex}
                    onChange={(e) => updateField("sex", e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">Select Sex...</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={250}
                    step="0.1"
                    value={patientInput.height}
                    onChange={(e) =>
                      updateField("height", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 172"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    step="0.1"
                    value={patientInput.weight}
                    onChange={(e) =>
                      updateField("weight", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 78"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    BMI (kg/m²)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={80}
                    step="0.1"
                    value={patientInput.bmi}
                    onChange={(e) =>
                      updateField("bmi", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="Auto-calculated or enter"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 3. Vital Signs & Core Laboratory Biomarkers */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Vital Signs &amp; Core Laboratory Values
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Key biomarkers used by Heart Disease, Diabetes, Stroke, Kidney, Liver, and
                    Thyroid screening models.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshPatientInfo}
                  disabled={isSubmitting || isUploading}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-secondary/70 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span>↻ Refresh Values</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Blood Pressure (e.g. 120/80)
                  </label>
                  <input
                    type="text"
                    value={
                      patientInput.blood_pressure ||
                      (hasVal(patientInput.systolic_bp) && hasVal(patientInput.diastolic_bp)
                        ? `${patientInput.systolic_bp}/${patientInput.diastolic_bp}`
                        : "")
                    }
                    onChange={(e) => handleBloodPressureTextChange(e.target.value)}
                    placeholder="e.g., 128/82"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Systolic BP (mmHg)
                  </label>
                  <input
                    type="number"
                    value={patientInput.systolic_bp}
                    onChange={(e) =>
                      updateField(
                        "systolic_bp",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g., 128"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Diastolic BP (mmHg)
                  </label>
                  <input
                    type="number"
                    value={patientInput.diastolic_bp}
                    onChange={(e) =>
                      updateField(
                        "diastolic_bp",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g., 82"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Blood Glucose (mg/dL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={patientInput.glucose}
                    onChange={(e) =>
                      updateField("glucose", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 105"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Cholesterol (mg/dL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={patientInput.cholesterol}
                    onChange={(e) =>
                      updateField(
                        "cholesterol",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g., 210"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Hemoglobin (g/dL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={patientInput.hemoglobin}
                    onChange={(e) =>
                      updateField("hemoglobin", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 14.2"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    TSH (mIU/L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={patientInput.tsh}
                    onChange={(e) =>
                      updateField("tsh", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 2.4"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Heart Rate / Pulse (bpm)
                  </label>
                  <input
                    type="number"
                    value={patientInput.heart_rate}
                    onChange={(e) =>
                      updateField("heart_rate", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 76"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Serum Creatinine (mg/dL)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={patientInput.creatinine}
                    onChange={(e) =>
                      updateField("creatinine", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 1.1"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Blood Urea (mg/dL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={patientInput.urea}
                    onChange={(e) =>
                      updateField("urea", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 32"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Total Bilirubin (mg/dL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={patientInput.total_bilirubin}
                    onChange={(e) =>
                      updateField(
                        "total_bilirubin",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g., 0.9"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Alkaline Phosphatase (IU/L)
                  </label>
                  <input
                    type="number"
                    value={patientInput.alkaline_phosphotase}
                    onChange={(e) =>
                      updateField(
                        "alkaline_phosphotase",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    placeholder="e.g., 195"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    ALT / SGPT (IU/L)
                  </label>
                  <input
                    type="number"
                    value={patientInput.sgpt}
                    onChange={(e) =>
                      updateField("sgpt", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 28"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    AST / SGOT (IU/L)
                  </label>
                  <input
                    type="number"
                    value={patientInput.sgot}
                    onChange={(e) =>
                      updateField("sgot", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 31"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    Serum Albumin (g/dL)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={patientInput.albumin}
                    onChange={(e) =>
                      updateField("albumin", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="e.g., 4.1"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>

              {/* Expandable Specialized Biomarkers */}
              <div className="mt-5 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={() => setShowSpecializedPanels((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-lg bg-secondary/50 px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary cursor-pointer"
                >
                  <span>
                    Specialized Diagnostic Biomarkers (Breast Cancer Biopsy, Parkinson&apos;s Vocal,
                    Alzheimer&apos;s Cognitive, Extended Thyroid)
                  </span>
                  <span className="text-primary">
                    {showSpecializedPanels ? "Hide Optional Fields ▲" : "Show Optional Fields ▼"}
                  </span>
                </button>

                {showSpecializedPanels && (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Breast FNA Radius Mean (mm)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={patientInput.radius_mean}
                        onChange={(e) =>
                          updateField(
                            "radius_mean",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 14.1"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Breast FNA Texture Mean
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={patientInput.texture_mean}
                        onChange={(e) =>
                          updateField(
                            "texture_mean",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 19.3"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Breast FNA Perimeter Mean (mm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={patientInput.perimeter_mean}
                        onChange={(e) =>
                          updateField(
                            "perimeter_mean",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 92.0"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Breast FNA Area Mean (mm²)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={patientInput.area_mean}
                        onChange={(e) =>
                          updateField(
                            "area_mean",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 654.5"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Parkinson&apos;s MDVP:Fo (Hz)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={patientInput.MDVP_Fo_Hz}
                        onChange={(e) =>
                          updateField(
                            "MDVP_Fo_Hz",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 154.2"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Parkinson&apos;s MDVP:Jitter (%)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        value={patientInput.MDVP_Jitter_Percent}
                        onChange={(e) =>
                          updateField(
                            "MDVP_Jitter_Percent",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 0.0062"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Parkinson&apos;s MDVP:Shimmer
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        value={patientInput.MDVP_Shimmer}
                        onChange={(e) =>
                          updateField(
                            "MDVP_Shimmer",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 0.029"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Parkinson&apos;s Vocal HNR (dB)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={patientInput.HNR}
                        onChange={(e) =>
                          updateField("HNR", e.target.value === "" ? "" : Number(e.target.value))
                        }
                        placeholder="e.g., 21.8"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Alzheimer&apos;s MMSE Score (0-30)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        step="0.5"
                        value={patientInput.MMSE}
                        onChange={(e) =>
                          updateField("MMSE", e.target.value === "" ? "" : Number(e.target.value))
                        }
                        placeholder="e.g., 27"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Functional Assessment (0-10)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step="0.5"
                        value={patientInput.FunctionalAssessment}
                        onChange={(e) =>
                          updateField(
                            "FunctionalAssessment",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                        placeholder="e.g., 8.5"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Thyroid T3 (nmol/L)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={patientInput.t3}
                        onChange={(e) =>
                          updateField("t3", e.target.value === "" ? "" : Number(e.target.value))
                        }
                        placeholder="e.g., 2.0"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Total Thyroxine TT4 (nmol/L)
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={patientInput.tt4}
                        onChange={(e) =>
                          updateField("tt4", e.target.value === "" ? "" : Number(e.target.value))
                        }
                        placeholder="e.g., 108"
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Symptoms & Medical History */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-5">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Symptoms &amp; Medical History
                </h2>
                <p className="text-xs text-muted-foreground">
                  Select any presenting symptoms and medical history factors.
                </p>
              </div>

              {/* Symptoms */}
              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <label className="block text-xs font-semibold text-foreground">
                      Presenting Symptoms
                    </label>
                    {patientInput.symptoms.length > 0 && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {patientInput.symptoms.length} selected
                      </span>
                    )}
                  </div>

                  {patientInput.symptoms.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateField("symptoms", [])}
                      className="rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
                    >
                      Clear Symptoms
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {displayedSymptomOptions.map((symptom) => {
                    const active = patientInput.symptoms.includes(symptom);
                    return (
                      <button
                        key={symptom}
                        type="button"
                        onClick={() => handleToggleSymptomConnected(symptom)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          active
                            ? "border-primary bg-primary text-primary-foreground shadow-xs"
                            : "border-border bg-secondary/40 text-foreground hover:bg-secondary"
                        }`}
                      >
                        {active ? `✓ ${symptom}` : symptom}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Medical History Checkboxes */}
              <div className="border-t border-border pt-4">
                <label className="block text-xs font-semibold text-foreground mb-2">
                  Medical History &amp; Risk Factors
                </label>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 text-xs">
                  {[
                    { key: "hypertension", label: "Hypertension (High BP)" },
                    { key: "diabetes", label: "History of Diabetes" },
                    { key: "heart_disease", label: "Prior Heart Disease" },
                    { key: "smoking", label: "Smoking History" },
                    { key: "alcohol", label: "Alcohol Consumption" },
                    { key: "family_history", label: "Family History of Disease" },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2 cursor-pointer hover:bg-secondary/40"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(patientInput[item.key])}
                        onChange={(e) =>
                          updateField(item.key as keyof typeof patientInput, e.target.checked)
                        }
                        className="h-4 w-4 rounded border-input text-primary"
                      />
                      <span className="font-medium text-foreground">{item.label}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Additional Medical History Notes
                    </label>
                    <textarea
                      rows={2}
                      value={patientInput.medical_history_notes || ""}
                      onChange={(e) => updateField("medical_history_notes", e.target.value)}
                      placeholder="Past surgeries, medications, chronic conditions..."
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Other Relevant Patient Information
                    </label>
                    <textarea
                      rows={2}
                      value={patientInput.other_notes || ""}
                      onChange={(e) => updateField("other_notes", e.target.value)}
                      placeholder="Any additional clinical observations..."
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground"
                    />
                  </div>
                </div>
              </div>

              {/* Direct Automatic Submit Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={handleRefreshPatientInfo}
                  disabled={isSubmitting || isUploading}
                  className="rounded-lg border border-border bg-secondary px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-secondary/80 cursor-pointer disabled:opacity-50"
                >
                  ↻ Refresh Patient Info
                </button>

                <button
                  type="button"
                  onClick={handleRunPrediction}
                  disabled={isSubmitting || isUploading}
                  className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? "Processing & Saving to History..." : "Submit & Run Screening →"}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Clinical Screening Readiness & Direct Submit */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-xs sticky top-20">
              <div className="flex items-center justify-between border-b border-border pb-3 mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Clinical Screening Readiness
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Conditions with sufficient clinical data
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                  {readyModelsCount} Ready
                </span>
              </div>

              <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
                {modelReadiness.map((m, index) => (
                  <div
                    key={m.id}
                    className={`rounded-lg border p-2.5 text-xs ${
                      m.ready
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-border bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground">
                        {index + 1}. {m.name}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          m.ready
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-amber-500/15 text-amber-800"
                        }`}
                      >
                        {m.ready ? "Inputs Ready" : "Needs Inputs"}
                      </span>
                    </div>
                    {!m.ready && m.missing.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Needs: <span className="text-foreground">{m.missing.join(", ")}</span>
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-4 border-t border-border pt-4 space-y-2">
                <button
                  type="button"
                  onClick={handleRunPrediction}
                  disabled={isSubmitting || isUploading}
                  className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-xs hover:opacity-95 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? "Running Prediction & Saving..." : "Submit & View Results →"}
                </button>
                <p className="text-center text-[11px] text-muted-foreground">
                  Results are automatically saved to your History page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
