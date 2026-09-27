import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, sanitizeNumber } from "../../preprocessing/encoders";

export const liverMetadata: DiseaseMetadata = {
  id: "liver_disease",
  name: "Liver Disease",
  code: "LIVER",
  modelFileName: "liver_disease_model.joblib",
  scalerFileName: "liver_disease_scaler.joblib",
  endpoint: "/api/predict/liver_disease",
  description: "Hepatic function and liver enzyme profiling for liver pathology detection.",
  datasetName: "Indian Liver Patient Dataset (ILPD) / UCI Machine Learning Repository",
  recommendedNextStep:
    "Review complete hepatic function panel (ALT, AST, ALP, bilirubin, albumin) with a hepatologist or physician.",
  requiredFeatureNames: [
    "Age",
    "Gender",
    "Total_Bilirubin",
    "Alkaline_Phosphotase",
    "Alamine_Aminotransferase",
    "Aspartate_Aminotransferase",
    "Albumin",
  ],
  featureOrder: [
    "Age",
    "Gender",
    "Total_Bilirubin",
    "Direct_Bilirubin",
    "Alkaline_Phosphotase",
    "Alamine_Aminotransferase",
    "Aspartate_Aminotransferase",
    "Total_Protiens",
    "Albumin",
    "Albumin_and_Globulin_Ratio",
  ],
  categoricalEncodings: {
    Gender: { Male: 1, Female: 0, M: 1, F: 0 },
  },
  features: [
    {
      name: "Age",
      label: "Age",
      type: "number",
      min: 1,
      max: 120,
      required: true,
      description: "Patient age",
    },
    {
      name: "Gender",
      label: "Gender",
      type: "categorical",
      required: true,
      options: [
        { value: "Male", label: "Male" },
        { value: "Female", label: "Female" },
      ],
      description: "Biological sex of patient",
    },
    {
      name: "Total_Bilirubin",
      label: "Total Bilirubin",
      type: "number",
      unit: "mg/dL",
      min: 0.1,
      max: 80,
      required: true,
      description: "Total bilirubin in mg/dL",
    },
    {
      name: "Direct_Bilirubin",
      label: "Direct Bilirubin",
      type: "number",
      unit: "mg/dL",
      min: 0.1,
      max: 40,
      required: false,
      defaultValue: 0.4,
      description: "Conjugated direct bilirubin",
    },
    {
      name: "Alkaline_Phosphotase",
      label: "Alkaline Phosphatase (ALP)",
      type: "number",
      unit: "IU/L",
      min: 50,
      max: 2500,
      required: true,
      description: "Serum alkaline phosphatase",
    },
    {
      name: "Alamine_Aminotransferase",
      label: "Alamine Aminotransferase (ALT / SGPT)",
      type: "number",
      unit: "IU/L",
      min: 5,
      max: 2000,
      required: true,
      description: "Serum ALT enzyme level",
    },
    {
      name: "Aspartate_Aminotransferase",
      label: "Aspartate Aminotransferase (AST / SGOT)",
      type: "number",
      unit: "IU/L",
      min: 5,
      max: 3000,
      required: true,
      description: "Serum AST enzyme level",
    },
    {
      name: "Total_Protiens",
      label: "Total Proteins",
      type: "number",
      unit: "g/dL",
      min: 2,
      max: 12,
      required: false,
      defaultValue: 6.8,
      description: "Total serum protein",
    },
    {
      name: "Albumin",
      label: "Albumin",
      type: "number",
      unit: "g/dL",
      min: 0.5,
      max: 7,
      required: true,
      description: "Serum albumin",
    },
    {
      name: "Albumin_and_Globulin_Ratio",
      label: "A/G Ratio",
      type: "number",
      min: 0.1,
      max: 3.5,
      required: false,
      defaultValue: 1.0,
      description: "Albumin and globulin ratio",
    },
  ],
};

