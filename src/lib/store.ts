import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import type {
  ModelStatusItem,
  PatientSessionInput,
  PredictionResponse,
  RemoteBackendStatus,
  UploadedReportMeta,
} from "./types";
import { checkDeployedBackendHealth, fetchModelsStatus } from "./api";

export const INITIAL_PATIENT_INPUT: PatientSessionInput = {
  name: "",
  patient_ref: "",
  age: "",
  sex: "",
  contact: "",
  height: "",
  weight: "",
  bmi: "",
  blood_pressure: "",
  other_notes: "",

  smoking: false,
  alcohol: false,
  diabetes: false,
  hypertension: false,
  heart_disease: false,
  family_history: false,
  medical_history_notes: "",

  symptoms: [],

  systolic_bp: "",
  diastolic_bp: "",
  heart_rate: "",
  glucose: "",
  cholesterol: "",
  hemoglobin: "",
  tsh: "",
  t3: "",
  tt4: "",
  t4u: "",
  fti: "",
  creatinine: "",
  urea: "",
  sg: "",
  albumin: "",
  total_bilirubin: "",
  direct_bilirubin: "",
  alkaline_phosphotase: "",
  sgpt: "",
  sgot: "",
  total_proteins: "",
  ag_ratio: "",
  insulin: "",
  skin_thickness: "",
  pregnancies: "",
  diabetes_pedigree: "",

  chest_pain_type: "ASY",
  resting_ecg: "Normal",
  exercise_angina: "N",
  oldpeak: "",
  st_slope: "Flat",

  radius_mean: "",
  texture_mean: "",
  perimeter_mean: "",
  area_mean: "",
  smoothness_mean: "",
  compactness_mean: "",
  concavity_mean: "",
  concave_points_mean: "",

  MDVP_Fo_Hz: "",
  MDVP_Fhi_Hz: "",
  MDVP_Flo_Hz: "",
  MDVP_Jitter_Percent: "",
  MDVP_Shimmer: "",
  NHR: "",
  HNR: "",
  RPDE: "",
  DFA: "",
  PPE: "",

  MMSE: "",
  FunctionalAssessment: "",
  ADL: "",
  MemoryComplaints: "",
  BehavioralProblems: "",
};

const SESSION_STORAGE_KEY = "multi_disease_screening_state_v2";

interface ScreeningStoreContextType {
  workflowStep: "patient" | "review";
  setWorkflowStep: (step: "patient" | "review") => void;
  patientInput: PatientSessionInput;
  setPatientInput: React.Dispatch<React.SetStateAction<PatientSessionInput>>;
  updateField: (field: keyof PatientSessionInput, value: unknown) => void;
  toggleSymptom: (symptom: string) => void;
  uploadedReport: UploadedReportMeta | null;
  setUploadedReport: React.Dispatch<React.SetStateAction<UploadedReportMeta | null>>;
  activeReportId: string | null;
  setActiveReportId: (id: string | null) => void;
  activeScreeningId: string | null;
  setActiveScreeningId: (id: string | null) => void;
  currentResults: PredictionResponse[];
  setCurrentResults: (results: PredictionResponse[]) => void;
  modelStatuses: Record<string, ModelStatusItem>;
  modelStatusList: ModelStatusItem[];
  remoteBackendStatus: RemoteBackendStatus | null;
  isCheckingBackend: boolean;
  refreshModelStatuses: (force?: boolean) => Promise<void>;
  resetSession: () => void;
}

