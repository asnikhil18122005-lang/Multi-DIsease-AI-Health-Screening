export type DiseaseId =
  | "heart_disease"
  | "diabetes"
  | "breast_cancer"
  | "kidney_disease"
  | "liver_disease"
  | "stroke"
  | "parkinsons"
  | "thyroid"
  | "lung_cancer"
  | "alzheimers";

export type RiskCategory =
  | "High Risk"
  | "Moderate Risk"
  | "Low Risk"
  | "Insufficient Data"
  | "Unavailable"
  | "Higher screening risk"
  | "Moderate screening risk"
  | "Lower screening risk";

export type PredictionStatus =
  "available" | "unavailable" | "insufficient_data" | "skipped" | "error";

export interface FeatureSpec {
  name: string;
  label: string;
  type: "number" | "select";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: number | string }[];
  placeholder?: string;
  required: boolean;
  category: "demographics" | "vitals" | "labs" | "lifestyle" | "clinical";
  description?: string;
}

export interface DiseaseMetadataClient {
  id: DiseaseId;
  name: string;
  code: string;
  endpoint: string;
  modelFileName: string;
  scalerFileName?: string;
  description: string;
  dataset: string;
  recommendedNextStep: string;
  requiredFeatureNames: string[];
  features: FeatureSpec[];
}

export interface UploadedReportMeta {
  reportId: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  fileTypeLabel: string;
  status: "Uploaded & Extracted" | "Uploaded (Manual Entry Needed)" | "Processed" | "Failed";
  extractionSuccess: boolean;
  textFound: boolean;
  extractedData: Record<string, unknown>;
  message: string;
  uploadedAt?: string;
}

export interface PatientSessionInput {
  // Patient Information
  name: string;
  patient_ref: string;
  age: number | "";
  sex: "Male" | "Female" | "";
  contact?: string;
  height: number | "";
  weight: number | "";
  bmi: number | "";
  blood_pressure?: string;
  other_notes?: string;

  // Medical History & Lifestyle
  smoking: boolean;
  alcohol: boolean;
  diabetes: boolean;
  hypertension: boolean;
  heart_disease: boolean;
  family_history: boolean;
  medical_history_notes?: string;

  // Symptoms
  symptoms: string[];

  // Vital Signs & Core Lab Values
  systolic_bp: number | "";
  diastolic_bp: number | "";
  heart_rate: number | "";
  glucose: number | "";
  cholesterol: number | "";
  hemoglobin: number | "";
  tsh: number | "";
  t3: number | "";
  tt4: number | "";
  t4u: number | "";
  fti: number | "";
  creatinine: number | "";
  urea: number | "";
  sg: number | "";
  albumin: number | "";
  total_bilirubin: number | "";
  direct_bilirubin: number | "";
  alkaline_phosphotase: number | "";
  sgpt: number | "";
  sgot: number | "";
  total_proteins: number | "";
  ag_ratio: number | "";
  insulin: number | "";
  skin_thickness: number | "";
  pregnancies: number | "";
  diabetes_pedigree: number | "";

  // Specialized Clinical & Diagnostic Measurements (Optional)
  chest_pain_type?: string;
  resting_ecg?: string;
  exercise_angina?: string;
  oldpeak: number | "";
  st_slope?: string;

  radius_mean: number | "";
  texture_mean: number | "";
  perimeter_mean: number | "";
  area_mean: number | "";
  smoothness_mean: number | "";
  compactness_mean: number | "";
  concavity_mean: number | "";
  concave_points_mean: number | "";

  MDVP_Fo_Hz: number | "";
  MDVP_Fhi_Hz: number | "";
  MDVP_Flo_Hz: number | "";
  MDVP_Jitter_Percent: number | "";
  MDVP_Shimmer: number | "";
  NHR: number | "";
  HNR: number | "";
  RPDE: number | "";
  DFA: number | "";
  PPE: number | "";

  MMSE: number | "";
  FunctionalAssessment: number | "";
  ADL: number | "";
  MemoryComplaints?: number | "";
  BehavioralProblems?: number | "";

