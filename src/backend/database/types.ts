export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  name: string;
  reset_token?: string | null;
  reset_token_expires?: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbPatient {
  id: string;
  user_id: string;
  name: string;
  patient_ref: string;
  age: number;
  sex: string;
  contact?: string | null;
  height?: number | null;
  weight?: number | null;
  bmi?: number | null;
  created_at: string;
}

export interface DbScreening {
  id: string;
  user_id: string;
  patient_id?: string | null;
  patient_ref: string;
  selected_diseases: string[];
  models_run: number;
  status: "completed" | "partial" | "error";
  summary: string;
  input_payload: Record<string, unknown>;
  results_payload: Record<string, unknown>;
  report_id?: string | null;
  created_at: string;
}

export interface DbPrediction {
  id: string;
  screening_id: string;
  user_id: string;
  disease: string;
  status: "available" | "unavailable" | "skipped" | "error";
  prediction: string | null;
  predicted_class?: string | null;
  probability: number | null;
  risk_category: string;
  explanation: string;
  top_features: { name: string; importance: number }[];
  inputs_used: Record<string, unknown>;
  created_at: string;
}

export interface DbPatientSession {
  session_id: string;
  user_id: string;
  patient_data: Record<string, unknown>;
  uploaded_documents: Record<string, unknown>[];
  extracted_data: Record<string, unknown>;
  predictions: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface DbMedicalReport {
  id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  extracted_data: Record<string, number | null>;
  text_content?: string | null;
  screening_id?: string | null;
  patient_ref?: string | null;
  created_at: string;
}