const StoreContext = createContext<ScreeningStoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [workflowStep, setWorkflowStep] = useState<"patient" | "review">("patient");
  const [patientInput, setPatientInput] = useState<PatientSessionInput>(INITIAL_PATIENT_INPUT);
  const [uploadedReport, setUploadedReport] = useState<UploadedReportMeta | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeScreeningId, setActiveScreeningId] = useState<string | null>(null);
  const [currentResults, setCurrentResults] = useState<PredictionResponse[]>([]);
  const [modelStatuses, setModelStatuses] = useState<Record<string, ModelStatusItem>>({});
  const [modelStatusList, setModelStatusList] = useState<ModelStatusItem[]>([]);
  const [remoteBackendStatus, setRemoteBackendStatus] = useState<RemoteBackendStatus | null>(null);
  const [isCheckingBackend, setIsCheckingBackend] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore session state on client mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          patientInput?: PatientSessionInput;
          uploadedReport?: UploadedReportMeta | null;
          activeReportId?: string | null;
          activeScreeningId?: string | null;
          currentResults?: PredictionResponse[];
        };
        if (parsed.patientInput) {
          setPatientInput({ ...INITIAL_PATIENT_INPUT, ...parsed.patientInput });
        }
        if (parsed.uploadedReport) {
          setUploadedReport(parsed.uploadedReport);
        }
        if (parsed.activeReportId) {
          setActiveReportId(parsed.activeReportId);
        }
        if (parsed.activeScreeningId) {
          setActiveScreeningId(parsed.activeScreeningId);
        }
        if (Array.isArray(parsed.currentResults) && parsed.currentResults.length > 0) {
          setCurrentResults(parsed.currentResults);
        }
      }
    } catch {
      // ignore sessionStorage error
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist session state so navigating between Patient -> Review -> Predict never loses data
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          patientInput,
          uploadedReport,
          activeReportId,
          activeScreeningId,
          currentResults,
        }),
      );
    } catch {
      // ignore storage quota errors
    }
  }, [hydrated, patientInput, uploadedReport, activeReportId, activeScreeningId, currentResults]);

  const refreshModelStatuses = useCallback(async (force = false) => {
    setIsCheckingBackend(true);
    try {
      const [healthData, statusData] = await Promise.all([
        checkDeployedBackendHealth(force).catch(() => null),
        fetchModelsStatus().catch(() => null),
      ]);

      if (healthData?.remote_backend) {
        setRemoteBackendStatus(healthData.remote_backend);
      } else if (statusData?.remote_backend) {
        setRemoteBackendStatus(statusData.remote_backend);
      }

      if (statusData?.models) {
        setModelStatusList(statusData.models);
        setModelStatuses(statusData.map || {});
      }
    } catch {
      // ignore
    } finally {
      setIsCheckingBackend(false);
    }
  }, []);

  // Automatically check GET https://multi-disease-backend-5gms.onrender.com/health when app starts
  useEffect(() => {
    refreshModelStatuses(false);
  }, [refreshModelStatuses]);

  const updateField = useCallback((field: keyof PatientSessionInput, value: unknown) => {
    setPatientInput((prev) => {
      const updated = { ...prev, [field]: value };

      // Auto-calculate BMI if height (cm) and weight (kg) are valid
      if (field === "height" || field === "weight") {
        const h = Number(field === "height" ? value : prev.height);
        const w = Number(field === "weight" ? value : prev.weight);
        if (h > 40 && w > 10) {
          const hMeters = h / 100;
          const bmiVal = Number((w / (hMeters * hMeters)).toFixed(1));
          if (Number.isFinite(bmiVal) && bmiVal > 5 && bmiVal < 90) {
            updated.bmi = bmiVal;
          }
        }
      }
      return updated;
    });
  }, []);

  const toggleSymptom = useCallback((symptom: string) => {
    setPatientInput((prev) => {
      const exists = prev.symptoms.includes(symptom);
      return {
        ...prev,
        symptoms: exists ? prev.symptoms.filter((s) => s !== symptom) : [...prev.symptoms, symptom],
      };
    });
  }, []);

  const resetSession = useCallback(() => {
    setWorkflowStep("patient");
    setPatientInput(INITIAL_PATIENT_INPUT);
    setUploadedReport(null);
    setActiveReportId(null);
    setActiveScreeningId(null);
    setCurrentResults([]);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return React.createElement(
    StoreContext.Provider,
    {
      value: {
        workflowStep,
        setWorkflowStep,
        patientInput,
        setPatientInput,
        updateField,
        toggleSymptom,
        uploadedReport,
        setUploadedReport,
        activeReportId,
        setActiveReportId,
        activeScreeningId,
        setActiveScreeningId,
        currentResults,
        setCurrentResults,
        modelStatuses,
        modelStatusList,
        remoteBackendStatus,
        isCheckingBackend,
        refreshModelStatuses,
        resetSession,
      },
    },
    children,
  );
}

export function useScreeningStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useScreeningStore must be used inside StoreProvider");
  return ctx;
}
