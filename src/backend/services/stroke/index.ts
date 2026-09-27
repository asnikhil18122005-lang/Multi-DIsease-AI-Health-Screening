import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, encodeCategorical, sanitizeNumber } from "../../preprocessing/encoders";

const WORK_TYPE_ENCODING: Record<string, number> = {
  Private: 2,
  "Self-employed": 3,
  Govt_job: 0,
  children: 4,
  Never_worked: 1,
};

const RESIDENCE_ENCODING: Record<string, number> = {
  Urban: 1,
  Rural: 0,
};

const SMOKING_STATUS_ENCODING: Record<string, number> = {
  "never smoked": 0,
  Unknown: 0,
  "formerly smoked": 1,
  smokes: 2,
};

export const strokeMetadata: DiseaseMetadata = {
  id: "stroke",
  name: "Stroke",
  code: "STROKE",
  modelFileName: "stroke_disease_model.joblib",
  alternateModelFileNames: ["stroke_model.joblib"],
  scalerFileName: "stroke_scaler.joblib",
  endpoint: "/api/predict/stroke",
  description:
    "Cerebrovascular accident and stroke risk scoring using demographic, glycemic, and vascular factors.",
  datasetName: "Stroke Prediction Dataset / Kaggle Healthcare Data",
  recommendedNextStep:
    "Monitor blood pressure and blood glucose closely; seek vascular and neurological screening if risk factors are elevated.",
  requiredFeatureNames: ["gender", "age", "avg_glucose_level", "bmi"],
  featureOrder: [
    "gender",
    "age",
    "hypertension",
    "heart_disease",
    "ever_married",
    "work_type",
    "Residence_type",
    "avg_glucose_level",
    "bmi",
    "smoking_status",
  ],
  categoricalEncodings: {
    gender: { Male: 1, Female: 0, M: 1, F: 0 },
    ever_married: { Yes: 1, No: 0 },
    work_type: WORK_TYPE_ENCODING,
    Residence_type: RESIDENCE_ENCODING,
    smoking_status: SMOKING_STATUS_ENCODING,
  },
  features: [
    {
      name: "gender",
      label: "Gender",
      type: "categorical",
      required: true,
      options: [
        { value: "Male", label: "Male" },
        { value: "Female", label: "Female" },
      ],
      description: "Patient gender",
    },
    {
      name: "age",
      label: "Age",
      type: "number",
      min: 1,
      max: 120,
      required: true,
      description: "Patient age in years",
    },
    {
      name: "hypertension",
      label: "Hypertension",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "History of hypertension",
    },
    {
      name: "heart_disease",
      label: "Heart Disease",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "History of coronary artery disease",
    },
    {
      name: "ever_married",
      label: "Ever Married",
      type: "categorical",
      required: false,
      options: [
        { value: "Yes", label: "Yes" },
        { value: "No", label: "No" },
      ],
      defaultValue: "Yes",
      description: "Marital status history",
    },
    {
      name: "work_type",
      label: "Work Type",
      type: "categorical",
      required: false,
      options: [
        { value: "Private", label: "Private Enterprise" },
        { value: "Self-employed", label: "Self-Employed" },
        { value: "Govt_job", label: "Government" },
        { value: "children", label: "Children" },
        { value: "Never_worked", label: "Never Worked" },
      ],
      defaultValue: "Private",
      description: "Employment category",
    },
    {
      name: "Residence_type",
      label: "Residence Type",
      type: "categorical",
      required: false,
      options: [
        { value: "Urban", label: "Urban" },
        { value: "Rural", label: "Rural" },
      ],
      defaultValue: "Urban",
      description: "Residential setting",
    },
    {
      name: "avg_glucose_level",
      label: "Average Glucose Level",
      type: "number",
      unit: "mg/dL",
      min: 40,
      max: 400,
      required: true,
      description: "Average blood glucose level",
    },
    {
      name: "bmi",
      label: "Body Mass Index (BMI)",
      type: "number",
      unit: "kg/m²",
      min: 10,
      max: 70,
      required: true,
      description: "Body Mass Index",
    },
    {
      name: "smoking_status",
      label: "Smoking Status",
      type: "categorical",
      required: false,
      options: [
        { value: "formerly smoked", label: "Formerly Smoked" },
        { value: "never smoked", label: "Never Smoked" },
        { value: "smokes", label: "Actively Smokes" },
        { value: "Unknown", label: "Unknown" },
      ],
      defaultValue: "never smoked",
      description: "Tobacco smoking status",
    },
  ],
};

function resolveBmi(inputs: Record<string, unknown>): number | null {
  const directBmi = sanitizeNumber(inputs["bmi"] ?? inputs["BMI"], 10, 70);
  if (directBmi !== null) return directBmi;
  const h = sanitizeNumber(inputs["height"] ?? inputs["Height"], 40, 250);
  const w = sanitizeNumber(inputs["weight"] ?? inputs["Weight"], 2, 400);
  if (h !== null && w !== null && h > 0) {
    const computed = Number((w / ((h / 100) * (h / 100))).toFixed(1));
    if (computed >= 10 && computed <= 70) return computed;
  }
  return null;
}

