import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, encodeCategorical, sanitizeNumber } from "../../preprocessing/encoders";

const CHEST_PAIN_ENCODING: Record<string, number> = {
  ASY: 0,
  NAP: 1,
  ATA: 2,
  TA: 3,
};

const RESTING_ECG_ENCODING: Record<string, number> = {
  Normal: 0,
  ST: 1,
  LVH: 2,
};

const ST_SLOPE_ENCODING: Record<string, number> = {
  Up: 0,
  Flat: 1,
  Down: 2,
};

export const heartMetadata: DiseaseMetadata = {
  id: "heart_disease",
  name: "Heart Disease",
  code: "HEART",
  modelFileName: "heart_disease_model.joblib",
  scalerFileName: "heart_disease_scaler.joblib",
  endpoint: "/api/predict/heart_disease",
  description:
    "Cardiovascular risk screening based on resting vitals, cholesterol, ECG, and stress test factors.",
  datasetName: "Cleveland Heart Disease Dataset / UCI Machine Learning Repository",
  recommendedNextStep:
    "Schedule a cardiology review, resting 12-lead ECG, and fasting lipid profile.",
  requiredFeatureNames: ["Age", "Sex", "RestingBP", "Cholesterol"],
  featureOrder: [
    "Age",
    "Sex",
    "ChestPainType",
    "RestingBP",
    "Cholesterol",
    "FastingBS",
    "RestingECG",
    "MaxHR",
    "ExerciseAngina",
    "Oldpeak",
    "ST_Slope",
  ],
  categoricalEncodings: {
    Sex: { M: 1, F: 0, Male: 1, Female: 0 },
    ChestPainType: CHEST_PAIN_ENCODING,
    RestingECG: RESTING_ECG_ENCODING,
    ST_Slope: ST_SLOPE_ENCODING,
  },
  features: [
    {
      name: "Age",
      label: "Age",
      type: "number",
      unit: "years",
      min: 18,
      max: 120,
      required: true,
      description: "Patient age in years",
    },
    {
      name: "Sex",
      label: "Biological Sex",
      type: "categorical",
      required: true,
      options: [
        { value: "M", label: "Male" },
        { value: "F", label: "Female" },
      ],
      description: "Biological sex of patient",
    },
    {
      name: "ChestPainType",
      label: "Chest Pain Type",
      type: "categorical",
      required: false,
      defaultValue: "ASY",
      options: [
        { value: "ASY", label: "Asymptomatic (ASY)" },
        { value: "NAP", label: "Non-Anginal Pain (NAP)" },
        { value: "ATA", label: "Atypical Angina (ATA)" },
        { value: "TA", label: "Typical Angina (TA)" },
      ],
      description: "Classification of experienced chest discomfort",
    },
    {
      name: "RestingBP",
      label: "Resting Blood Pressure",
      type: "number",
      unit: "mmHg",
      min: 60,
      max: 240,
      required: true,
      description: "Resting systolic blood pressure in mmHg",
    },
    {
      name: "Cholesterol",
      label: "Serum Cholesterol",
      type: "number",
      unit: "mg/dL",
      min: 80,
      max: 600,
      required: true,
      description: "Serum cholesterol in mg/dL",
    },
    {
      name: "FastingBS",
      label: "Fasting Blood Sugar > 120 mg/dL",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Whether fasting blood glucose exceeds 120 mg/dL",
    },
    {
      name: "RestingECG",
      label: "Resting ECG Results",
      type: "categorical",
      required: false,
      defaultValue: "Normal",
      options: [
        { value: "Normal", label: "Normal" },
        { value: "ST", label: "ST-T wave abnormality" },
        { value: "LVH", label: "Left ventricular hypertrophy" },
      ],
      description: "Electrocardiographic findings at rest",
    },
    {
      name: "MaxHR",
      label: "Heart Rate / Max HR",
      type: "number",
      unit: "bpm",
      min: 50,
      max: 220,
      required: true,
      description: "Heart rate in bpm",
    },
    {
      name: "ExerciseAngina",
      label: "Exercise-Induced Angina",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Angina provoked by physical exertion",
    },
    {
      name: "Oldpeak",
      label: "Oldpeak (ST Depression)",
      type: "number",
      unit: "mm",
      min: -3,
      max: 7,
      required: false,
      defaultValue: 0,
      description: "ST depression induced by exercise relative to rest",
    },
    {
      name: "ST_Slope",
      label: "ST Segment Slope",
      type: "categorical",
      required: false,
      defaultValue: "Flat",
      options: [
        { value: "Up", label: "Upsloping" },
        { value: "Flat", label: "Flat" },
        { value: "Down", label: "Downsloping" },
      ],
      description: "Slope of the peak exercise ST segment",
    },
  ],
};

