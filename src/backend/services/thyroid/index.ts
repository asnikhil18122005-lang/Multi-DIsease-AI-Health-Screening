import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, sanitizeNumber } from "../../preprocessing/encoders";

export const thyroidMetadata: DiseaseMetadata = {
  id: "thyroid",
  name: "Thyroid Disease",
  code: "THYROID",
  modelFileName: "thyroid_model.joblib",
  alternateModelFileNames: ["thyroid_disease_model.joblib"],
  scalerFileName: "thyroid_scaler.joblib",
  endpoint: "/api/predict/thyroid",
  description:
    "Endocrine screening for hypothyroid and hyperthyroid functional states via thyrotropic biomarkers.",
  datasetName: "Thyroid Disease Data Set / Garvan Institute of Medical Research & UCI",
  recommendedNextStep:
    "Review thyroid function panel (TSH, Free T3, Free T4) with an endocrinologist or primary care physician.",
  requiredFeatureNames: ["age", "sex", "TSH"],
  featureOrder: [
    "age",
    "sex",
    "on_thyroxine",
    "query_on_thyroxine",
    "on_antithyroid_medication",
    "sick",
    "pregnant",
    "thyroid_surgery",
    "TSH",
    "T3",
    "TT4",
    "T4U",
    "FTI",
  ],
  categoricalEncodings: {
    sex: { M: 1, F: 0, Male: 1, Female: 0 },
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
      name: "sex",
      label: "Sex",
      type: "categorical",
      required: true,
      options: [
        { value: "F", label: "Female" },
        { value: "M", label: "Male" },
      ],
      description: "Biological sex",
    },
    {
      name: "on_thyroxine",
      label: "On Thyroxine Medication",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Whether patient takes thyroxine",
    },
    {
      name: "query_on_thyroxine",
      label: "Query On Thyroxine",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Query if on thyroxine",
    },
    {
      name: "on_antithyroid_medication",
      label: "On Antithyroid Medication",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Whether patient takes antithyroid drugs",
    },
    {
      name: "sick",
      label: "Sick / Acute Concurrent Illness",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Concurrent acute systemic illness",
    },
    {
      name: "pregnant",
      label: "Pregnant",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Whether currently pregnant",
    },
    {
      name: "thyroid_surgery",
      label: "Prior Thyroid Surgery",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "History of thyroidectomy or surgery",
    },
    {
      name: "TSH",
      label: "TSH (Thyroid Stimulating Hormone)",
      type: "number",
      unit: "mIU/L",
      min: 0.001,
      max: 200,
      required: true,
      description: "Serum thyrotropin level",
    },
    {
      name: "T3",
      label: "T3 (Triiodothyronine)",
      type: "number",
      unit: "nmol/L",
      min: 0.1,
      max: 12,
      required: false,
      defaultValue: 2.0,
      description: "Serum triiodothyronine level",
    },
    {
      name: "TT4",
      label: "TT4 (Total Thyroxine)",
      type: "number",
      unit: "nmol/L",
      min: 5,
      max: 400,
      required: false,
      defaultValue: 105,
      description: "Total serum thyroxine",
    },
    {
      name: "T4U",
      label: "T4U (T4 Uptake)",
      type: "number",
      min: 0.2,
      max: 2.5,
      required: false,
      defaultValue: 0.99,
      description: "T4 uptake ratio",
    },
    {
      name: "FTI",
      label: "FTI (Free Thyroxine Index)",
      type: "number",
      min: 10,
      max: 400,
      required: false,
      defaultValue: 110,
      description: "Free thyroxine index",
    },
  ],
};

export class ThyroidService implements DiseasePredictionService {
  metadata = thyroidMetadata;

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
    const directTsh = sanitizeNumber(inputs["TSH"] ?? inputs["tsh"], 0.001, 200);
    const directT3 = sanitizeNumber(inputs["T3"] ?? inputs["t3"], 0.1, 300);
    const directTt4 = sanitizeNumber(inputs["TT4"] ?? inputs["tt4"], 0.2, 400);

