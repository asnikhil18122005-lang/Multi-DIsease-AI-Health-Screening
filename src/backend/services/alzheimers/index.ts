import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, sanitizeNumber } from "../../preprocessing/encoders";

export const alzheimersMetadata: DiseaseMetadata = {
  id: "alzheimers",
  name: "Alzheimer's Disease",
  code: "ALZHEIMERS",
  modelFileName: "alzheimers_model.joblib",
  scalerFileName: "alzheimers_scaler.joblib",
  endpoint: "/api/predict/alzheimers",
  description:
    "Neurodegenerative cognitive impairment and dementia risk profiling via biometric and mental status indicators.",
  datasetName: "Alzheimer's Disease Dataset / Kaggle Health Science Data",
  recommendedNextStep:
    "Schedule a formal cognitive and neurological assessment (MMSE / MoCA) with a neurologist or memory clinic.",
  requiredFeatureNames: ["Age", "Gender", "BMI", "MMSE"],
  featureOrder: [
    "Age",
    "Gender",
    "EducationLevel",
    "BMI",
    "Smoking",
    "AlcoholConsumption",
    "PhysicalActivity",
    "DietQuality",
    "SleepQuality",
    "FamilyHistoryAlzheimers",
    "CardiovascularDisease",
    "Diabetes",
    "Hypertension",
    "SystolicBP",
    "DiastolicBP",
    "CholesterolTotal",
    "MMSE",
    "FunctionalAssessment",
    "MemoryComplaints",
  ],
  categoricalEncodings: {
    Gender: { Male: 0, Female: 1, M: 0, F: 1, "0": 0, "1": 1 },
  },
  features: [
    {
      name: "Age",
      label: "Age",
      type: "number",
      min: 40,
      max: 120,
      required: true,
      description: "Patient age (typically >= 40)",
    },
    {
      name: "Gender",
      label: "Gender",
      type: "categorical",
      required: true,
      options: [
        { value: "0", label: "Male" },
        { value: "1", label: "Female" },
      ],
      description: "Patient gender",
    },
    {
      name: "EducationLevel",
      label: "Education Level",
      type: "categorical",
      required: false,
      options: [
        { value: "0", label: "None / Primary" },
        { value: "1", label: "High School" },
        { value: "2", label: "Bachelor's" },
        { value: "3", label: "Higher / Postgraduate" },
      ],
      defaultValue: "2",
      description: "Highest completed education level",
    },
    {
      name: "BMI",
      label: "Body Mass Index",
      type: "number",
      min: 10,
      max: 70,
      required: true,
      description: "Body mass index in kg/m²",
    },
    {
      name: "Smoking",
      label: "Smoking History",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Tobacco smoking status",
    },
    {
      name: "AlcoholConsumption",
      label: "Alcohol Consumption (units/wk)",
      type: "number",
      min: 0,
      max: 30,
      required: false,
      defaultValue: 2,
      description: "Weekly alcohol intake units",
    },
    {
      name: "PhysicalActivity",
      label: "Physical Activity (hrs/wk)",
      type: "number",
      min: 0,
      max: 20,
      required: false,
      defaultValue: 4,
      description: "Weekly moderate exercise hours",
    },
    {
      name: "DietQuality",
      label: "Diet Quality Score (0-10)",
      type: "number",
      min: 0,
      max: 10,
      required: false,
      defaultValue: 6,
      description: "Dietary balance score",
    },
    {
      name: "SleepQuality",
      label: "Sleep Quality Score (4-10)",
      type: "number",
      min: 4,
      max: 10,
      required: false,
      defaultValue: 7,
      description: "Average self-rated sleep score",
    },
    {
      name: "FamilyHistoryAlzheimers",
      label: "Family History of Alzheimer's",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "First-degree relative diagnosed with Alzheimer's",
    },
    {
      name: "CardiovascularDisease",
      label: "Cardiovascular Disease",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Comorbid cardiovascular diagnosis",
    },
    {
      name: "Diabetes",
      label: "Diabetes",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Diagnosed diabetes mellitus",
    },
    {
      name: "Hypertension",
      label: "Hypertension",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Diagnosed hypertension",
    },
    {
      name: "SystolicBP",
      label: "Systolic Blood Pressure",
      type: "number",
      unit: "mmHg",
      min: 70,
      max: 240,
      required: false,
      defaultValue: 120,
      description: "Systolic blood pressure in mmHg",
    },
    {
      name: "DiastolicBP",
      label: "Diastolic Blood Pressure",
      type: "number",
      unit: "mmHg",
      min: 40,
      max: 160,
      required: false,
      defaultValue: 80,
      description: "Diastolic blood pressure in mmHg",
    },
    {
      name: "CholesterolTotal",
      label: "Total Cholesterol",
      type: "number",
      unit: "mg/dL",
      min: 80,
      max: 500,
      required: false,
      defaultValue: 190,
      description: "Serum cholesterol in mg/dL",
    },
    {
      name: "MMSE",
      label: "MMSE (Mini-Mental State Exam Score)",
      type: "number",
      min: 0,
      max: 30,
      required: true,
      description: "Cognitive assessment score (0 - 30, lower = impairment)",
    },
    {
      name: "FunctionalAssessment",
      label: "Functional Assessment Score (0-10)",
      type: "number",
      min: 0,
      max: 10,
      required: false,
      defaultValue: 8,
      description: "Independence in activities of daily living",
    },
    {
      name: "MemoryComplaints",
      label: "Subjective Memory Complaints",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Frequent memory lapses reported by patient or family",
    },
  ],
};

