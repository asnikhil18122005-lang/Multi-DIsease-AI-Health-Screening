import type {
  DiseaseMetadata,
  DiseasePredictionService,
  ModelPredictionResult,
  ValidationResult,
} from "../base";
import { checkModelArtifactExists, executeModelInference } from "../modelLoader";
import { encodeBinary, sanitizeNumber } from "../../preprocessing/encoders";

export const lungCancerMetadata: DiseaseMetadata = {
  id: "lung_cancer",
  name: "Lung Cancer",
  code: "LUNG_CANCER",
  modelFileName: "lung_cancer_model.joblib",
  scalerFileName: "lung_cancer_scaler.joblib",
  endpoint: "/api/predict/lung-cancer",
  description:
    "Pulmonary oncology screening using behavioral, environmental, and symptomatic indicators.",
  datasetName: "Survey Lung Cancer Dataset / Kaggle Healthcare Repository",
  recommendedNextStep:
    "Discuss respiratory symptoms, smoking cessation, and low-dose chest CT screening with a pulmonologist.",
  requiredFeatureNames: ["GENDER", "AGE", "SMOKING"],
  featureOrder: [
    "GENDER",
    "AGE",
    "SMOKING",
    "YELLOW_FINGERS",
    "ANXIETY",
    "PEER_PRESSURE",
    "CHRONIC_DISEASE",
    "FATIGUE",
    "ALLERGY",
    "WHEEZING",
    "ALCOHOL_CONSUMING",
    "COUGHING",
    "SHORTNESS_OF_BREATH",
    "SWALLOWING_DIFFICULTY",
    "CHEST_PAIN",
  ],
  categoricalEncodings: {
    GENDER: { M: 1, F: 0, Male: 1, Female: 0 },
  },
  features: [
    {
      name: "GENDER",
      label: "Gender",
      type: "categorical",
      required: true,
      options: [
        { value: "M", label: "Male" },
        { value: "F", label: "Female" },
      ],
      description: "Biological sex",
    },
    {
      name: "AGE",
      label: "Age",
      type: "number",
      min: 18,
      max: 120,
      required: true,
      description: "Patient age",
    },
    {
      name: "SMOKING",
      label: "Smoking History",
      type: "boolean",
      required: true,
      defaultValue: false,
      description: "History of active tobacco smoking",
    },
    {
      name: "YELLOW_FINGERS",
      label: "Yellow / Nicotine-Stained Fingers",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Nicotine staining on fingers",
    },
    {
      name: "ANXIETY",
      label: "Anxiety",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Reported chronic anxiety",
    },
    {
      name: "PEER_PRESSURE",
      label: "Peer Pressure / Environmental Exposure",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Exposure to secondhand smoke / peer pressure",
    },
    {
      name: "CHRONIC_DISEASE",
      label: "Chronic Respiratory Disease",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "COPD, chronic bronchitis, or asthma",
    },
    {
      name: "FATIGUE",
      label: "Chronic Fatigue",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Persistent unexplained fatigue",
    },
    {
      name: "ALLERGY",
      label: "Respiratory Allergies",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "History of respiratory allergies",
    },
    {
      name: "WHEEZING",
      label: "Wheezing",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Audible wheezing breath sounds",
    },
    {
      name: "ALCOHOL_CONSUMING",
      label: "Alcohol Consumption",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Regular alcohol consumption",
    },
    {
      name: "COUGHING",
      label: "Persistent Cough",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Chronic non-clearing cough",
    },
    {
      name: "SHORTNESS_OF_BREATH",
      label: "Shortness of Breath (Dyspnea)",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Dyspnea on exertion or rest",
    },
    {
      name: "SWALLOWING_DIFFICULTY",
      label: "Swallowing Difficulty (Dysphagia)",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Painful or difficult swallowing",
    },
    {
      name: "CHEST_PAIN",
      label: "Chest Pain",
      type: "boolean",
      required: false,
      defaultValue: false,
      description: "Persistent chest or thoracic wall discomfort",
    },
  ],
};

export class LungCancerService implements DiseasePredictionService {
  metadata = lungCancerMetadata;

  isModelAvailable(): boolean {
    return checkModelArtifactExists(this.metadata.modelFileName, [], this.metadata.id);
  }

