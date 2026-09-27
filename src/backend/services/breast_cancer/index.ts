import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, sanitizeNumber } from "../../preprocessing/encoders";

export const breastCancerMetadata: DiseaseMetadata = {
  id: "breast_cancer",
  name: "Breast Cancer",
  code: "BREAST_CANCER",
  modelFileName: "breast_cancer_model.joblib",
  scalerFileName: "breast_cancer_scaler.joblib",
  endpoint: "/api/predict/breast-cancer",
  description:
    "Cellular biopsy morphometric feature screening for benign vs. malignant mass detection.",
  datasetName: "Breast Cancer Wisconsin (Diagnostic) Data Set",
  recommendedNextStep:
    "Consult an oncologist or breast specialist for diagnostic mammography/ultrasound and pathology review.",
  requiredFeatureNames: ["radius_mean", "texture_mean", "perimeter_mean", "area_mean"],
  featureOrder: [
    "radius_mean",
    "texture_mean",
    "perimeter_mean",
    "area_mean",
    "smoothness_mean",
    "compactness_mean",
    "concavity_mean",
    "concave_points_mean",
    "symmetry_mean",
    "fractal_dimension_mean",
  ],
  features: [
    {
      name: "radius_mean",
      label: "Mean Radius",
      type: "number",
      min: 5,
      max: 40,
      required: true,
      description: "Mean of distances from center to points on perimeter",
    },
    {
      name: "texture_mean",
      label: "Mean Texture",
      type: "number",
      min: 5,
      max: 50,
      required: true,
      description: "Standard deviation of gray-scale values",
    },
    {
      name: "perimeter_mean",
      label: "Mean Perimeter",
      type: "number",
      min: 30,
      max: 250,
      required: true,
      description: "Perimeter length of cell nucleus",
    },
    {
      name: "area_mean",
      label: "Mean Area",
      type: "number",
      min: 100,
      max: 3000,
      required: true,
      description: "Area of cell nucleus",
    },
    {
      name: "smoothness_mean",
      label: "Mean Smoothness",
      type: "number",
      min: 0.01,
      max: 0.3,
      required: false,
      defaultValue: 0.096,
      description: "Local variation in radius lengths",
    },
    {
      name: "compactness_mean",
      label: "Mean Compactness",
      type: "number",
      min: 0.01,
      max: 0.4,
      required: false,
      defaultValue: 0.104,
      description: "(perimeter^2 / area - 1.0)",
    },
    {
      name: "concavity_mean",
      label: "Mean Concavity",
      type: "number",
      min: 0,
      max: 0.5,
      required: false,
      defaultValue: 0.088,
      description: "Severity of concave portions of contour",
    },
    {
      name: "concave_points_mean",
      label: "Mean Concave Points",
      type: "number",
      min: 0,
      max: 0.3,
      required: false,
      defaultValue: 0.048,
      description: "Number of concave portions of contour",
    },
    {
      name: "symmetry_mean",
      label: "Mean Symmetry",
      type: "number",
      min: 0.1,
      max: 0.4,
      required: false,
      defaultValue: 0.181,
      description: "Nuclear symmetry",
    },
    {
      name: "fractal_dimension_mean",
      label: "Mean Fractal Dimension",
      type: "number",
      min: 0.04,
      max: 0.1,
      required: false,
      defaultValue: 0.062,
      description: "Coastline approximation - 1",
    },
  ],
};

