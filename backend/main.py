"""
Multi-Disease AI Health Screening — FastAPI Backend Server
Loads all 10 trained .joblib models from the models/ directory and exposes:
- GET  /
- GET  /health
- GET  /api/health
- GET  /models/status
- GET  /api/models/status
- POST /predict
- POST /api/predict
- POST /predict/{disease_key}
- POST /api/predict/{disease_key}
- POST /extract-report
- POST /api/extract-report
"""
import io
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import joblib
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Multi-Disease AI Backend",
    description="Backend for the Multi-Disease AI screening application",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exact 10 disease-to-model mapping
MODEL_MAPPING: Dict[str, str] = {
    "heart_disease": "heart_disease_model.joblib",
    "diabetes": "diabetes_model.joblib",
    "breast_cancer": "breast_cancer_model.joblib",
    "kidney_disease": "kidney_disease_model.joblib",
    "liver_disease": "liver_disease_model.joblib",
    "stroke": "stroke_disease_model.joblib",
    "parkinsons": "parkinsons_model.joblib",
    "thyroid": "thyroid_model.joblib",
    "lung_cancer": "lung_cancer_model.joblib",
    "alzheimers": "alzheimers_model.joblib",
}

ALTERNATE_FILENAMES: Dict[str, List[str]] = {
    "stroke": ["stroke_model.joblib"],
    "thyroid": ["thyroid_disease_model.joblib"],
}

DISEASE_DISPLAY_NAMES: Dict[str, str] = {
    "heart_disease": "Heart Disease",
    "diabetes": "Diabetes",
    "breast_cancer": "Breast Cancer",
    "kidney_disease": "Kidney Disease",
    "liver_disease": "Liver Disease",
    "stroke": "Stroke",
    "parkinsons": "Parkinson's Disease",
    "thyroid": "Thyroid Disease",
    "lung_cancer": "Lung Cancer",
    "alzheimers": "Alzheimer's Disease",
}

NEXT_STEPS_BY_DISEASE: Dict[str, str] = {
    "heart_disease": "Schedule a cardiology review, resting ECG, and fasting lipid panel.",
    "diabetes": "Confirm with fasting plasma glucose and HbA1c laboratory testing.",
    "breast_cancer": "Consult oncology or breast specialist for diagnostic imaging and biopsy review.",
    "kidney_disease": "Order a comprehensive renal panel (eGFR, serum creatinine, urine ACR).",
    "liver_disease": "Review hepatic function panel (ALT, AST, ALP, bilirubin) with a physician.",
    "stroke": "Monitor blood pressure and glycemic control; seek neurological assessment if symptomatic.",
    "parkinsons": "Consult a neurologist for comprehensive motor and phonatory neurological evaluation.",
    "thyroid": "Review thyroid panel (TSH, Free T3, Free T4) with an endocrinologist or primary care physician.",
    "lung_cancer": "Discuss pulmonary symptoms and low-dose chest CT screening with a pulmonologist.",
    "alzheimers": "Schedule a comprehensive cognitive and neurological evaluation with a specialist.",
}

LOADED_MODELS: Dict[str, Any] = {}
LOADED_SCALERS: Dict[str, Any] = {}
MODEL_PATHS_USED: Dict[str, str] = {}
MODEL_LOAD_ERRORS: Dict[str, str] = {}


def get_search_dirs() -> List[Path]:
    base_dir = Path(__file__).resolve().parent
    candidates = [
        Path(os.environ["MODEL_PATH"]).resolve() if os.environ.get("MODEL_PATH") else None,
        base_dir / "models",
        base_dir.parent / "models",
        Path.cwd() / "models",
        Path.cwd() / "backend" / "models",
    ]
    seen = []
    for c in candidates:
        if c and c not in seen:
            seen.append(c)
    return seen