export class HeartDiseaseService implements DiseasePredictionService {
  metadata = heartMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["Age"] ?? inputs["age"], 1, 120);
    const directRbp = sanitizeNumber(
      inputs["RestingBP"] ?? inputs["systolic_bp"] ?? inputs["bp"],
      60,
      240,
    );
    const directChol = sanitizeNumber(inputs["Cholesterol"] ?? inputs["cholesterol"], 80, 600);

    if (age === null && directRbp === null && directChol === null) {
      missingFeatures.push("age", "systolic_bp", "cholesterol");
      errors.push("Age, Systolic Blood Pressure, or Cholesterol is required.");
    }

    const resolvedAge = age ?? 48;
    cleaned["Age"] = resolvedAge;

    const sexRaw = inputs["Sex"] ?? inputs["sex"] ?? inputs["gender"];
    cleaned["Sex"] =
      sexRaw && String(sexRaw).toUpperCase().startsWith("M") ? "M" : "F";

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasChestPainSymptom = symptomsList.some(
      (s) => s.includes("chest pain") || s.includes("angina") || s.includes("chest tightness"),
    );
    const hasDyspneaOrPalpitations = symptomsList.some(
      (s) =>
        s.includes("shortness of breath") ||
        s.includes("palpitation") ||
        s.includes("dizziness") ||
        s.includes("dyspnea"),
    );
    const hasPriorHeartDisease = Boolean(
      encodeBinary(inputs["heart_disease"] ?? inputs["CardiovascularDisease"]),
    );
    const hasHypertension = Boolean(
      encodeBinary(inputs["hypertension"] ?? inputs["htn"]),
    );

    const rawCp = String(inputs["ChestPainType"] ?? inputs["chest_pain_type"] ?? "ASY");
    let cp = rawCp;
    if (rawCp === "ASY") {
      if (hasChestPainSymptom) {
        cp = "TA";
      } else if (hasDyspneaOrPalpitations && hasPriorHeartDisease) {
        cp = "ATA";
      } else if (hasDyspneaOrPalpitations) {
        cp = "NAP";
      }
    }
    cleaned["ChestPainType"] = cp;

    const rbp =
      directRbp ?? (hasHypertension ? 146 : hasPriorHeartDisease ? 138 : 118);
    cleaned["RestingBP"] = rbp;

    const chol =
      directChol ?? (hasPriorHeartDisease ? 235 : 188);
    cleaned["Cholesterol"] = chol;

    cleaned["FastingBS"] = encodeBinary(
      inputs["FastingBS"] ??
        inputs["fasting_bs"] ??
        (Number(inputs["glucose"] ?? 0) > 125 || Boolean(encodeBinary(inputs["diabetes"]))),
    );

    const rawEcg = String(inputs["RestingECG"] ?? inputs["resting_ecg"] ?? "Normal");
    cleaned["RestingECG"] =
      rawEcg === "Normal" && hasPriorHeartDisease ? "ST" : rawEcg;

    // Handle resting heart_rate vs exercise MaxHR cleanly
    const restingHr = sanitizeNumber(inputs["heart_rate"], 40, 220);
    const rawMaxHr = sanitizeNumber(inputs["MaxHR"], 40, 220);
    let effectiveHr = 74;
    if (restingHr !== null) {
      effectiveHr = restingHr;
    } else if (rawMaxHr !== null) {
      effectiveHr =
        rawMaxHr > 130 ? Math.round(78 - (rawMaxHr - 150) * 0.25) : rawMaxHr;
    } else if (hasChestPainSymptom && hasDyspneaOrPalpitations) {
      effectiveHr = 92;
    }
    cleaned["MaxHR"] = effectiveHr;

    const explicitExAngina = inputs["ExerciseAngina"] ?? inputs["exercise_angina"];
    const hasExplicitExAnginaYes =
      explicitExAngina !== undefined &&
      explicitExAngina !== null &&
      ["y", "yes", "true", "1"].includes(String(explicitExAngina).trim().toLowerCase());
    cleaned["ExerciseAngina"] =
      hasExplicitExAnginaYes || (hasChestPainSymptom && hasDyspneaOrPalpitations)
        ? 1
        : 0;

    const defaultOldpeak = hasPriorHeartDisease
      ? 1.4
      : hasChestPainSymptom && (rbp >= 140 || hasHypertension)
        ? 0.9
        : 0.0;
    cleaned["Oldpeak"] =
      sanitizeNumber(inputs["Oldpeak"], -3, 7, defaultOldpeak) ?? defaultOldpeak;

    const rawSlope = inputs["ST_Slope"] ?? inputs["st_slope"];
    let resolvedSlope = "Up";
    if (
      rawSlope &&
      String(rawSlope) !== "Flat" &&
      ["Up", "Down"].includes(String(rawSlope))
    ) {
      resolvedSlope = String(rawSlope);
    } else if (hasPriorHeartDisease || (hasChestPainSymptom && hasDyspneaOrPalpitations)) {
      resolvedSlope = "Flat";
    }
    cleaned["ST_Slope"] = resolvedSlope;

    const featureVector: number[] = [
      Number(cleaned["Age"] ?? 48),
      cleaned["Sex"] === "M" ? 1 : 0,
      encodeCategorical(String(cleaned["ChestPainType"]), CHEST_PAIN_ENCODING, 0),
      Number(cleaned["RestingBP"] ?? 118),
      Number(cleaned["Cholesterol"] ?? 188),
      Number(cleaned["FastingBS"] ?? 0),
      encodeCategorical(String(cleaned["RestingECG"]), RESTING_ECG_ENCODING, 0),
      Number(cleaned["MaxHR"] ?? 74),
      Number(cleaned["ExerciseAngina"] ?? 0),
      Number(cleaned["Oldpeak"] ?? 0),
      encodeCategorical(String(cleaned["ST_Slope"]), ST_SLOPE_ENCODING, 0),
    ];

    return {
      valid: errors.length === 0,
      errors,
      missingFeatures,
      cleaned,
      featureVector,
    };
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
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Heart Disease risk.`,
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
