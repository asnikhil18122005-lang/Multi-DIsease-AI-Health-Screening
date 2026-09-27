import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, encodeCategorical, sanitizeNumber } from "../../preprocessing/encoders";

const RBC_ENCODING: Record<string, number> = {
  normal: 0,
  abnormal: 1,
};

export const kidneyMetadata: DiseaseMetadata = {
  id: "kidney_disease",
  name: "Kidney Disease",
  code: "KIDNEY",
  modelFileName: "kidney_disease_model.joblib",
  scalerFileName: "kidney_disease_scaler.joblib",
  endpoint: "/api/predict/kidney_disease",
  description:
    "Renal health and chronic kidney disease (CKD) risk evaluation using clinical and urinalysis markers.",
  datasetName: "Chronic Kidney Disease Dataset / UCI Machine Learning Repository",
  recommendedNextStep:
    "Order a comprehensive renal function panel (serum creatinine, blood urea nitrogen, eGFR, and urinalysis).",
  requiredFeatureNames: ["age", "bp", "bu", "sc"],
  featureOrder: ["age", "bp", "sg", "al", "su", "rbc", "bgr", "bu", "sc", "hemo", "htn", "dm"],
  categoricalEncodings: {
    rbc: RBC_ENCODING,
  },
  features: [
    {
      name: "age",
      label: "Age",
      type: "number",
      min: 1,
      max: 120,
      required: true,
      description: "Patient age",
    },
    {
      name: "bp",
      label: "Blood Pressure",
      type: "number",
      unit: "mmHg",
      min: 50,
      max: 200,
      required: true,
      description: "Diastolic blood pressure",
    },
    {
      name: "sg",
      label: "Specific Gravity",
      type: "categorical",
      required: false,
      defaultValue: "1.020",
      options: [
        { value: "1.005", label: "1.005" },
        { value: "1.010", label: "1.010" },
        { value: "1.015", label: "1.015" },
        { value: "1.020", label: "1.020" },
        { value: "1.025", label: "1.025" },
      ],
      description: "Urinary specific gravity",
    },
    {
      name: "al",
      label: "Albumin (Urine)",
      type: "number",
      min: 0,
      max: 5,
      required: false,
      defaultValue: 0,
      description: "Urine albumin level (0 - 5)",
    },
    {
      name: "su",
      label: "Sugar (Urine)",
      type: "number",
      min: 0,
      max: 5,
      required: false,
      defaultValue: 0,
      description: "Urine sugar level (0 - 5)",
    },
    {
      name: "rbc",
      label: "Red Blood Cells",
      type: "categorical",
      required: false,
      defaultValue: "normal",
      options: [
        { value: "normal", label: "Normal" },
        { value: "abnormal", label: "Abnormal" },
      ],
      description: "Red blood cells in urinalysis",
    },
    {
      name: "bgr",
      label: "Blood Glucose Random",
      type: "number",
      unit: "mg/dL",
      min: 50,
      max: 500,
      required: false,
      defaultValue: 120,
      description: "Random blood glucose",
    },
    {
      name: "bu",
      label: "Blood Urea",
      type: "number",
      unit: "mg/dL",
      min: 10,
      max: 400,
      required: true,
      description: "Blood urea concentration",
    },
    {
      name: "sc",
      label: "Serum Creatinine",
      type: "number",
      unit: "mg/dL",
      min: 0.1,
      max: 20,
      required: true,
      description: "Serum creatinine concentration",
    },
    {
      name: "hemo",
      label: "Hemoglobin",
      type: "number",
      unit: "g/dL",
      min: 3,
      max: 20,
      required: false,
      defaultValue: 13.5,
      description: "Hemoglobin concentration",
    },
    {
      name: "htn",
      label: "Hypertension",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "History of hypertension",
    },
    {
      name: "dm",
      label: "Diabetes Mellitus",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "History of diabetes mellitus",
    },
  ],
};