  // Any additional dynamic field
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface PredictionResponse {
  disease: string;
  disease_id?: string;
  status: PredictionStatus;
  prediction: string | null;
  predicted_class?: string | null;
  probability: number | null;
  confidence?: number | null;
  risk_category: RiskCategory;
  missing_features?: string[];
  explanation: string;
  recommended_next_step?: string;
  top_features?: { name: string; importance: number }[];
  inputs_used?: Record<string, number | string>;
  model_file?: string;
}

export interface RemoteBackendStatus {
  reachable: boolean;
  url: string;
  statusText: "Backend Connected" | "Backend Offline";
  modelsLoaded: number;
  totalModels: number;
  loadedModelsList: string[];
  modelStatusMap: Record<string, boolean>;
  hasPredictEndpoint: boolean;
  diagnosticMessage: string | null;
  checkedAt: string;
}

export interface ScreeningAnalysisResponse {
  success: boolean;
  screening_id: string;
  record_id?: string;
  session_id?: string;
  patient_id: string;
  patient_ref: string;
  timestamp: string;
  patient_summary?: {
    name: string;
    patient_ref: string;
    age: number | null;
    sex: string | null;
    height: number | null;
    weight: number | null;
    bmi: number | null;
    systolic_bp: unknown;
    diastolic_bp: unknown;
    heart_rate: unknown;
    glucose: unknown;
    cholesterol: unknown;
    hemoglobin?: unknown;
    tsh?: unknown;
    symptoms: string[];
    medical_history?: string[];
    uploaded_document_name?: string | null;
    uploaded_document_type?: string | null;
    uploaded_document_size?: number | null;
    report_id?: string | null;
  };
  extracted_medical_info?: Record<string, unknown> | null;
  applicable_models?: string[];
  skipped_models?: { disease: string; disease_id: string; missing_features: string[] }[];
  missing_fields_by_model?: Record<string, string[]>;
  backend_status?: RemoteBackendStatus;
  summary: string;
  results: PredictionResponse[];
  predictions?: PredictionResponse[];
}

export interface ScreeningRecord {
  id: string;
  record_id?: string;
  user_id?: string;
  patient_id: string | null;
  patient_ref: string;
  patient_name?: string;
  patient_age?: number | null;
  patient_sex?: string | null;
  selected_diseases: string[];
  models_run: number;
  status: "completed" | "partial" | "error";
  summary: string;
  input_payload: Record<string, unknown>;
  entered_patient_info?: Record<string, unknown>;
  extracted_medical_info?: Record<string, unknown> | null;
  uploaded_document_name?: string | null;
  uploaded_document_type?: string | null;
  uploaded_document_size?: number | null;
  uploaded_document?: {
    report_id: string | null;
    filename: string;
    mime_type: string;
    file_size: number;
    extracted_data?: Record<string, unknown>;
    created_at?: string;
    download_url?: string | null;
  } | null;
  results_payload: {
    applicable_models?: string[];
    skipped_models?: { disease: string; disease_id: string; missing_features: string[] }[];
    results?: PredictionResponse[];
    extracted_medical_info?: Record<string, unknown> | null;
  };
  predictions?: PredictionResponse[];
  report_id: string | null;
  created_at: string;
  timestamp?: string;
}

export interface ModelStatusItem {
  id: string;
  name: string;
  code: string;
  available: boolean;
  loaded: boolean;
  status: "Loaded" | "Not Loaded" | "Connected" | "Not Connected";
  modelFileName: string;
  expectedPath: string;
  resolvedPath: string | null;
  scalerFileName?: string | null;
  scalerConnected?: boolean;
  endpoint: string;
  dataset: string;
  description: string;
  recommendedNextStep?: string | null;
  requiredFeatureNames: string[];
  featureOrder?: string[];
  featuresCount: number;
  features: {
    name: string;
    label: string;
    type: string;
    unit?: string;
    required: boolean;
  }[];
  metrics?: {
    samples?: number;
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1_score?: number;
  } | null;
  modelType: string;
  version: string;
}
