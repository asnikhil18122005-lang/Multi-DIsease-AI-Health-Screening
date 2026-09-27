export interface FeatureDefinition {
  name: string;
  label: string;
  type: "number" | "categorical" | "boolean";
  unit?: string;
  description: string;
  required: boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  defaultValue?: number | string | boolean;
}

export interface DiseaseMetadata {
  id: string;
  name: string;
  code: string;
  modelFileName: string;
  alternateModelFileNames?: string[];
  scalerFileName?: string;
  endpoint?: string;
  description: string;
  datasetName: string;
  recommendedNextStep?: string;
  requiredFeatureNames?: string[];
  featureOrder?: string[];
  categoricalEncodings?: Record<string, Record<string, number>>;
  features: FeatureDefinition[];
}

export type RiskCategoryLabel =
  | "High Risk"
  | "Moderate Risk"
  | "Low Risk"
  | "Insufficient Data"
  | "Higher screening risk"
  | "Moderate screening risk"
  | "Lower screening risk"
  | "Unavailable";

export interface ModelPredictionResult {
  disease: string;
  disease_id?: string;
  status: "available" | "unavailable" | "skipped" | "insufficient_data" | "error";
  prediction: string | null;
  predicted_class?: string | null;
  probability: number | null;
  confidence?: number | null;
  risk_category: RiskCategoryLabel;
  explanation: string;
  recommended_next_step?: string;
  missing_features?: string[];
  top_features?: { name: string; importance: number }[];
  inputs_used?: Record<string, unknown>;
  model_file?: string;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  missingFeatures?: string[];
  cleaned: Record<string, unknown>;
  featureVector?: number[];
}

export interface DiseasePredictionService {
  metadata: DiseaseMetadata;
  isModelAvailable(): boolean;
  validateInputs(inputs: Record<string, unknown>): ValidationResult;
  predict(inputs: Record<string, unknown>): Promise<ModelPredictionResult>;
}