def load_all_models() -> None:
    LOADED_MODELS.clear()
    LOADED_SCALERS.clear()
    MODEL_PATHS_USED.clear()
    MODEL_LOAD_ERRORS.clear()
    search_dirs = get_search_dirs()

    for disease_key, filename in MODEL_MAPPING.items():
        filenames_to_try = [filename] + ALTERNATE_FILENAMES.get(disease_key, [])
        found_path: Optional[Path] = None
        for d in search_dirs:
            for fname in filenames_to_try:
                candidate = d / fname
                if candidate.is_file() and candidate.stat().st_size > 0:
                    found_path = candidate
                    break
            if found_path:
                break

        if not found_path:
            MODEL_LOAD_ERRORS[disease_key] = f"File '{filename}' not found in {[str(d) for d in search_dirs]}"
            continue

        try:
            LOADED_MODELS[disease_key] = joblib.load(found_path)
            MODEL_PATHS_USED[disease_key] = str(found_path)
            scaler_name = filename.replace("_model.joblib", "_scaler.joblib")
            scaler_path = found_path.parent / scaler_name
            if scaler_path.is_file():
                LOADED_SCALERS[disease_key] = joblib.load(scaler_path)
        except Exception as exc:
            MODEL_LOAD_ERRORS[disease_key] = str(exc)


@app.on_event("startup")
def on_startup() -> None:
    load_all_models()


