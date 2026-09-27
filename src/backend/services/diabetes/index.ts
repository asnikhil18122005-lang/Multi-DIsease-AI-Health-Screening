import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, sanitizeNumber } from "../../preprocessing/encoders";

export const diabetesMetadata: DiseaseMetadata = {
  id: "diabetes",
  name: "Diabetes",
  code: "DIABETES",
  modelFileName: "diabetes_model.joblib",
  scalerFileName: "diabetes_scaler.joblib",
  endpoint: "/api/predict/diabetes",
  description:
    "Metabolic glucose tolerance and glycemic risk assessment based on PIMA clinical markers.",
  datasetName:
    "PIMA Indians Diabetes Database / National Institute of Diabetes and Digestive and Kidney Diseases",
  recommendedNextStep:
    "Confirm glycemic status with a fasting plasma glucose test and HbA1c panel.",
  requiredFeatureNames: ["Glucose", "BloodPressure", "BMI", "Age"],
  featureOrder: [
    "Pregnancies",
    "Glucose",
    "BloodPressure",
    "SkinThickness",
    "Insulin",
    "BMI",
    "DiabetesPedigreeFunction",
    "Age",
  ],
  features: [
    {
      name: "Pregnancies",
      label: "Pregnancies",
      type: "number",
      min: 0,
      max: 20,
      required: false,
      defaultValue: 0,
      description: "Number of pregnancies",
    },
    {
      name: "Glucose",
      label: "Plasma Glucose Concentration",
      type: "number",
      unit: "mg/dL",
      min: 40,
      max: 400,
      required: true,
      description: "Plasma glucose concentration in mg/dL",
    },
    {
      name: "BloodPressure",
      label: "Diastolic Blood Pressure",
      type: "number",
      unit: "mmHg",
      min: 30,
      max: 160,
      required: true,
      description: "Diastolic blood pressure in mmHg",
    },
    {
      name: "SkinThickness",
      label: "Triceps Skin Fold Thickness",
      type: "number",
      unit: "mm",
      min: 0,
      max: 99,
      required: false,
      defaultValue: 20,
      description: "Triceps skin fold thickness in mm",
    },
    {
      name: "Insulin",
      label: "2-Hour Serum Insulin",
      type: "number",
      unit: "mu U/ml",
      min: 0,
      max: 900,
      required: false,
      defaultValue: 80,
      description: "2-Hour serum insulin in mu U/ml",
    },
    {
      name: "BMI",
      label: "Body Mass Index (BMI)",
      type: "number",
      unit: "kg/m²",
      min: 10,
      max: 70,
      required: true,
      description: "Weight in kg/(height in m)^2",
    },
    {
      name: "DiabetesPedigreeFunction",
      label: "Diabetes Pedigree Function",
      type: "number",
      min: 0.05,
      max: 3.0,
      required: false,
      defaultValue: 0.45,
      description: "Genetic pedigree risk function score",
    },
    {
      name: "Age",
      label: "Age",
      type: "number",
      unit: "years",
      min: 1,
      max: 120,
      required: true,
      description: "Patient age in years",
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

export class DiabetesService implements DiseasePredictionService {
  metadata = diabetesMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["Age"] ?? inputs["age"], 1, 120);
    const directGlucose = sanitizeNumber(inputs["Glucose"] ?? inputs["glucose"], 40, 500);
    const directBmi = resolveBmi(inputs);

    if (age === null && directGlucose === null && directBmi === null) {
      missingFeatures.push("age", "glucose", "bmi");
      errors.push("Age, Glucose, or BMI is required to evaluate Diabetes risk.");
    }

    const resolvedAge = age ?? 45;
    cleaned["Age"] = resolvedAge;

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasDiabeticSymptom = (...keywords: string[]) =>
      symptomsList.some((s) => keywords.some((kw) => s.includes(kw)));

    const polyuriaOrPolydipsia = hasDiabeticSymptom(
      "frequent urination",
      "excessive thirst",
      "increased hunger",
      "blurred vision",
      "unexplained weight loss",
    );
    const hasDiabetesHistory = Boolean(
      encodeBinary(inputs["diabetes"] ?? inputs["Diabetes"]),
    );
    const hasFamilyHistory = Boolean(
      encodeBinary(inputs["family_history"] ?? inputs["FamilyHistory"]),
    );

    const glucose =
      directGlucose ??
      (hasDiabetesHistory ? 162 : polyuriaOrPolydipsia ? 138 : 94);
    cleaned["Glucose"] = glucose;

    const diaBp = sanitizeNumber(inputs["BloodPressure"] ?? inputs["diastolic_bp"], 35, 150);
    const sysBp = sanitizeNumber(inputs["systolic_bp"] ?? inputs["bp"], 60, 240);
    const bp =
      diaBp ??
      (sysBp !== null
        ? sysBp > 110
          ? Math.round(sysBp * 0.62)
          : sysBp
        : encodeBinary(inputs["hypertension"])
          ? 88
          : 74);
    cleaned["BloodPressure"] = bp;

    cleaned["Pregnancies"] =
      sanitizeNumber(inputs["Pregnancies"] ?? inputs["pregnancies"], 0, 25, 0) ?? 0;

    const bmi = directBmi ?? 23.8;
    cleaned["BMI"] = bmi;

    cleaned["SkinThickness"] =
      sanitizeNumber(
        inputs["SkinThickness"] ?? inputs["skin_thickness"],
        5,
        99,
        bmi >= 30 ? 28 : 20,
      ) ?? (bmi >= 30 ? 28 : 20);

    const defaultInsulin = hasDiabetesHistory
      ? 165
      : glucose >= 140
        ? 135
        : polyuriaOrPolydipsia
          ? 120
          : 78;
    cleaned["Insulin"] =
      sanitizeNumber(inputs["Insulin"] ?? inputs["insulin"], 5, 900, defaultInsulin) ??
      defaultInsulin;

    let defaultPedigree = 0.32;
    if (hasFamilyHistory) defaultPedigree += 0.32;
    if (hasDiabetesHistory) defaultPedigree += 0.55;
    if (polyuriaOrPolydipsia) defaultPedigree += 0.25;

    cleaned["DiabetesPedigreeFunction"] =
      sanitizeNumber(
        inputs["DiabetesPedigreeFunction"] ?? inputs["pedigree"],
        0.05,
        3.0,
        Number(defaultPedigree.toFixed(2)),
      ) ?? Number(defaultPedigree.toFixed(2));

    const featureVector: number[] = [
      Number(cleaned["Pregnancies"] ?? 0),
      Number(cleaned["Glucose"] ?? 94),
      Number(cleaned["BloodPressure"] ?? 74),
      Number(cleaned["SkinThickness"] ?? 20),
      Number(cleaned["Insulin"] ?? 78),
      Number(cleaned["BMI"] ?? 23.8),
      Number(cleaned["DiabetesPedigreeFunction"] ?? 0.32),
      Number(cleaned["Age"] ?? 45),
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
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Diabetes risk.`,
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