    if (age === null && directTsh === null && directT3 === null && directTt4 === null) {
      missingFeatures.push("age", "tsh");
      errors.push("Age or TSH is required to evaluate Thyroid Disease risk.");
    }

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasThyroidSymptom = symptomsList.some(
      (s) =>
        s.includes("intolerance") ||
        s.includes("neck swelling") ||
        s.includes("goiter") ||
        s.includes("hair loss"),
    );
    const hasWeightOrFatigue = symptomsList.some(
      (s) =>
        s.includes("weight gain") ||
        s.includes("unexplained weight loss") ||
        (s.includes("fatigue") && hasThyroidSymptom),
    );

    cleaned["age"] = age ?? 46;

    const sexRaw = inputs["sex"] ?? inputs["Sex"] ?? inputs["gender"];
    cleaned["sex"] =
      sexRaw && String(sexRaw).toUpperCase().startsWith("M") ? "M" : "F";

    const tsh =
      directTsh ??
      (hasThyroidSymptom ? (hasWeightOrFatigue ? 7.4 : 5.1) : 2.1);
    cleaned["TSH"] = tsh;

    cleaned["on_thyroxine"] = encodeBinary(inputs["on_thyroxine"]);
    cleaned["query_on_thyroxine"] = encodeBinary(inputs["query_on_thyroxine"]);
    cleaned["on_antithyroid_medication"] = encodeBinary(inputs["on_antithyroid_medication"]);
    cleaned["sick"] = encodeBinary(
      inputs["sick"] ?? (hasThyroidSymptom && hasWeightOrFatigue),
    );
    cleaned["pregnant"] = encodeBinary(inputs["pregnant"]);
    cleaned["thyroid_surgery"] = encodeBinary(inputs["thyroid_surgery"]);

    // Normalize T3 (convert ng/dL > 30 to nmol/L)
    let resolvedT3 =
      directT3 !== null
        ? directT3 > 30
          ? Number((directT3 * 0.01536).toFixed(2))
          : directT3
        : tsh >= 7.0
          ? 1.35
          : tsh >= 4.5
            ? 1.75
            : 2.1;
    resolvedT3 = Math.max(0.3, Math.min(7.0, resolvedT3));
    cleaned["T3"] = resolvedT3;

    // Normalize TT4 (convert Free T4 ng/dL <= 3.5 or Total T4 µg/dL 3.5..22 to nmol/L)
    let resolvedTt4: number;
    if (directTt4 !== null) {
      if (directTt4 <= 3.5) {
        resolvedTt4 = Number((directTt4 * 88).toFixed(1));
      } else if (directTt4 <= 22) {
        resolvedTt4 = Number((directTt4 * 12.87).toFixed(1));
      } else {
        resolvedTt4 = directTt4;
      }
    } else {
      resolvedTt4 = tsh >= 7.0 ? 74 : tsh >= 4.5 ? 92 : 112;
    }
    cleaned["TT4"] = resolvedTt4;

    const t4u = sanitizeNumber(inputs["T4U"] ?? inputs["t4u"], 0.2, 2.5, 1.0) ?? 1.0;
    cleaned["T4U"] = t4u;

    const defaultFti = Number((resolvedTt4 / Math.max(0.5, t4u)).toFixed(1));
    const fti =
      sanitizeNumber(inputs["FTI"] ?? inputs["fti"], 10, 400, defaultFti) ?? defaultFti;
    cleaned["FTI"] = fti;

    // If TSH is pathologically suppressed (< 0.35 mIU/L, hyperthyroidism), reflect thyrotropic deviation in effective TSH
    const effectiveTshForModel =
      tsh < 0.35 ? Number((7.8 + (0.35 - tsh) * 18).toFixed(2)) : tsh;

    const featureVector: number[] = [
      Number(cleaned["age"] ?? 46),
      cleaned["sex"] === "M" ? 1 : 0,
      Number(cleaned["on_thyroxine"] ?? 0),
      Number(cleaned["query_on_thyroxine"] ?? 0),
      Number(cleaned["on_antithyroid_medication"] ?? 0),
      Number(cleaned["sick"] ?? 0),
      Number(cleaned["pregnant"] ?? 0),
      Number(cleaned["thyroid_surgery"] ?? 0),
      effectiveTshForModel,
      resolvedT3,
      resolvedTt4,
      t4u,
      fti,
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
        explanation: `Insufficient data for this model. Missing required thyroid biomarkers: ${(validation.missingFeatures || []).join(", ")}.`,
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Thyroid Disease risk.`,
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
