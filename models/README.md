# Trained Machine Learning Models Directory (`models/`)

Place your trained Python Scikit-Learn / Joblib model artifacts (`.joblib`) in this directory.
The backend model loader (`src/backend/services/modelLoader.ts`) automatically inspects this directory at runtime.

## Expected `.joblib` Model Files (10 Diseases)

| #   | Disease Model           | Expected Model File Path                                            | Optional Preprocessor / Scaler File   | API Endpoint                      |
| --- | ----------------------- | ------------------------------------------------------------------- | ------------------------------------- | --------------------------------- |
| 1   | **Heart Disease**       | `models/heart_disease_model.joblib`                                 | `models/heart_disease_scaler.joblib`  | `POST /api/predict/heart`         |
| 2   | **Diabetes**            | `models/diabetes_model.joblib`                                      | `models/diabetes_scaler.joblib`       | `POST /api/predict/diabetes`      |
| 3   | **Breast Cancer**       | `models/breast_cancer_model.joblib`                                 | `models/breast_cancer_scaler.joblib`  | `POST /api/predict/breast-cancer` |
| 4   | **Kidney Disease**      | `models/kidney_disease_model.joblib`                                | `models/kidney_disease_scaler.joblib` | `POST /api/predict/kidney`        |
| 5   | **Liver Disease**       | `models/liver_disease_model.joblib`                                 | `models/liver_disease_scaler.joblib`  | `POST /api/predict/liver`         |
| 6   | **Stroke**              | `models/stroke_model.joblib`                                        | `models/stroke_scaler.joblib`         | `POST /api/predict/stroke`        |
| 7   | **Parkinson's Disease** | `models/parkinsons_model.joblib`                                    | `models/parkinsons_scaler.joblib`     | `POST /api/predict/parkinsons`    |
| 8   | **Thyroid Disease**     | `models/thyroid_model.joblib` _(or `thyroid_disease_model.joblib`)_ | `models/thyroid_scaler.joblib`        | `POST /api/predict/thyroid`       |
| 9   | **Lung Cancer**         | `models/lung_cancer_model.joblib`                                   | `models/lung_cancer_scaler.joblib`    | `POST /api/predict/lung-cancer`   |
| 10  | **Alzheimer's Disease** | `models/alzheimers_model.joblib`                                    | `models/alzheimers_scaler.joblib`     | `POST /api/predict/alzheimers`    |

## Important Notes

- **No Dummy/Fake Predictions**: When a `.joblib` file is not present in `models/` (and no external `MODEL_SERVICE_URL` is configured), the backend reports `status: "unavailable"` for that model and never generates synthetic or fake predictions.
- **Exact Feature Order**: Each disease service in `src/backend/services/<disease>/index.ts` maps patient clinical inputs into the exact feature order expected by its corresponding trained model.
- **Frontend Isolation**: The React frontend never loads `.joblib` files directly; all inference requests go through `/api/analyze` and `/api/predict/:disease`.