function resolveBmi(inputs: Record<string, unknown>): number | null {
  const directBmi = sanitizeNumber(inputs["BMI"] ?? inputs["bmi"], 10, 70);
  if (directBmi !== null) return directBmi;
  const h = sanitizeNumber(inputs["height"] ?? inputs["Height"], 40, 250);
  const w = sanitizeNumber(inputs["weight"] ?? inputs["Weight"], 2, 400);
  if (h !== null && w !== null && h > 0) {
    const computed = Number((w / ((h / 100) * (h / 100))).toFixed(1));
    if (computed >= 10 && computed <= 70) return computed;
  }
  return null;
}

export class AlzheimersService implements DiseasePredictionService {
  metadata = alzheimersMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["Age"] ?? inputs["age"], 1, 120);
    const directMmse = sanitizeNumber(inputs["MMSE"] ?? inputs["mmse"], 0, 30);
    const directFunc = sanitizeNumber(
      inputs["FunctionalAssessment"] ?? inputs["functional_assessment"],
      0,
      10,
    );

    if (age === null && directMmse === null && directFunc === null) {
      missingFeatures.push("age", "MMSE");
      errors.push("Age or MMSE Cognitive Score (0-30) is required.");
    }

    const resolvedAge = age ?? 64;
    cleaned["Age"] = resolvedAge;

    const genderRaw = inputs["Gender"] ?? inputs["gender"] ?? inputs["sex"] ?? inputs["Sex"];
    cleaned["Gender"] =
      genderRaw !== undefined &&
      genderRaw !== null &&
      (String(genderRaw).toLowerCase().startsWith("f") || String(genderRaw) === "1")
        ? 1
        : 0;

    cleaned["EducationLevel"] = sanitizeNumber(inputs["EducationLevel"], 0, 3, 2) ?? 2;

    const bmi = resolveBmi(inputs) ?? 24.5;
    cleaned["BMI"] = bmi;

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];

    const cognitiveSymptoms = symptomsList.filter(
      (s) =>
        s.includes("memory") ||
        s.includes("forget") ||
        s.includes("forgot") ||
        s.includes("confusion") ||
        s.includes("disorientation") ||
        s.includes("cognitive") ||
        s.includes("dementia") ||
        s.includes("speech difficulty"),
    );

    const hasMemoryComplaints = Boolean(
      encodeBinary(inputs["MemoryComplaints"]) || cognitiveSymptoms.length > 0,
    );
    const hasFamilyHistory = Boolean(
      encodeBinary(inputs["FamilyHistoryAlzheimers"] ?? inputs["family_history"]),
    );
    const hasHypertension = Boolean(
      encodeBinary(inputs["Hypertension"] ?? inputs["hypertension"]),
    );
    const hasDiabetes = Boolean(encodeBinary(inputs["Diabetes"] ?? inputs["diabetes"]));
    const hasCardio = Boolean(
      encodeBinary(inputs["CardiovascularDisease"] ?? inputs["heart_disease"]),
    );

    // Resolve MMSE & FunctionalAssessment from direct inputs or cognitive symptom profile
    let mmse = directMmse;
    if (mmse === null) {
      if (hasMemoryComplaints) {
        let estimated = 22.5;
        if (cognitiveSymptoms.length >= 2) estimated -= 2.5;
        if (resolvedAge >= 70) estimated -= 1.8;
        else if (resolvedAge >= 60) estimated -= 1.0;
        if (hasFamilyHistory) estimated -= 1.2;
        if (hasHypertension || hasDiabetes || hasCardio) estimated -= 0.8;
        mmse = Number(Math.max(12.0, Math.min(25.0, estimated)).toFixed(1));
      } else {
        mmse = 28.5;
      }
    }
    cleaned["MMSE"] = mmse;

    let funcScore = directFunc;
    if (funcScore === null) {
      if (directMmse !== null) {
        funcScore = Number(Math.max(1.5, Math.min(9.5, (directMmse / 30) * 9.2)).toFixed(1));
      } else if (hasMemoryComplaints) {
        funcScore = mmse <= 19 ? 4.6 : 5.8;
      } else {
        funcScore = 8.6;
      }
    }
    cleaned["FunctionalAssessment"] = funcScore;

    cleaned["Smoking"] = encodeBinary(inputs["Smoking"] ?? inputs["smoking"]);
    cleaned["AlcoholConsumption"] =
      sanitizeNumber(
        inputs["AlcoholConsumption"] ?? (encodeBinary(inputs["alcohol"]) ? 8 : 1),
        0,
        30,
        1,
      ) ?? 1;
    cleaned["PhysicalActivity"] = sanitizeNumber(inputs["PhysicalActivity"], 0, 20, 5) ?? 5;
    cleaned["DietQuality"] = sanitizeNumber(inputs["DietQuality"], 0, 10, 7) ?? 7;
    cleaned["SleepQuality"] = sanitizeNumber(inputs["SleepQuality"], 4, 10, 7.2) ?? 7.2;
    cleaned["FamilyHistoryAlzheimers"] = hasFamilyHistory ? 1 : 0;
    cleaned["CardiovascularDisease"] = hasCardio ? 1 : 0;
    cleaned["Diabetes"] = hasDiabetes ? 1 : 0;
    cleaned["Hypertension"] = hasHypertension ? 1 : 0;
    cleaned["SystolicBP"] =
      sanitizeNumber(inputs["SystolicBP"] ?? inputs["systolic_bp"], 70, 240, 122) ?? 122;
    cleaned["DiastolicBP"] =
      sanitizeNumber(inputs["DiastolicBP"] ?? inputs["diastolic_bp"], 40, 160, 78) ?? 78;
    cleaned["CholesterolTotal"] =
      sanitizeNumber(inputs["CholesterolTotal"] ?? inputs["cholesterol"], 80, 500, 192) ?? 192;
    cleaned["MemoryComplaints"] = hasMemoryComplaints ? 1 : 0;

    const featureVector: number[] = [
      Number(cleaned["Age"] ?? 64),
      Number(cleaned["Gender"] ?? 0),
      Number(cleaned["EducationLevel"] ?? 2),
      Number(cleaned["BMI"] ?? 24.5),
      Number(cleaned["Smoking"] ?? 0),
      Number(cleaned["AlcoholConsumption"] ?? 1),
      Number(cleaned["PhysicalActivity"] ?? 5),
      Number(cleaned["DietQuality"] ?? 7),
      Number(cleaned["SleepQuality"] ?? 7.2),
      Number(cleaned["FamilyHistoryAlzheimers"] ?? 0),
      Number(cleaned["CardiovascularDisease"] ?? 0),
      Number(cleaned["Diabetes"] ?? 0),
      Number(cleaned["Hypertension"] ?? 0),
      Number(cleaned["SystolicBP"] ?? 122),
      Number(cleaned["DiastolicBP"] ?? 78),
      Number(cleaned["CholesterolTotal"] ?? 192),
      Number(cleaned["MMSE"] ?? 28.5),
      Number(cleaned["FunctionalAssessment"] ?? 8.6),
      Number(cleaned["MemoryComplaints"] ?? 0),
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
        explanation: `Insufficient data for this model. Missing required cognitive/clinical features: ${(validation.missingFeatures || []).join(", ")}.`,
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} (e.g., MMSE Cognitive Score 0-30) to evaluate Alzheimer's Disease risk.`,
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