export class StrokeService implements DiseasePredictionService {
  metadata = strokeMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(
      this.metadata.modelFileName,
      this.metadata.alternateModelFileNames,
      this.metadata.id,
    );
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["age"] ?? inputs["Age"], 1, 120);
    const directGlucose = sanitizeNumber(inputs["avg_glucose_level"] ?? inputs["glucose"], 40, 500);
    const directBmi = resolveBmi(inputs);

    if (age === null && directGlucose === null && directBmi === null) {
      missingFeatures.push("age", "glucose", "bmi");
      errors.push("Age, Average Glucose Level, or BMI is required.");
    }

    const genderRaw = inputs["gender"] ?? inputs["sex"] ?? inputs["Sex"];
    cleaned["gender"] =
      genderRaw && String(genderRaw).toLowerCase().startsWith("f") ? "Female" : "Male";

    const resolvedAge = age ?? 48;
    cleaned["age"] = resolvedAge;

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasNeuroStrokeSymptom = symptomsList.some(
      (s) =>
        s.includes("numbness") ||
        s.includes("weakness") ||
        s.includes("speech difficulty") ||
        s.includes("slurred") ||
        s.includes("blurred vision") ||
        s.includes("paralysis"),
    );
    const hasVascularDizziness = symptomsList.some(
      (s) => s.includes("dizziness") || s.includes("headache"),
    );

    const sysBp = sanitizeNumber(inputs["systolic_bp"] ?? inputs["RestingBP"], 60, 260);
    const diaBp = sanitizeNumber(inputs["diastolic_bp"], 40, 160);

    const hasHtn =
      Boolean(encodeBinary(inputs["hypertension"] ?? inputs["htn"])) ||
      (sysBp !== null && sysBp >= 140) ||
      (diaBp !== null && diaBp >= 90);
    cleaned["hypertension"] = hasHtn ? 1 : 0;

    const hasHeart =
      Boolean(encodeBinary(inputs["heart_disease"] ?? inputs["prior_stroke"])) ||
      hasNeuroStrokeSymptom ||
      (hasVascularDizziness && hasHtn && (sysBp ?? 0) >= 145);
    cleaned["heart_disease"] = hasHeart ? 1 : 0;

    cleaned["ever_married"] = String(
      inputs["ever_married"] ?? (resolvedAge >= 28 ? "Yes" : "No"),
    );
    cleaned["work_type"] = String(inputs["work_type"] ?? "Private");
    cleaned["Residence_type"] = String(inputs["Residence_type"] ?? "Urban");

    const glucose =
      directGlucose ??
      (encodeBinary(inputs["diabetes"]) ? 152 : hasNeuroStrokeSymptom ? 132 : 95);
    cleaned["avg_glucose_level"] = glucose;

    const bmi = directBmi ?? 24.2;
    cleaned["bmi"] = bmi;

    const isSmoker = Boolean(encodeBinary(inputs["smoking"] ?? inputs["SMOKING"]));
    const rawSmokingStatus = inputs["smoking_status"];
    cleaned["smoking_status"] = rawSmokingStatus
      ? String(rawSmokingStatus)
      : isSmoker
        ? "smokes"
        : hasNeuroStrokeSymptom
          ? "formerly smoked"
          : "never smoked";

    const featureVector: number[] = [
      cleaned["gender"] === "Male" ? 1 : 0,
      Number(cleaned["age"] ?? 48),
      Number(cleaned["hypertension"] ?? 0),
      Number(cleaned["heart_disease"] ?? 0),
      String(cleaned["ever_married"]).toLowerCase() === "yes" ? 1 : 0,
      encodeCategorical(String(cleaned["work_type"]), WORK_TYPE_ENCODING, 2),
      encodeCategorical(String(cleaned["Residence_type"]), RESIDENCE_ENCODING, 1),
      Number(cleaned["avg_glucose_level"] ?? 95),
      Number(cleaned["bmi"] ?? 24.2),
      encodeCategorical(String(cleaned["smoking_status"]), SMOKING_STATUS_ENCODING, 0),
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
        explanation: `Insufficient data for this model. Missing required features: ${(validation.missingFeatures || []).join(", ")}.`,
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Stroke risk.`,
        inputs_used: validation.cleaned,
        model_file: `models/${this.metadata.modelFileName}`,
      };
    }

    const exec = await executeModelInference(
      this.metadata.id,
      this.metadata.modelFileName,
      validation.featureVector || [],
      this.metadata.featureOrder || [],
      {
        alternateModelNames: this.metadata.alternateModelFileNames,
        scalerFileName: this.metadata.scalerFileName,
        rawInputs: inputs,
      },
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