export class BreastCancerService implements DiseasePredictionService {
  metadata = breastCancerMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["age"] ?? inputs["Age"], 1, 120);
    const directRadius = sanitizeNumber(inputs["radius_mean"], 5, 40);
    const directTexture = sanitizeNumber(inputs["texture_mean"], 5, 50);
    const directPerimeter = sanitizeNumber(inputs["perimeter_mean"], 30, 250);
    const directArea = sanitizeNumber(inputs["area_mean"], 100, 3000);

    if (
      age === null &&
      directRadius === null &&
      directTexture === null &&
      directPerimeter === null &&
      directArea === null
    ) {
      missingFeatures.push("radius_mean", "texture_mean", "perimeter_mean", "area_mean");
      errors.push("Patient details or FNA biopsy morphometrics are required.");
    }

    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];
    const hasBreastLumpSymptom = symptomsList.some(
      (s) =>
        s.includes("breast") ||
        s.includes("lump") ||
        s.includes("mass") ||
        s.includes("nipple") ||
        s.includes("axillary"),
    );
    const hasSystemicWarning = symptomsList.some(
      (s) => s.includes("unexplained weight loss") || s.includes("night sweats"),
    );
    const hasFamilyHistory =
      String(inputs["family_history"] ?? "").toLowerCase() === "true" ||
      inputs["family_history"] === true;

    // Determine radius, texture, perimeter, area from direct biopsy inputs or symptom-calibrated baseline
    let radius = directRadius;
    if (radius === null) {
      if (directPerimeter !== null) {
        radius = Number((directPerimeter / (2 * Math.PI)).toFixed(2));
      } else if (directArea !== null) {
        radius = Number(Math.sqrt(directArea / Math.PI).toFixed(2));
      } else if (hasBreastLumpSymptom) {
        radius = hasFamilyHistory || hasSystemicWarning ? 18.8 : 16.4;
      } else {
        radius = 11.8;
      }
    }

    const texture =
      directTexture ??
      (hasBreastLumpSymptom ? 23.2 : radius > 15.5 ? 21.8 : 16.2);
    const perimeter =
      directPerimeter ?? Number((2 * Math.PI * radius * 1.02).toFixed(1));
    const area =
      directArea ?? Number((Math.PI * radius * radius * 0.96).toFixed(1));

    const radiusRatio = Math.max(0.6, Math.min(2.0, radius / 14.1));
    const smoothness =
      sanitizeNumber(
        inputs["smoothness_mean"],
        0.01,
        0.3,
        Number((0.088 * Math.pow(radiusRatio, 0.35)).toFixed(4)),
      ) ?? 0.088;
    const compactness =
      sanitizeNumber(
        inputs["compactness_mean"],
        0.01,
        0.4,
        Number((0.078 * Math.pow(radiusRatio, 0.85)).toFixed(4)),
      ) ?? 0.078;
    const concavity =
      sanitizeNumber(
        inputs["concavity_mean"],
        0,
        0.5,
        Number((0.052 * Math.pow(radiusRatio, 1.35)).toFixed(4)),
      ) ?? 0.052;
    const concavePoints =
      sanitizeNumber(
        inputs["concave_points_mean"],
        0,
        0.3,
        Number((0.028 * Math.pow(radiusRatio, 1.35)).toFixed(4)),
      ) ?? 0.028;
    const symmetry =
      sanitizeNumber(
        inputs["symmetry_mean"],
        0.1,
        0.4,
        Number((0.172 * Math.pow(radiusRatio, 0.25)).toFixed(4)),
      ) ?? 0.172;
    const fractalDim =
      sanitizeNumber(inputs["fractal_dimension_mean"], 0.04, 0.1, 0.061) ?? 0.061;

    cleaned["radius_mean"] = radius;
    cleaned["texture_mean"] = texture;
    cleaned["perimeter_mean"] = perimeter;
    cleaned["area_mean"] = area;
    cleaned["smoothness_mean"] = smoothness;
    cleaned["compactness_mean"] = compactness;
    cleaned["concavity_mean"] = concavity;
    cleaned["concave_points_mean"] = concavePoints;
    cleaned["symmetry_mean"] = symmetry;
    cleaned["fractal_dimension_mean"] = fractalDim;

    const featureVector: number[] = [
      radius,
      texture,
      perimeter,
      area,
      smoothness,
      compactness,
      concavity,
      concavePoints,
      symmetry,
      fractalDim,
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
        explanation: `Insufficient data for this model. Missing required biopsy morphometric features: ${(validation.missingFeatures || []).join(", ")}.`,
        recommended_next_step:
          "Provide FNA biopsy morphometric values (radius_mean, texture_mean, perimeter_mean, area_mean) to run Breast Cancer screening.",
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