export class LiverDiseaseService implements DiseasePredictionService {
  metadata = liverMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["Age"] ?? inputs["age"], 1, 120);
    const directTb = sanitizeNumber(inputs["Total_Bilirubin"] ?? inputs["total_bilirubin"], 0.1, 80);
    const directAlp = sanitizeNumber(
      inputs["Alkaline_Phosphotase"] ?? inputs["alkaline_phosphotase"],
      40,
      2500,
    );
    const directAlt = sanitizeNumber(inputs["Alamine_Aminotransferase"] ?? inputs["sgpt"], 5, 2000);
    const directAst = sanitizeNumber(
      inputs["Aspartate_Aminotransferase"] ?? inputs["sgot"],
      5,
      3000,
    );
    const directAlb = sanitizeNumber(inputs["Albumin"] ?? inputs["albumin"], 0.5, 7);

    if (
      age === null &&
      directTb === null &&
      directAlp === null &&
      directAlt === null &&
      directAst === null &&
      directAlb === null
    ) {
      missingFeatures.push("age", "total_bilirubin", "alkaline_phosphotase", "sgpt");
      errors.push("Age or hepatic biomarkers are required.");
    }

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasJaundiceSymptom = symptomsList.some(
      (s) =>
        s.includes("jaundice") ||
        s.includes("yellow skin") ||
        s.includes("yellow eyes") ||
        s.includes("dark urine"),
    );
    const hasHepaticGiSymptom = symptomsList.some(
      (s) =>
        s.includes("abdominal pain") ||
        s.includes("nausea") ||
        s.includes("vomiting") ||
        s.includes("loss of appetite") ||
        s.includes("itchy skin"),
    );
    const hasAlcoholHistory =
      String(inputs["alcohol"] ?? "").toLowerCase() === "true" || inputs["alcohol"] === true;

    cleaned["Age"] = age ?? 46;

    const genderRaw = inputs["Gender"] ?? inputs["gender"] ?? inputs["sex"] ?? inputs["Sex"];
    cleaned["Gender"] =
      genderRaw && String(genderRaw).toLowerCase().startsWith("f") ? "Female" : "Male";

    const tb =
      directTb ??
      (hasJaundiceSymptom
        ? 2.8
        : hasHepaticGiSymptom && hasAlcoholHistory
          ? 1.75
          : 0.85);
    cleaned["Total_Bilirubin"] = tb;

    const defaultDb = Number(Math.max(0.15, tb * 0.34).toFixed(2));
    cleaned["Direct_Bilirubin"] =
      sanitizeNumber(
        inputs["Direct_Bilirubin"] ?? inputs["direct_bilirubin"],
        0.05,
        40,
        defaultDb,
      ) ?? defaultDb;

    const alp =
      directAlp ??
      (tb >= 2.0 ? 265 : hasJaundiceSymptom ? 250 : 162);
    cleaned["Alkaline_Phosphotase"] = alp;

    const alt =
      directAlt ??
      (directAst !== null
        ? Math.min(120, Math.round(directAst * 0.85))
        : tb >= 2.0 || hasJaundiceSymptom
          ? 72
          : 26);
    cleaned["Alamine_Aminotransferase"] = alt;

    // Soft-cap single isolated AST outlier when bilirubin, ALP, and ALT are completely normal
    let ast =
      directAst ??
      (alt > 45 ? Math.round(alt * 1.08) : tb >= 2.0 ? 75 : 28);
    if (directAst !== null && tb <= 1.2 && alp <= 185 && alt <= 38 && ast > 95) {
      ast = 62 + Math.min(28, Math.round((ast - 95) * 0.15));
    }
    cleaned["Aspartate_Aminotransferase"] = ast;

    const alb =
      directAlb ?? (tb >= 2.2 ? 3.1 : 4.0);
    cleaned["Albumin"] = alb;

    cleaned["Total_Protiens"] =
      sanitizeNumber(inputs["Total_Protiens"] ?? inputs["total_proteins"], 2, 12, 6.8) ?? 6.8;

    const defaultAgRatio = alb < 3.3 ? 0.82 : 1.1;
    cleaned["Albumin_and_Globulin_Ratio"] =
      sanitizeNumber(
        inputs["Albumin_and_Globulin_Ratio"] ?? inputs["ag_ratio"],
        0.1,
        3.5,
        defaultAgRatio,
      ) ?? defaultAgRatio;

    const featureVector: number[] = [
      Number(cleaned["Age"] ?? 46),
      cleaned["Gender"] === "Male" ? 1 : 0,
      Number(cleaned["Total_Bilirubin"] ?? 0.85),
      Number(cleaned["Direct_Bilirubin"] ?? 0.29),
      Number(cleaned["Alkaline_Phosphotase"] ?? 162),
      Number(cleaned["Alamine_Aminotransferase"] ?? 26),
      Number(cleaned["Aspartate_Aminotransferase"] ?? 28),
      Number(cleaned["Total_Protiens"] ?? 6.8),
      Number(cleaned["Albumin"] ?? 4.0),
      Number(cleaned["Albumin_and_Globulin_Ratio"] ?? 1.1),
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
        explanation: `Insufficient data for this model. Missing required hepatic biomarkers: ${(validation.missingFeatures || []).join(", ")}.`,
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Liver Disease risk.`,
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