  validateInputs(inputs: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    const missingFeatures: string[] = [];
    const cleaned: Record<string, unknown> = {};

    const age = sanitizeNumber(inputs["AGE"] ?? inputs["age"] ?? inputs["Age"], 1, 120);
    const genderRaw = inputs["GENDER"] ?? inputs["gender"] ?? inputs["sex"] ?? inputs["Sex"];
    const symptomsList: string[] = Array.isArray(inputs["symptoms"])
      ? (inputs["symptoms"] as string[]).map((s) => String(s).toLowerCase())
      : [];

    if (age === null && (!genderRaw || String(genderRaw).trim() === "") && symptomsList.length === 0) {
      missingFeatures.push("age", "sex");
      errors.push("Age or Biological Sex is required.");
    }

    cleaned["GENDER"] =
      genderRaw && String(genderRaw).toUpperCase().startsWith("F") ? "F" : "M";
    cleaned["AGE"] = age ?? 50;

    const hasSym = (...keywords: string[]) =>
      symptomsList.some((s) => keywords.some((kw) => s.includes(kw)));

    cleaned["SMOKING"] = encodeBinary(inputs["SMOKING"] ?? inputs["smoking"]);
    cleaned["YELLOW_FINGERS"] = encodeBinary(
      inputs["YELLOW_FINGERS"] ?? inputs["yellow_fingers"] ?? hasSym("yellow finger", "nicotine"),
    );
    cleaned["ANXIETY"] = encodeBinary(
      inputs["ANXIETY"] ?? inputs["anxiety"] ?? hasSym("anxiety", "anxious", "panic"),
    );
    cleaned["PEER_PRESSURE"] = encodeBinary(inputs["PEER_PRESSURE"] ?? inputs["peer_pressure"]);
    cleaned["CHRONIC_DISEASE"] = encodeBinary(
      inputs["CHRONIC_DISEASE"] ??
        inputs["chronic_disease"] ??
        hasSym("chronic", "copd", "asthma", "bronchitis", "unexplained weight loss", "night sweats"),
    );
    cleaned["FATIGUE"] = encodeBinary(
      inputs["FATIGUE"] ??
        inputs["fatigue"] ??
        hasSym("fatigue", "tired", "exhaustion", "weakness"),
    );
    cleaned["ALLERGY"] = encodeBinary(inputs["ALLERGY"] ?? inputs["allergy"] ?? hasSym("allerg"));
    cleaned["WHEEZING"] = encodeBinary(inputs["WHEEZING"] ?? inputs["wheezing"] ?? hasSym("wheez"));
    cleaned["ALCOHOL_CONSUMING"] = encodeBinary(
      inputs["ALCOHOL_CONSUMING"] ?? inputs["alcohol_consuming"] ?? inputs["alcohol"],
    );
    cleaned["COUGHING"] = encodeBinary(
      inputs["COUGHING"] ?? inputs["coughing"] ?? inputs["cough"] ?? hasSym("cough"),
    );
    cleaned["SHORTNESS_OF_BREATH"] = encodeBinary(
      inputs["SHORTNESS_OF_BREATH"] ??
        inputs["shortness_of_breath"] ??
        hasSym("shortness of breath", "dyspnea", "breathless"),
    );
    cleaned["SWALLOWING_DIFFICULTY"] = encodeBinary(
      inputs["SWALLOWING_DIFFICULTY"] ??
        inputs["swallowing_difficulty"] ??
        hasSym("swallow", "dysphagia"),
    );
    cleaned["CHEST_PAIN"] = encodeBinary(
      inputs["CHEST_PAIN"] ??
        inputs["chest_pain"] ??
        hasSym("chest pain", "chest tightness", "thoracic"),
    );

    const featureVector: number[] = [
      cleaned["GENDER"] === "M" ? 1 : 0,
      Number(cleaned["AGE"] ?? 50),
      Number(cleaned["SMOKING"] ?? 0),
      Number(cleaned["YELLOW_FINGERS"] ?? 0),
      Number(cleaned["ANXIETY"] ?? 0),
      Number(cleaned["PEER_PRESSURE"] ?? 0),
      Number(cleaned["CHRONIC_DISEASE"] ?? 0),
      Number(cleaned["FATIGUE"] ?? 0),
      Number(cleaned["ALLERGY"] ?? 0),
      Number(cleaned["WHEEZING"] ?? 0),
      Number(cleaned["ALCOHOL_CONSUMING"] ?? 0),
      Number(cleaned["COUGHING"] ?? 0),
      Number(cleaned["SHORTNESS_OF_BREATH"] ?? 0),
      Number(cleaned["SWALLOWING_DIFFICULTY"] ?? 0),
      Number(cleaned["CHEST_PAIN"] ?? 0),
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
        recommended_next_step: `Provide ${(validation.missingFeatures || []).join(", ")} to evaluate Lung Cancer risk.`,
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
