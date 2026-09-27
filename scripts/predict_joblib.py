#!/usr/bin/env python3
"""
Python Joblib Model Inference Bridge for Multi-Disease AI Health Screening.
Reads a JSON payload from stdin:
{
  "model_path": "/path/to/disease_model.joblib",
  "scaler_path": "/path/to/disease_scaler.joblib", # optional
  "features": [120, 28.5, 45, ...],
  "feature_names": ["Glucose", "BMI", "Age", ...]
}
Supports both binary Scikit-Learn .joblib pickle files and JSON-serialized trained .joblib artifacts.
"""

import sys
import json
import os
import math


def sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-min(z, 50.0))
        return 1.0 / (1.0 + ez)
    else:
        ez = math.exp(max(z, -50.0))
        return ez / (1.0 + ez)


def run_json_artifact_inference(model_doc: dict, scaler_doc: dict | None, features: list, feature_names: list) -> dict:
    coeffs = model_doc.get("coefficients", [])
    intercept = float(model_doc.get("intercept", 0.0))
    means = (
        scaler_doc.get("mean")
        if scaler_doc and "mean" in scaler_doc
        else model_doc.get("scaler_mean", [0.0] * len(coeffs))
    )
    scales = (
        scaler_doc.get("scale")
        if scaler_doc and "scale" in scaler_doc
        else model_doc.get("scaler_scale", [1.0] * len(coeffs))
    )

    logit = intercept
    impacts = []
    total_impact = 0.0

    for i, w in enumerate(coeffs):
        x = float(features[i]) if i < len(features) else 0.0
        mean_i = float(means[i]) if i < len(means) else 0.0
        scale_i = float(scales[i]) if i < len(scales) and float(scales[i]) > 1e-6 else 1.0
        z_i = (x - mean_i) / scale_i
        w_val = float(w)
        logit += w_val * z_i
        impact = abs(w_val * z_i) + 0.25 * abs(w_val)
        total_impact += impact
        fname = (
            feature_names[i]
            if i < len(feature_names)
            else (
                model_doc.get("feature_names", [])[i]
                if i < len(model_doc.get("feature_names", []))
                else f"Feature_{i + 1}"
            )
        )
        impacts.append({"name": fname, "raw_impact": impact})

    prob = sigmoid(logit)
    conf = max(prob, 1.0 - prob)

    if prob >= 0.65:
        risk_category = "High Risk"
        prediction_text = "High Risk — Elevated Clinical Indicators"
    elif prob >= 0.35:
        risk_category = "Moderate Risk"
        prediction_text = "Moderate Risk — Borderline Clinical Indicators"
    else:
        risk_category = "Low Risk"
        prediction_text = "Low Risk — Within Baseline Parameters"

    top_features = []
    if total_impact > 0:
        for item in sorted(impacts, key=lambda d: d["raw_impact"], reverse=True)[:5]:
            top_features.append(
                {
                    "name": item["name"],
                    "importance": round(item["raw_impact"] / total_impact, 4),
                }
            )

    return {
        "success": True,
        "predicted_class": "1" if prob >= 0.5 else "0",
        "prediction": prediction_text,
        "probability": round(prob, 4),
        "confidence": round(conf, 4),
        "risk_category": risk_category,
        "top_features": top_features,
    }


def main():
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            print(json.dumps({"success": False, "error": "Empty input payload"}))
            return

        payload = json.loads(raw_input)
        model_path = payload.get("model_path")
        scaler_path = payload.get("scaler_path")
        features = payload.get("features", [])
        feature_names = payload.get("feature_names", [])

        if not model_path or not os.path.exists(model_path):
            print(json.dumps({"success": False, "error": "Model file does not exist"}))
            return

        # 1. Check if the .joblib file is a JSON-serialized trained model artifact
        try:
            with open(model_path, "r", encoding="utf-8") as f:
                model_doc = json.load(f)
            if isinstance(model_doc, dict) and "coefficients" in model_doc:
                scaler_doc = None
                if scaler_path and os.path.exists(scaler_path):
                    try:
                        with open(scaler_path, "r", encoding="utf-8") as sf:
                            scaler_doc = json.load(sf)
                    except Exception:
                        scaler_doc = None
                res = run_json_artifact_inference(model_doc, scaler_doc, features, feature_names)
                print(json.dumps(res))
                return
        except Exception:
            pass

        # 2. Otherwise load binary Scikit-Learn .joblib pickle
        import joblib
        import numpy as np

        X = np.array([features], dtype=float)
        if scaler_path and os.path.exists(scaler_path):
            scaler = joblib.load(scaler_path)
            if hasattr(scaler, "transform"):
                X = scaler.transform(X)

        model = joblib.load(model_path)
        pred_class = model.predict(X)[0]

        probability = None
        confidence = None
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba(X)[0]
            if len(probs) >= 2:
                probability = float(probs[1])
                confidence = float(max(probs))
            elif len(probs) == 1:
                probability = float(probs[0])
                confidence = float(probs[0])

        is_positive = str(pred_class).lower() in ("1", "true", "yes", "positive", "ckd", "m", "malignant")
        if probability is None:
            probability = 0.80 if is_positive else 0.15
            confidence = 0.80

        if probability >= 0.65:
            risk_category = "High Risk"
            prediction_text = "High Risk — Elevated Clinical Indicators"
        elif probability >= 0.35:
            risk_category = "Moderate Risk"
            prediction_text = "Moderate Risk — Borderline Clinical Indicators"
        else:
            risk_category = "Low Risk"
            prediction_text = "Low Risk — Within Baseline Parameters"

        top_features = []
        importances = None
        if hasattr(model, "feature_importances_"):
            importances = model.feature_importances_
        elif hasattr(model, "coef_"):
            coef = model.coef_[0] if len(model.coef_.shape) > 1 else model.coef_
            importances = np.abs(coef)

        if importances is not None and len(importances) == len(features):
            total = float(np.sum(importances)) or 1.0
            pairs = []
            for idx, imp in enumerate(importances):
                name = feature_names[idx] if idx < len(feature_names) else f"Feature_{idx + 1}"
                pairs.append({"name": name, "importance": round(float(imp) / total, 4)})
            pairs.sort(key=lambda x: x["importance"], reverse=True)
            top_features = pairs[:5]

        print(
            json.dumps(
                {
                    "success": True,
                    "predicted_class": str(pred_class),
                    "prediction": prediction_text,
                    "probability": round(probability, 4),
                    "confidence": round(confidence, 4),
                    "risk_category": risk_category,
                    "top_features": top_features,
                }
            )
        )
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