export class KidneyDiseaseService implements DiseasePredictionService {
  metadata = kidneyMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["age"] ?? inputs["Age"], 1, 120);
    const directSc = sanitizeNumber(inputs["sc"] ?? inputs["creatinine"], 0.1, 25);
    const directBu = sanitizeNumber(inputs["bu"] ?? inputs["urea"], 5, 400);
    const directHemo = sanitizeNumber(inputs["hemo"] ?? inputs["hemoglobin"], 3, 22);

    if (age === null && directSc === null && directBu === null && directHemo === null) {
      missingFeatures.push("age", "creatinine", "urea");
      errors.push("Age, Serum Creatinine, or Blood Urea is required.");
    }

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasRenalEdemaSymptom = symptomsList.some(
      (s) =>
        s.includes("swelling in legs") ||
        s.includes("ankles") ||
        s.includes("edema") ||
        s.includes("dark urine") ||
        s.includes("foamy urine"),
    );
    const hasUrinarySymptom = symptomsList.some(
      (s) => s.includes("frequent urination") || s.includes("nausea") || s.includes("vomiting"),
    );

    const resolvedAge = age ?? 48;
    cleaned["age"] = resolvedAge;

    const diaBp = sanitizeNumber(inputs["bp"] ?? inputs["diastolic_bp"], 40, 150);
    const sysBp = sanitizeNumber(inputs["systolic_bp"], 60, 240);
    const bp =
      diaBp ??
      (sysBp !== null
        ? sysBp > 110
          ? Math.round(sysBp * 0.62)
          : sysBp
        : encodeBinary(inputs["hypertension"] ?? inputs["htn"])
          ? 86
          : 74);
    cleaned["bp"] = bp;

    // Resolve Serum Creatinine (sc) and Blood Urea (bu)
    let sc = directSc;
    if (sc === null) {
      if (directBu !== null) {
        sc = directBu > 50 ? Number((directBu / 32).toFixed(2)) : 0.95;
      } else if (hasRenalEdemaSymptom) {
        sc = hasUrinarySymptom ? 2.1 : 1.55;
      } else {
        sc = 0.92;
      }
    }
    cleaned["sc"] = sc;

    const bu =
      directBu ??
      (sc > 1.35
        ? Math.round(sc * 32)
        : hasRenalEdemaSymptom
          ? 52
          : 28);
    cleaned["bu"] = bu;

    const hemo =
      directHemo ??
      (sc >= 2.0 ? 10.6 : sc >= 1.45 ? 11.8 : 13.8);
    cleaned["hemo"] = hemo;

    const defaultSg = sc >= 1.8 ? 1.010 : sc >= 1.4 ? 1.015 : 1.020;
    cleaned["sg"] = sanitizeNumber(inputs["sg"], 1.005, 1.030, defaultSg) ?? defaultSg;

    const defaultAl =
      sc >= 2.2 ? 2 : sc >= 1.5 || hasRenalEdemaSymptom ? 1 : 0;
    cleaned["al"] = sanitizeNumber(inputs["al"], 0, 5, defaultAl) ?? defaultAl;
    cleaned["su"] = sanitizeNumber(inputs["su"], 0, 5, 0) ?? 0;
    cleaned["rbc"] = String(inputs["rbc"] ?? (sc >= 2.2 ? "abnormal" : "normal"));
    cleaned["bgr"] = sanitizeNumber(inputs["bgr"] ?? inputs["glucose"], 40, 500, 102) ?? 102;
    cleaned["htn"] = encodeBinary(
      inputs["htn"] ?? inputs["hypertension"] ?? (sysBp !== null && sysBp >= 140),
    );
    cleaned["dm"] = encodeBinary(
      inputs["dm"] ?? inputs["diabetes"] ?? (Number(cleaned["bgr"]) >= 140),
    );

    const featureVector: number[] = [
      Number(cleaned["age"] ?? 48),
      Number(cleaned["bp"] ?? 74),
      Number(cleaned["sg"] ?? 1.020),
      Number(cleaned["al"] ?? 0),
      Number(cleaned["su"] ?? 0),
      encodeCategorical(String(cleaned["rbc"]), RBC_ENCODING, 0),
      Number(cleaned["bgr"] ?? 102),
      Number(cleaned["bu"] ?? 28),
      Number(cleaned["sc"] ?? 0.92),
      Number(cleaned["hemo"] ?? 13.8),
      Number(cleaned["htn"] ?? 0),
      Number(cleaned["dm"] ?? 0),
    ];

    return { valid: errors.length === 0, errors, missingFeatures, cleaned, featureVector };
  }

  async predict(inputs: Record<string, unknown>): Promise<ModelPredictionResult> {
    const validation = this.validateInputs(inputs);
    if (!validation.valid) {
      return {
        disease: this.metadata.name,
        disease_id: this.metadata.id,
        status: "insufficient_data",
        prediction: "Insufficient data for this model",
        probability: null,
        confidence: null,
        risk_category: "Insufficient Data",
        missing_features: validation.missingFeatures,
        explanation: `Insufficient data for this model. Missing required renal biomarkers: ${(validation.missingFeatures || []).join(", ")}.`,
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Kidney Disease risk.`,
        inputs_used: validation.cleaned,
        model_file: `models/${this.metadata.modelFileName}`,
      };
    }

    const exec = await executeModelInference(
      this.metadata.id,
      this.metadata.modelFileName,
      validation.featureVector || [],
      this.metadata.featureOrder || [],
      { scalerFileName: this.metadata.scalerFileName, rawInputs: inputs },
    );

    if (!exec.available) {
      return {
        disease: this.metadata.name,
        disease_id: this.metadata.id,
        status: "unavailable",
        prediction: exec.prediction,
        probability: null,
        confidence: null,
        risk_category: "Unavailable",
        explanation: exec.explanation,
        recommended_next_step: this.metadata.recommendedNextStep,
        inputs_used: validation.cleaned,
        top_features: [],
        model_file: `models/${this.metadata.modelFileName}`,
      };
    }

    return {
      disease: this.metadata.name,
      disease_id: this.metadata.id,
      status: "available",
      prediction: exec.prediction,
      predicted_class: exec.predictedClass,
      probability: exec.probability,
      confidence: exec.confidence,
      risk_category: exec.riskCategory,
      explanation: exec.explanation,
      recommended_next_step: this.metadata.recommendedNextStep,
      top_features: exec.topFeatures || [],
      inputs_used: validation.cleaned,
      model_file: `models/${this.metadata.modelFileName}`,
    };
  }
}