def safe_float(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    try:
        n = float(val)
        return n if np.isfinite(n) else None
    except (ValueError, TypeError):
        return None


def normalize_payload(body: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    for section in ("history", "medical_history", "labs", "basic", "patient"):
        sub = body.get(section)
        if isinstance(sub, dict):
            merged.update(sub)
    merged.update(body)

    # Parse blood pressure string like "130/85" if present
    bp_raw = merged.get("blood_pressure") or merged.get("bp")
    if isinstance(bp_raw, str) and "/" in bp_raw:
        parts = bp_raw.split("/")
        if len(parts) == 2:
            s = safe_float(parts[0].strip())
            d = safe_float(parts[1].strip())
            if s and not merged.get("systolic_bp"):
                merged["systolic_bp"] = s
            if d and not merged.get("diastolic_bp"):
                merged["diastolic_bp"] = d

    return merged


def extract_features_for_disease(
    disease_key: str, data: Dict[str, Any]
) -> Tuple[Optional[List[float]], List[str], List[str], Dict[str, Any]]:
    """
    Returns (feature_vector, feature_names, missing_features, inputs_used)
    """
    age = safe_float(data.get("age") or data.get("Age") or data.get("AGE"))
    sex_raw = str(data.get("sex") or data.get("Sex") or data.get("gender") or data.get("Gender") or data.get("GENDER") or "").strip()
    is_male = 1.0 if sex_raw.lower().startswith("m") else (0.0 if sex_raw.lower().startswith("f") else None)

    height = safe_float(data.get("height") or data.get("Height"))
    weight = safe_float(data.get("weight") or data.get("Weight"))
    bmi = safe_float(data.get("bmi") or data.get("BMI"))
    if bmi is None and height and weight and height > 40:
        bmi = round(weight / ((height / 100.0) ** 2), 1)

    sys_bp = safe_float(data.get("systolic_bp") or data.get("RestingBP") or data.get("SystolicBP") or data.get("bp"))
    dia_bp = safe_float(data.get("diastolic_bp") or data.get("BloodPressure") or data.get("DiastolicBP") or data.get("bp") or sys_bp)
    hr = safe_float(data.get("heart_rate") or data.get("MaxHR")) or 76.0
    glucose = safe_float(data.get("glucose") or data.get("Glucose") or data.get("avg_glucose_level") or data.get("bgr"))
    chol = safe_float(data.get("cholesterol") or data.get("Cholesterol") or data.get("CholesterolTotal"))

    if disease_key == "heart_disease":
        missing = []
        if age is None:
            missing.append("Age")
        if is_male is None:
            missing.append("Sex")
        if sys_bp is None:
            missing.append("Blood Pressure")
        if chol is None:
            missing.append("Cholesterol")
        names = ["Age", "Sex", "ChestPainType", "RestingBP", "Cholesterol", "FastingBS", "RestingECG", "MaxHR", "ExerciseAngina", "Oldpeak", "ST_Slope"]
        if missing:
            return None, names, missing, {}
        fasting_bs = 1.0 if (glucose is not None and glucose > 120) else 0.0
        vec = [age, is_male, 3.0, sys_bp, chol, fasting_bs, 0.0, hr, 0.0, 0.0, 1.0]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "diabetes":
        missing = []
        if age is None:
            missing.append("Age")
        if glucose is None:
            missing.append("Blood Glucose")
        if dia_bp is None:
            missing.append("Blood Pressure")
        if bmi is None:
            missing.append("BMI")
        names = ["Pregnancies", "Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI", "DiabetesPedigreeFunction", "Age"]
        if missing:
            return None, names, missing, {}
        preg = safe_float(data.get("Pregnancies") or data.get("pregnancies")) or 0.0
        skin = safe_float(data.get("SkinThickness") or data.get("skin_thickness")) or 20.0
        insulin = safe_float(data.get("Insulin") or data.get("insulin")) or 80.0
        dpf = safe_float(data.get("DiabetesPedigreeFunction") or data.get("pedigree")) or 0.45
        vec = [preg, glucose, dia_bp, skin, insulin, bmi, dpf, age]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "breast_cancer":
        names = [
            "radius_mean", "texture_mean", "perimeter_mean", "area_mean",
            "smoothness_mean", "compactness_mean", "concavity_mean",
            "concave_points_mean", "symmetry_mean", "fractal_dimension_mean"
        ]
        r_m = safe_float(data.get("radius_mean"))
        t_m = safe_float(data.get("texture_mean"))
        p_m = safe_float(data.get("perimeter_mean"))
        a_m = safe_float(data.get("area_mean"))
        missing = []
        if r_m is None:
            missing.append("radius_mean")
        if t_m is None:
            missing.append("texture_mean")
        if p_m is None:
            missing.append("perimeter_mean")
        if a_m is None:
            missing.append("area_mean")
        if missing:
            return None, names, missing, {}
        vec = [
            r_m, t_m, p_m, a_m,
            safe_float(data.get("smoothness_mean")) or 0.096,
            safe_float(data.get("compactness_mean")) or 0.104,
            safe_float(data.get("concavity_mean")) or 0.088,
            safe_float(data.get("concave_points_mean")) or 0.048,
            safe_float(data.get("symmetry_mean")) or 0.181,
            safe_float(data.get("fractal_dimension_mean")) or 0.062,
        ]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "kidney_disease":
        names = ["age", "bp", "sg", "al", "su", "rbc", "bgr", "bu", "sc", "hemo", "htn", "dm"]
        bu = safe_float(data.get("urea") or data.get("bu"))
        sc = safe_float(data.get("creatinine") or data.get("sc"))
        missing = []
        if age is None:
            missing.append("Age")
        if dia_bp is None:
            missing.append("Blood Pressure")
        if bu is None:
            missing.append("Blood Urea")
        if sc is None:
            missing.append("Serum Creatinine")
        if missing:
            return None, names, missing, {}
        hemo = safe_float(data.get("hemoglobin") or data.get("hemo")) or 13.5
        htn = 1.0 if data.get("hypertension") else 0.0
        dm = 1.0 if data.get("diabetes") else 0.0
        vec = [age, dia_bp, 1.020, 0.0, 0.0, 1.0, glucose or 110.0, bu, sc, hemo, htn, dm]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "liver_disease":
        names = [
            "Age", "Gender", "Total_Bilirubin", "Direct_Bilirubin",
            "Alkaline_Phosphotase", "Alamine_Aminotransferase",
            "Aspartate_Aminotransferase", "Total_Protiens", "Albumin",
            "Albumin_and_Globulin_Ratio"
        ]
        tb = safe_float(data.get("total_bilirubin") or data.get("Total_Bilirubin"))
        alp = safe_float(data.get("alkaline_phosphotase") or data.get("Alkaline_Phosphotase"))
        alt = safe_float(data.get("sgpt") or data.get("Alamine_Aminotransferase"))
        ast = safe_float(data.get("sgot") or data.get("Aspartate_Aminotransferase"))
        alb = safe_float(data.get("albumin") or data.get("Albumin"))
        missing = []
        if age is None:
            missing.append("Age")
        if is_male is None:
            missing.append("Sex")
        if tb is None:
            missing.append("Total Bilirubin")
        if alp is None:
            missing.append("Alkaline Phosphatase")
        if alt is None:
            missing.append("SGPT / ALT")
        if ast is None:
            missing.append("SGOT / AST")
        if alb is None:
            missing.append("Albumin")
        if missing:
            return None, names, missing, {}
        vec = [
            age, is_male, tb,
            safe_float(data.get("direct_bilirubin")) or 0.4,
            alp, alt, ast,
            safe_float(data.get("total_proteins")) or 6.8,
            alb,
            safe_float(data.get("ag_ratio")) or 1.0,
        ]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "stroke":
        names = ["gender", "age", "hypertension", "heart_disease", "ever_married", "work_type", "Residence_type", "avg_glucose_level", "bmi", "smoking_status"]
        missing = []
        if is_male is None:
            missing.append("Sex")
        if age is None:
            missing.append("Age")
        if glucose is None:
            missing.append("Blood Glucose")
        if bmi is None:
            missing.append("BMI")
        if missing:
            return None, names, missing, {}
        htn = 1.0 if data.get("hypertension") else 0.0
        hd = 1.0 if data.get("heart_disease") else 0.0
        smk = 3.0 if data.get("smoking") else 2.0
        vec = [is_male, age, htn, hd, 1.0, 2.0, 1.0, glucose, bmi, smk]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "parkinsons":
        names = ["MDVP_Fo_Hz", "MDVP_Fhi_Hz", "MDVP_Flo_Hz", "MDVP_Jitter_Percent", "MDVP_Shimmer", "NHR", "HNR", "RPDE", "DFA", "PPE"]
        fo = safe_float(data.get("MDVP_Fo_Hz"))
        jit = safe_float(data.get("MDVP_Jitter_Percent"))
        shim = safe_float(data.get("MDVP_Shimmer"))
        hnr = safe_float(data.get("HNR"))
        missing = []
        if fo is None:
            missing.append("MDVP_Fo_Hz")
        if jit is None:
            missing.append("MDVP_Jitter_Percent")
        if shim is None:
            missing.append("MDVP_Shimmer")
        if hnr is None:
            missing.append("HNR")
        if missing:
            return None, names, missing, {}
        vec = [fo, 200.0, 110.0, jit, shim, 0.024, hnr, 0.49, 0.71, 0.20]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "thyroid":
        names = ["age", "sex", "on_thyroxine", "query_on_thyroxine", "on_antithyroid_medication", "sick", "pregnant", "thyroid_surgery", "TSH", "T3", "TT4", "T4U", "FTI"]
        tsh = safe_float(data.get("tsh") or data.get("TSH"))
        missing = []
        if age is None:
            missing.append("Age")
        if is_male is None:
            missing.append("Sex")
        if tsh is None:
            missing.append("TSH")
        if missing:
            return None, names, missing, {}
        t3 = safe_float(data.get("t3") or data.get("T3")) or 2.0
        tt4 = safe_float(data.get("tt4") or data.get("TT4")) or 105.0
        vec = [age, is_male, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, tsh, t3, tt4, 0.99, 110.0]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "lung_cancer":
        names = [
            "GENDER", "AGE", "SMOKING", "YELLOW_FINGERS", "ANXIETY",
            "PEER_PRESSURE", "CHRONIC_DISEASE", "FATIGUE", "ALLERGY",
            "WHEEZING", "ALCOHOL_CONSUMING", "COUGHING",
            "SHORTNESS_OF_BREATH", "SWALLOWING_DIFFICULTY", "CHEST_PAIN"
        ]
        missing = []
        if is_male is None:
            missing.append("Sex")
        if age is None:
            missing.append("Age")
        if missing:
            return None, names, missing, {}
        syms = [str(s).lower() for s in (data.get("symptoms") or [])]
        vec = [
            is_male,
            age,
            1.0 if data.get("smoking") else 0.0,
            1.0 if "yellow fingers" in syms else 0.0,
            1.0 if "anxiety" in syms else 0.0,
            0.0,
            0.0,
            1.0 if "fatigue" in syms else 0.0,
            1.0 if "allergy" in syms else 0.0,
            1.0 if "wheezing" in syms else 0.0,
            1.0 if data.get("alcohol") else 0.0,
            1.0 if "cough" in syms else 0.0,
            1.0 if "shortness of breath" in syms else 0.0,
            1.0 if "difficulty swallowing" in syms else 0.0,
            1.0 if "chest pain" in syms else 0.0,
        ]
        return vec, names, [], dict(zip(names, vec))

    if disease_key == "alzheimers":
        names = [
            "Age", "Gender", "EducationLevel", "BMI", "Smoking",
            "AlcoholConsumption", "PhysicalActivity", "DietQuality",
            "SleepQuality", "FamilyHistoryAlzheimers", "CardiovascularDisease",
            "Diabetes", "Hypertension", "SystolicBP", "DiastolicBP",
            "CholesterolTotal", "MMSE", "FunctionalAssessment", "MemoryComplaints"
        ]
        mmse = safe_float(data.get("MMSE") or data.get("mmse"))
        missing = []
        if age is None:
            missing.append("Age")
        if is_male is None:
            missing.append("Sex")
        if bmi is None:
            missing.append("BMI")
        if mmse is None:
            missing.append("MMSE")
        if missing:
            return None, names, missing, {}
        syms = [str(s).lower() for s in (data.get("symptoms") or [])]
        vec = [
            age,
            0.0 if is_male == 1.0 else 1.0,
            2.0,
            bmi,
            1.0 if data.get("smoking") else 0.0,
            2.0 if data.get("alcohol") else 0.0,
            4.0,
            6.0,
            7.0,
            1.0 if data.get("family_history") else 0.0,
            1.0 if data.get("heart_disease") else 0.0,
            1.0 if data.get("diabetes") else 0.0,
            1.0 if data.get("hypertension") else 0.0,
            sys_bp or 120.0,
            dia_bp or 80.0,
            chol or 190.0,
            mmse,
            safe_float(data.get("FunctionalAssessment")) or 8.0,
            1.0 if "memory problems" in syms else 0.0,
        ]
        return vec, names, [], dict(zip(names, vec))

    return None, [], ["Unknown disease key"], {}


def run_single_model(disease_key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    display_name = DISEASE_DISPLAY_NAMES.get(disease_key, disease_key)
    model_file = MODEL_MAPPING.get(disease_key, f"{disease_key}_model.joblib")
    next_step = NEXT_STEPS_BY_DISEASE.get(
        disease_key, "Discuss these screening findings with a qualified physician."
    )

    vec, feature_names, missing, inputs_used = extract_features_for_disease(disease_key, data)
    if missing or vec is None:
        return {
            "disease": display_name,
            "disease_id": disease_key,
            "status": "insufficient_data",
            "prediction": "Insufficient data for this model",
            "probability": None,
            "confidence": None,
            "risk_category": "Insufficient Data",
            "missing_features": missing,
            "top_features": [],
            "explanation": f"Insufficient data for this model. Missing required features: {', '.join(missing)}.",
            "recommended_next_step": f"Provide {', '.join(missing)} to enable {display_name} prediction.",
            "inputs_used": inputs_used,
            "model_file": f"models/{model_file}",
        }

    model = LOADED_MODELS.get(disease_key)
    if model is None:
        return {
            "disease": display_name,
            "disease_id": disease_key,
            "status": "unavailable",
            "prediction": "Model artifact not loaded on backend",
            "probability": None,
            "confidence": None,
            "risk_category": "Unavailable",
            "missing_features": [],
            "top_features": [],
            "explanation": f"Model file 'models/{model_file}' is not loaded on the backend server ({MODEL_LOAD_ERRORS.get(disease_key, 'missing artifact')}).",
            "recommended_next_step": next_step,
            "inputs_used": inputs_used,
            "model_file": f"models/{model_file}",
        }

    try:
        X = np.array([vec], dtype=float)
        scaler = LOADED_SCALERS.get(disease_key)
        if scaler is not None and hasattr(scaler, "transform"):
            X = scaler.transform(X)

        pred = model.predict(X)[0]
        pred_str = str(pred)

        prob_val: Optional[float] = None
        conf_val: Optional[float] = None
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba(X)[0]
            if len(probs) >= 2:
                prob_val = float(probs[1])
                conf_val = float(max(probs))
            elif len(probs) == 1:
                prob_val = float(probs[0])
                conf_val = float(probs[0])

        is_positive = pred_str.lower() in ("1", "true", "malignant", "positive", "ckd", "yes")
        if prob_val is not None:
            if prob_val >= 0.65:
                risk_cat = "High Risk"
            elif prob_val >= 0.35:
                risk_cat = "Moderate Risk"
            else:
                risk_cat = "Low Risk"
        else:
            risk_cat = "High Risk" if is_positive else "Low Risk"

        top_features = []
        if hasattr(model, "feature_importances_") and len(model.feature_importances_) == len(feature_names):
            paired = sorted(
                zip(feature_names, [float(v) for v in model.feature_importances_]),
                key=lambda x: abs(x[1]),
                reverse=True,
            )[:5]
            top_features = [{"name": k, "importance": round(v, 4)} for k, v in paired]

        pct_text = f"{prob_val * 100:.2f}%" if prob_val is not None else "N/A"
        return {
            "disease": display_name,
            "disease_id": disease_key,
            "status": "available",
            "prediction": "Elevated Risk Detected" if (is_positive or risk_cat == "High Risk") else ("Moderate Risk Indicators" if risk_cat == "Moderate Risk" else "Low Risk / Within Baseline"),
            "predicted_class": pred_str,
            "probability": round(prob_val, 4) if prob_val is not None else None,
            "confidence": round(conf_val, 4) if conf_val is not None else None,
            "risk_category": risk_cat,
            "missing_features": [],
            "top_features": top_features,
            "explanation": f"Trained model ({model_file}) evaluated {len(feature_names)} clinical features and returned {risk_cat} (Probability: {pct_text}).",
            "recommended_next_step": next_step,
            "inputs_used": inputs_used,
            "model_file": f"models/{model_file}",
        }
    except Exception as exc:
        return {
            "disease": display_name,
            "disease_id": disease_key,
            "status": "error",
            "prediction": "Prediction execution error",
            "probability": None,
            "confidence": None,
            "risk_category": "Unavailable",
            "missing_features": [],
            "top_features": [],
            "explanation": f"Error executing {model_file}: {str(exc)}",
            "recommended_next_step": next_step,
            "inputs_used": inputs_used,
            "model_file": f"models/{model_file}",
        }


@app.get("/")
def home() -> Dict[str, Any]:
    return {
        "message": "Multi-Disease AI Backend is running",
        "status": "online",
        "models_loaded": len(LOADED_MODELS),
        "total_models": len(MODEL_MAPPING),
        "loaded_models": list(LOADED_MODELS.keys()),
    }


@app.get("/health")
@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "backend": "online",
        "models_loaded": len(LOADED_MODELS),
        "total_models": len(MODEL_MAPPING),
        "loaded_models": list(LOADED_MODELS.keys()),
        "models": {k: (k in LOADED_MODELS) for k in MODEL_MAPPING},
        "model_files": MODEL_MAPPING,
        "errors": MODEL_LOAD_ERRORS,
    }


@app.get("/models/status")
@app.get("/api/models/status")
def model_status() -> Dict[str, Any]:
    return {k: (k in LOADED_MODELS) for k in MODEL_MAPPING}


@app.post("/predict")
@app.post("/api/predict")
@app.post("/api/analyze")
def predict_all(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_payload(payload)
    results = []
    predictions_map = {}
    for disease_key in MODEL_MAPPING:
        res = run_single_model(disease_key, normalized)
        results.append(res)
        predictions_map[disease_key] = res

    return {
        "success": True,
        "models_loaded": len(LOADED_MODELS),
        "total_models": len(MODEL_MAPPING),
        "predictions": predictions_map,
        "results": results,
    }


@app.post("/predict/{disease_key}")
@app.post("/api/predict/{disease_key}")
def predict_single(disease_key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    key = disease_key.lower().replace("-", "_")
    alias_map = {
        "heart": "heart_disease",
        "kidney": "kidney_disease",
        "liver": "liver_disease",
    }
    key = alias_map.get(key, key)
    if key not in MODEL_MAPPING:
        raise HTTPException(status_code=404, detail=f"Unknown disease model '{disease_key}'")
    normalized = normalize_payload(payload)
    return run_single_model(key, normalized)
