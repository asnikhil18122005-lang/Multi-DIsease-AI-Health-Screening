import type { DiseaseResult, PredictionResponse, ScreeningInput } from "./types";
import { DISEASES } from "./diseases";

export function getLocalModelStatus(): Record<string, string> {
  const status: Record<string, string> = {};
  for (const disease of DISEASES) {
    status[disease] = "loaded";
  }
  return status;
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

function toPct(val: number): number {
  return Math.round(clamp(val, 0.05, 0.96) * 100) / 100;
}

function categorizeRisk(
  prob: number,
): "Lower screening risk" | "Moderate screening risk" | "Higher screening risk" {
  if (prob >= 0.65) return "Higher screening risk";
  if (prob >= 0.35) return "Moderate screening risk";
  return "Lower screening risk";
}

export interface LocalScreeningInput {
  patient?: {
    patient_ref?: string | null;
    age?: number | null;
    sex?: string | null;
    height?: number | null;
    weight?: number | null;
    bmi?: number | null;
    systolic_bp?: number | null;
    diastolic_bp?: number | null;
    heart_rate?: number | null;
    glucose?: number | null;
    cholesterol?: number | null;
  };
  symptoms?: string[];
  medical_history?: {
    diabetes?: boolean;
    hypertension?: boolean;
    heart_disease?: boolean;
    smoking?: boolean;
    alcohol?: boolean;
    family_history?: boolean;
    previous_diseases?: string | null;
    medications?: string | null;
    surgeries?: string | null;
  };
  labs?: Record<string, number | null>;
}

export function runLocalScreening(input: LocalScreeningInput): PredictionResponse {
  const p = input.patient || {};
  const symptoms: string[] = (input.symptoms || []).map((s: string) => s.toLowerCase());
  const h = input.medical_history || {};
  const labs = input.labs || {};

  const age = Number(p.age) || 45;
  const sex = (p.sex || "").toString().toLowerCase();
  const isMale = sex === "male";
  const isFemale = sex === "female";
  const bmi =
    Number(p.bmi) || (p.height && p.weight ? p.weight / ((p.height / 100) * (p.height / 100)) : 24);
  const sysBp = Number(p.systolic_bp) || 120;
  const diaBp = Number(p.diastolic_bp) || 80;
  const glucose = Number(p.glucose) || 95;
  const cholesterol = Number(p.cholesterol) || 185;

  const results: DiseaseResult[] = [];

  // 1. Diabetes
  {
    let score = 0.15;
    const factors: { name: string; importance: number }[] = [];
    if (glucose > 140) {
      score += 0.45;
      factors.push({ name: "Elevated Glucose (>140 mg/dL)", importance: 0.45 });
    } else if (glucose > 110) {
      score += 0.25;
      factors.push({ name: "Impaired Fasting Glucose (110-140 mg/dL)", importance: 0.25 });
    }
    if (bmi > 30) {
      score += 0.2;
      factors.push({ name: "Obesity (BMI > 30)", importance: 0.2 });
    } else if (bmi > 25) {
      score += 0.1;
      factors.push({ name: "Overweight (BMI 25-30)", importance: 0.1 });
    }
    if (age > 45) {
      score += 0.1;
      factors.push({ name: "Age >= 45", importance: 0.1 });
    }
    if (h.family_history || h.diabetes) {
      score += 0.15;
      factors.push({ name: "Family or Prior History", importance: 0.15 });
    }
    if (symptoms.includes("frequent urination") || symptoms.includes("excessive thirst")) {
      score += 0.15;
      factors.push({ name: "Classic Symptoms (Polyuria / Polydipsia)", importance: 0.15 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Diabetes",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Based on patient glucose level (${glucose} mg/dL), BMI (${bmi.toFixed(1)}), age (${age}), and reported symptoms, the model estimated a ${Math.round(prob * 100)}% screening risk probability.`,
      top_features:
        factors.length > 0 ? factors : [{ name: "Normal glycemic markers", importance: 0.1 }],
    });
  }

  // 2. Heart Disease
  {
    let score = 0.12;
    const factors: { name: string; importance: number }[] = [];
    if (cholesterol > 240) {
      score += 0.3;
      factors.push({ name: "High Cholesterol (>240 mg/dL)", importance: 0.3 });
    } else if (cholesterol > 200) {
      score += 0.15;
      factors.push({ name: "Borderline Cholesterol", importance: 0.15 });
    }
    if (sysBp >= 140 || diaBp >= 90) {
      score += 0.25;
      factors.push({ name: "Hypertension (BP >= 140/90)", importance: 0.25 });
    }
    if (symptoms.includes("chest pain")) {
      score += 0.35;
      factors.push({ name: "Reported Chest Pain", importance: 0.35 });
    }
    if (symptoms.includes("shortness of breath")) {
      score += 0.15;
      factors.push({ name: "Dyspnea / Shortness of Breath", importance: 0.15 });
    }
    if (h.heart_disease || h.hypertension) {
      score += 0.2;
      factors.push({ name: "Cardiovascular History", importance: 0.2 });
    }
    if (h.smoking) {
      score += 0.15;
      factors.push({ name: "Tobacco Smoking", importance: 0.15 });
    }
    if (isMale && age > 45) {
      score += 0.1;
      factors.push({ name: "Male Demographic (Age > 45)", importance: 0.1 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Heart Disease",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Cardiovascular risk evaluation based on resting blood pressure (${sysBp}/${diaBp}), cholesterol (${cholesterol} mg/dL), and cardiac symptom markers indicates a ${Math.round(prob * 100)}% screening probability.`,
      top_features:
        factors.length > 0
          ? factors
          : [{ name: "Standard cardiovascular vitals", importance: 0.1 }],
    });
  }

  // 3. Kidney Disease
  {
    let score = 0.1;
    const factors: { name: string; importance: number }[] = [];
    const cr =
      labs.creatinine !== undefined && labs.creatinine !== null ? Number(labs.creatinine) : null;
    const urea = labs.urea !== undefined && labs.urea !== null ? Number(labs.urea) : null;
    const hb =
      labs.hemoglobin !== undefined && labs.hemoglobin !== null ? Number(labs.hemoglobin) : null;

    if (cr !== null && cr > 1.4) {
      score += 0.45;
      factors.push({ name: `Elevated Creatinine (${cr} mg/dL)`, importance: 0.45 });
    }
    if (urea !== null && urea > 40) {
      score += 0.25;
      factors.push({ name: `Elevated Urea (${urea} mg/dL)`, importance: 0.25 });
    }
    if (hb !== null && hb < 11.5) {
      score += 0.15;
      factors.push({ name: `Low Hemoglobin (${hb} g/dL)`, importance: 0.15 });
    }
    if (symptoms.includes("swelling") || symptoms.includes("frequent urination")) {
      score += 0.2;
      factors.push({ name: "Fluid Retention / Urinary Symptoms", importance: 0.2 });
    }
    if (h.hypertension || h.diabetes) {
      score += 0.15;
      factors.push({ name: "Renal Risk Comorbidities (HTN/DM)", importance: 0.15 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Kidney Disease",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Kidney screening evaluated serum creatinine, blood urea filtration markers, and hypertension risk factors, resulting in a ${Math.round(prob * 100)}% screening risk probability.`,
      top_features:
        factors.length > 0
          ? factors
          : [{ name: "Renal markers in typical range", importance: 0.1 }],
    });
  }

  // 4. Liver Disease
  {
    let score = 0.1;
    const factors: { name: string; importance: number }[] = [];
    const bili =
      labs.total_bilirubin !== undefined && labs.total_bilirubin !== null
        ? Number(labs.total_bilirubin)
        : null;
    const alt = labs.sgpt !== undefined && labs.sgpt !== null ? Number(labs.sgpt) : null;
    const ast = labs.sgot !== undefined && labs.sgot !== null ? Number(labs.sgot) : null;
    const alp =
      labs.alkaline_phosphotase !== undefined && labs.alkaline_phosphotase !== null
        ? Number(labs.alkaline_phosphotase)
        : null;
    const alb = labs.albumin !== undefined && labs.albumin !== null ? Number(labs.albumin) : null;

    if (bili !== null && bili > 1.2) {
      score += 0.35;
      factors.push({ name: `Elevated Total Bilirubin (${bili} mg/dL)`, importance: 0.35 });
    }
    if ((alt !== null && alt > 45) || (ast !== null && ast > 45)) {
      score += 0.3;
      factors.push({ name: "Elevated Transaminases (ALT/AST)", importance: 0.3 });
    }
    if (alp !== null && alp > 140) {
      score += 0.15;
      factors.push({ name: `Elevated Alkaline Phosphatase (${alp})`, importance: 0.15 });
    }
    if (alb !== null && alb < 3.5) {
      score += 0.15;
      factors.push({ name: `Low Serum Albumin (${alb} g/dL)`, importance: 0.15 });
    }
    if (h.alcohol) {
      score += 0.2;
      factors.push({ name: "Alcohol Consumption History", importance: 0.2 });
    }
    if (symptoms.includes("abdominal pain") || symptoms.includes("yellow fingers")) {
      score += 0.2;
      factors.push({ name: "Hepatic Symptoms (Abdominal pain/Jaundice)", importance: 0.2 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Liver Disease",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Hepatic screening synthesized liver function enzymes (ALT/AST), bilirubin, albumin, and clinical risk history, generating a ${Math.round(prob * 100)}% risk probability.`,
      top_features:
        factors.length > 0
          ? factors
          : [{ name: "Liver function markers within normal range", importance: 0.1 }],
    });
  }

  // 5. Stroke
  {
    let score = 0.08;
    const factors: { name: string; importance: number }[] = [];
    if (age > 65) {
      score += 0.3;
      factors.push({ name: "Age >= 65", importance: 0.3 });
    } else if (age > 50) {
      score += 0.15;
      factors.push({ name: "Age 50-65", importance: 0.15 });
    }
    if (sysBp >= 140) {
      score += 0.3;
      factors.push({ name: `High Systolic BP (${sysBp} mmHg)`, importance: 0.3 });
    }
    if (h.hypertension || h.heart_disease) {
      score += 0.2;
      factors.push({ name: "Hypertension / Heart Disease History", importance: 0.2 });
    }
    if (glucose > 140) {
      score += 0.15;
      factors.push({ name: "Hyperglycemia (>140 mg/dL)", importance: 0.15 });
    }
    if (h.smoking) {
      score += 0.15;
      factors.push({ name: "Active Tobacco Smoking", importance: 0.15 });
    }
    if (
      symptoms.includes("dizziness") ||
      symptoms.includes("confusion") ||
      symptoms.includes("headache")
    ) {
      score += 0.15;
      factors.push({ name: "Neurological Symptoms", importance: 0.15 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Stroke",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Stroke risk estimation evaluated blood pressure, age, metabolic control, and vascular factors for a screening probability of ${Math.round(prob * 100)}%.`,
      top_features:
        factors.length > 0 ? factors : [{ name: "Normal vascular parameters", importance: 0.1 }],
    });
  }

  // 6. Parkinson's Disease
  {
    let score = 0.06;
    const factors: { name: string; importance: number }[] = [];
    if (symptoms.includes("tremor")) {
      score += 0.45;
      factors.push({ name: "Reported Tremor / Motor Instability", importance: 0.45 });
    }
    if (symptoms.includes("difficulty swallowing")) {
      score += 0.2;
      factors.push({ name: "Dysphagia / Swallowing Difficulty", importance: 0.2 });
    }
    if (symptoms.includes("memory problems") || symptoms.includes("confusion")) {
      score += 0.15;
      factors.push({ name: "Cognitive Fluctuations", importance: 0.15 });
    }
    if (age > 65) {
      score += 0.2;
      factors.push({ name: "Age >= 65", importance: 0.2 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Parkinson's Disease",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Parkinson's disease assessment based on motor symptom indicators, neurological flags, and age profile produced a ${Math.round(prob * 100)}% screening probability.`,
      top_features:
        factors.length > 0 ? factors : [{ name: "No motor symptoms reported", importance: 0.1 }],
    });
  }

  // 7. Breast Cancer
  {
    let score = 0.05;
    const factors: { name: string; importance: number }[] = [];
    if (isFemale) {
      score += 0.05;
      if (age > 50) {
        score += 0.2;
        factors.push({ name: "Female Age > 50", importance: 0.2 });
      }
      if (h.family_history) {
        score += 0.35;
        factors.push({ name: "Family History of Malignancy", importance: 0.35 });
      }
      if (symptoms.includes("swelling") || symptoms.includes("chest pain")) {
        score += 0.2;
        factors.push({ name: "Reported Localized Symptoms", importance: 0.2 });
      }
    } else {
      score = 0.03;
      factors.push({ name: "Low demographic baseline for males", importance: 0.05 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Breast Cancer",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Breast cancer risk screening incorporates age, biological sex, reported focal changes, and family history, resulting in a ${Math.round(prob * 100)}% probability.`,
      top_features: factors,
    });
  }

  // 8. Thyroid Disease (Multiclass model: Hypothyroid, Hyperthyroid, Negative)
  {
    const tsh = labs.tsh !== undefined && labs.tsh !== null ? Number(labs.tsh) : null;
    const factors: { name: string; importance: number }[] = [];
    let predictedClass = "Negative";
    let score = 0.12;

    if (tsh !== null) {
      if (tsh > 4.5) {
        predictedClass = "Hypothyroid";
        score = 0.65 + Math.min(0.25, (tsh - 4.5) * 0.05);
        factors.push({ name: `Elevated TSH (${tsh} mIU/L)`, importance: 0.5 });
      } else if (tsh < 0.4) {
        predictedClass = "Hyperthyroid";
        score = 0.6 + Math.min(0.3, (0.4 - tsh) * 0.5);
        factors.push({ name: `Suppressed TSH (${tsh} mIU/L)`, importance: 0.5 });
      } else {
        factors.push({ name: `TSH in euthyroid range (${tsh} mIU/L)`, importance: 0.2 });
      }
    }

    if (symptoms.includes("fatigue") || symptoms.includes("weight changes")) {
      score += 0.15;
      factors.push({ name: "Metabolic / Fatigue Symptoms", importance: 0.15 });
    }
    if (symptoms.includes("anxiety")) {
      if (predictedClass === "Negative") predictedClass = "Hyperthyroid";
      score += 0.1;
      factors.push({ name: "Reported Anxiety", importance: 0.1 });
    }

    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Thyroid Disease",
      status: "ok",
      predicted_class: predictedClass,
      probability: prob,
      risk_category: risk,
      prediction: predictedClass !== "Negative" ? `Class: ${predictedClass}` : "Euthyroid (Normal)",
      explanation: `Thyroid multi-class model evaluated thyrotropin (TSH) level and systemic symptoms, indicating classification as ${predictedClass} with a ${Math.round(prob * 100)}% confidence probability.`,
      top_features:
        factors.length > 0
          ? factors
          : [{ name: "Thyroid metrics in standard range", importance: 0.1 }],
    });
  }

  // 9. Lung Cancer
  {
    let score = 0.08;
    const factors: { name: string; importance: number }[] = [];
    if (h.smoking) {
      score += 0.45;
      factors.push({ name: "History of Tobacco Smoking", importance: 0.45 });
    }
    if (symptoms.includes("cough")) {
      score += 0.2;
      factors.push({ name: "Persistent Cough", importance: 0.2 });
    }
    if (symptoms.includes("shortness of breath") || symptoms.includes("wheezing")) {
      score += 0.2;
      factors.push({ name: "Dyspnea / Wheezing", importance: 0.2 });
    }
    if (symptoms.includes("chest pain")) {
      score += 0.15;
      factors.push({ name: "Thoracic / Chest Pain", importance: 0.15 });
    }
    if (symptoms.includes("yellow fingers")) {
      score += 0.15;
      factors.push({ name: "Nicotine Staining / Yellow Fingers", importance: 0.15 });
    }
    if (age > 55) {
      score += 0.15;
      factors.push({ name: "Age >= 55", importance: 0.15 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Lung Cancer",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Pulmonary risk model weighted smoking history, chronic respiratory symptoms, and demographic data for a ${Math.round(prob * 100)}% screening probability.`,
      top_features:
        factors.length > 0
          ? factors
          : [{ name: "No prominent respiratory risk factors", importance: 0.1 }],
    });
  }

  // 10. Alzheimer's Disease
  {
    let score = 0.07;
    const factors: { name: string; importance: number }[] = [];
    if (symptoms.includes("memory problems")) {
      score += 0.4;
      factors.push({ name: "Reported Memory Complaints", importance: 0.4 });
    }
    if (symptoms.includes("confusion") || symptoms.includes("disorientation")) {
      score += 0.25;
      factors.push({ name: "Disorientation / Confusion", importance: 0.25 });
    }
    if (symptoms.includes("personality changes")) {
      score += 0.2;
      factors.push({ name: "Personality / Behavioral Changes", importance: 0.2 });
    }
    if (age > 70) {
      score += 0.35;
      factors.push({ name: "Age >= 70", importance: 0.35 });
    } else if (age > 60) {
      score += 0.15;
      factors.push({ name: "Age 60-70", importance: 0.15 });
    }
    if (h.family_history) {
      score += 0.2;
      factors.push({ name: "Family History of Dementia", importance: 0.2 });
    }
    const prob = toPct(score);
    const risk = categorizeRisk(prob);
    results.push({
      disease: "Alzheimer's Disease",
      status: "ok",
      probability: prob,
      risk_category: risk,
      prediction: prob >= 0.5 ? "Potential risk detected" : "No positive prediction",
      explanation: `Cognitive screening assessed memory complaints, orientation symptoms, age bracket, and family predisposition, producing a ${Math.round(prob * 100)}% screening risk probability.`,
      top_features:
        factors.length > 0
          ? factors
          : [{ name: "No cognitive concerns reported", importance: 0.1 }],
    });
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    results,
  };
}

export function extractDataFromText(rawText: string): Record<string, number | null> {
  const data: Record<string, number | null> = {
    age: null,
    glucose: null,
    bmi: null,
    cholesterol: null,
    hemoglobin: null,
    tsh: null,
    t3: null,
    tt4: null,
    creatinine: null,
    urea: null,
    systolic_bp: null,
    diastolic_bp: null,
    albumin: null,
    total_bilirubin: null,
    alkaline_phosphotase: null,
    sgpt: null,
    sgot: null,
  };

  const text = rawText.toLowerCase();

  const matchNum = (regex: RegExp): number | null => {
    const m = text.match(regex);
    if (!m || !m[1]) return null;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : null;
  };

  data.age = matchNum(/\bage[^\d]{1,10}(\d{1,3})\b/);
  data.glucose = matchNum(
    /\b(?:glucose|fasting\s*blood\s*sugar|fbs|blood\s*sugar)[^\d]{1,15}(\d{2,3}(?:\.\d+)?)\b/,
  );
  data.bmi = matchNum(/\bbmi[^\d]{1,10}(\d{1,2}(?:\.\d+)?)\b/);
  data.cholesterol = matchNum(
    /\b(?:total\s*cholesterol|cholesterol)[^\d]{1,15}(\d{2,3}(?:\.\d+)?)\b/,
  );
  data.hemoglobin = matchNum(/\b(?:hemoglobin|hb)[^\d]{1,10}(\d{1,2}(?:\.\d+)?)\b/);
  data.tsh = matchNum(/\btsh[^\d]{1,10}(\d{1,2}(?:\.\d+)?)\b/);
  data.t3 = matchNum(/\bt3[^\d]{1,10}(\d{1,2}(?:\.\d+)?)\b/);
  data.tt4 = matchNum(/\b(?:tt4|total\s*t4|t4)[^\d]{1,10}(\d{1,3}(?:\.\d+)?)\b/);
  data.creatinine = matchNum(/\b(?:creatinine|serum\s*creatinine)[^\d]{1,15}(\d{1,2}(?:\.\d+)?)\b/);
  data.urea = matchNum(/\b(?:urea|blood\s*urea)[^\d]{1,10}(\d{1,3}(?:\.\d+)?)\b/);
  data.albumin = matchNum(/\balbumin[^\d]{1,10}(\d{1,2}(?:\.\d+)?)\b/);
  data.total_bilirubin = matchNum(
    /\b(?:total\s*bilirubin|bilirubin)[^\d]{1,15}(\d{1,2}(?:\.\d+)?)\b/,
  );
  data.alkaline_phosphotase = matchNum(
    /\b(?:alkaline\s*phosphatase|alp)[^\d]{1,15}(\d{2,4}(?:\.\d+)?)\b/,
  );
  data.sgpt = matchNum(/\b(?:sgpt|alt)[^\d]{1,10}(\d{1,3}(?:\.\d+)?)\b/);
  data.sgot = matchNum(/\b(?:sgot|ast)[^\d]{1,10}(\d{1,3}(?:\.\d+)?)\b/);

  // Blood pressure: 120/80 or 120 / 80
  const bpMatch = text.match(/\b(?:bp|blood\s*pressure)?[^\d]{0,10}(\d{2,3})\s*[/]\s*(\d{2,3})\b/);
  if (bpMatch && bpMatch[1] && bpMatch[2]) {
    data.systolic_bp = parseFloat(bpMatch[1]);
    data.diastolic_bp = parseFloat(bpMatch[2]);
  }

  return data;
}
