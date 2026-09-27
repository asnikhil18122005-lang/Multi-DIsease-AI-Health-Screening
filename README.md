# Health Compass AI

Build a complete, production-style full-stack web application called:

"Multi-Disease AI Health Screening & Risk Analysis"

IMPORTANT:

This is an AI screening/support application, NOT a medical diagnosis system.

Do not claim that predictions are medically definitive.

Clearly display: "For educational and screening support only. Consult a qualified healthcare professional for medical decisions."

I want a REAL WORKING APPLICATION, not a static UI, mock dashboard, or demo with fake predictions.

==================================================

1. APPLICATION FLOW

==================================================

PATIENT

↓

Patient Information

↓

┌───────────────────────────────┐

│ Basic Information │

│ Age │

│ Sex │

│ Height │

│ Weight │

│ BMI │

│ Blood pressure │

│ Glucose │

│ Cholesterol │

│ Other available vitals │

└───────────────┬───────────────┘

                 ↓

        Symptoms & Medical History

                 ↓

┌───────────────────────────────┐

│ Symptoms │

│ Fever │

│ Cough │

│ Fatigue │

│ Chest pain │

│ Shortness of breath │

│ Pain │

│ Memory problems │

│ Urination problems │

│ Other symptoms │

└───────────────┬───────────────┘

                 ↓

        OR / AND

                 ↓

       Upload Medical Report

       PDF / text document

                 ↓

      Extract available values

                 ↓

        AI Disease Screening

                 ↓

┌──────────────────────────────────────────┐

│ 10 trained machine-learning models │

└──────────────────────────────────────────┘

                 ↓

      Results + Probability + Risk

                 ↓

       Explanation + Next Steps

==================================================

2. 10 DISEASE MODELS

==================================================

Integrate these trained models:

1. Diabetes

2. Heart Disease

3. Kidney Disease

4. Liver Disease

5. Stroke

6. Parkinson's Disease

7. Breast Cancer

8. Thyroid Disease

9. Lung Cancer

10. Alzheimer's Disease

The application must have a separate prediction service/adapter for each model.

DO NOT replace the trained models with:

- fake predictions

- random predictions

- hard-coded results

- placeholder probabilities

- invented AI logic

The backend must actually load and use the trained model files.

The model files will be supplied separately.

Expected model files:

diabetes_model.joblib

heart_disease_model.joblib

kidney_disease_model.joblib

liver_disease_model.joblib

stroke_disease_model.joblib

parkinsons_model.joblib

breast_cancer_model.joblib

thyroid_model.joblib

lung_cancer_model.joblib

alzheimers_model.joblib

==================================================

3. RECOMMENDED ARCHITECTURE

==================================================

Frontend:

- React

- TypeScript

- Modern responsive UI

- Tailwind CSS

- Clean component architecture

- Mobile + desktop responsive

Backend:

- Python

- Flask or FastAPI

- scikit-learn

- pandas

- numpy

- joblib

- pypdf for PDF extraction

The frontend must communicate with the Python backend through REST API endpoints.

DO NOT run Python machine-learning models directly in the browser.

Architecture:

React Frontend

       ↓

REST API

       ↓

Python Backend

       ↓

Model Manager

       ↓

10 trained .joblib models

       ↓

Prediction results

==================================================

4. FRONTEND DESIGN

==================================================

Create a professional healthcare-style interface.

Design requirements:

- Modern medical AI dashboard

- Clean white/light background

- Blue/purple/teal healthcare color palette

- Rounded cards

- Soft shadows

- Clear typography

- Attractive icons

- Smooth animations

- Responsive design

- Mobile friendly

- Accessible form controls

Main navigation:

Dashboard

Screen Patient

Medical Report

Prediction Results

History

About

Settings

Landing page should contain:

"AI-Powered Multi-Disease Health Screening"

Subtitle:

"Analyze patient information and available medical reports using trained machine-learning models."

Buttons:

"Start Health Screening"

"Upload Medical Report"

Include a visible medical disclaimer.

==================================================

5. PATIENT FORM

==================================================

Create a multi-step patient form.

STEP 1 — Basic Information

Fields:

- Age

- Sex

- Height

- Weight

- BMI

- Blood pressure

- Heart rate

- Glucose

- Cholesterol

Automatically calculate BMI when height and weight are provided.

Allow users to manually edit BMI if required.

STEP 2 — Symptoms

Use a searchable multi-select symptom interface.

Include examples:

- Fever

- Cough

- Fatigue

- Chest pain

- Shortness of breath

- Headache

- Dizziness

- Memory problems

- Confusion

- Joint pain

- Abdominal pain

- Swelling

- Frequent urination

- Excessive thirst

- Weight changes

- Difficulty swallowing

Allow custom symptoms.

STEP 3 — Medical History

Include:

- Diabetes

- Hypertension

- Heart disease

- Smoking

- Alcohol consumption

- Family history

- Previous diseases

- Current medications

- Previous surgeries

STEP 4 — Medical Report

Allow:

- PDF upload

- TXT upload if supported

Show:

File name

File size

Upload progress

Extraction status

After upload, display extracted values in editable fields.

Example:

Age: 45

Glucose: 140

BMI: 28.5

Cholesterol: 190

Hemoglobin: 13.5

TSH: 2.4

Creatinine: 1.0

Urea: 30

Blood Pressure: 130/85

IMPORTANT:

Extracted values must be editable before prediction.

==================================================

6. MEDICAL REPORT PROCESSING

==================================================

Backend should extract text from PDF using pypdf.

Create an endpoint:

POST /api/extract-report

Input:

PDF file

Output:

{

"success": true,

"extracted_data": {

    "age": 45,

    "glucose": 140,

    "bmi": 28.5,

    "cholesterol": 190,

    "hemoglobin": 13.5,

    "tsh": 2.4,

    "creatinine": 1.0,

    "urea": 30,

    "systolic_bp": 130,

    "diastolic_bp": 85

}

}

Do not invent values when they are missing.

Missing values should remain null/unknown.

==================================================

7. MODEL MANAGEMENT

==================================================

Create a centralized model manager.

Example architecture:

backend/

    app.py

    model_manager.py

    prediction_service.py

    report_parser.py

    validators.py

    models/

        diabetes_model.joblib

        heart_disease_model.joblib

        kidney_disease_model.joblib

        liver_disease_model.joblib

        stroke_disease_model.joblib

        parkinsons_model.joblib

        breast_cancer_model.joblib

        thyroid_model.joblib

        lung_cancer_model.joblib

        alzheimers_model.joblib

Load models once when the backend starts.

Do NOT reload every model for every request.

Add error handling if a model file is missing.

Provide a model status endpoint:

GET /api/models/status

Return:

{

"Diabetes": "loaded",

"Heart Disease": "loaded",

"Kidney Disease": "loaded",

...

}

==================================================

8. PREDICTION API

==================================================

Create:

POST /api/predict

Input:

{

"patient": {

    "age": 45,

    "sex": "Male",

    "height": 170,

    "weight": 82,

    "bmi": 28.4,

    "glucose": 140,

    "blood_pressure": "130/85",

    "cholesterol": 190

},

"symptoms": [

    "fatigue",

    "cough"

],

"medical_history": {

    "diabetes": false,

    "hypertension": true,

    "smoking": false

}

}

The backend should transform the user input into the exact feature format required by each trained model.

IMPORTANT:

Each disease model may require different features.

Do NOT send the same generic feature vector to all models.

Create individual preprocessing/adapters for each model.

==================================================

9. MODEL FEATURE MAPPING

==================================================

Use the actual feature names expected by the trained models.

Diabetes:

Pregnancies

Glucose

BloodPressure

SkinThickness

Insulin

BMI

DiabetesPedigreeFunction

Age

Heart Disease:

Age

Sex

ChestPainType

RestingBP

Cholesterol

FastingBS

RestingECG

MaxHR

ExerciseAngina

Oldpeak

ST_Slope

Kidney Disease:

age

bp

sg

al

su

rbc

pc

pcc

ba

bgr

bu

sc

sod

pot

hemo

pcv

wc

rc

htn

dm

cad

appet

pe

ane

Liver Disease:

Age

Gender

Total_Bilirubin

Direct_Bilirubin

Alkaline_Phosphotase

Alamine_Aminotransferase

Aspartate_Aminotransferase

Total_Protiens

Albumin

Albumin_and_Globulin_Ratio

Stroke:

gender

age

hypertension

heart_disease

ever_married

work_type

Residence_type

avg_glucose_level

bmi

smoking_status

Parkinson's:

MDVP:Fo(Hz)

MDVP:Fhi(Hz)

MDVP:Flo(Hz)

MDVP:Jitter(%)

MDVP:Jitter(Abs)

MDVP:RAP

MDVP:PPQ

Jitter:DDP

MDVP:Shimmer

MDVP:Shimmer(dB)

Shimmer:APQ3

Shimmer:APQ5

MDVP:APQ

Shimmer:DDA

NHR

HNR

RPDE

DFA

spread1

spread2

D2

PPE

Breast Cancer:

radius_mean

texture_mean

perimeter_mean

area_mean

smoothness_mean

compactness_mean

concavity_mean

concave points_mean

symmetry_mean

fractal_dimension_mean

radius_se

texture_se

perimeter_se

area_se

smoothness_se

compactness_se

concavity_se

concave points_se

symmetry_se

fractal_dimension_se

radius_worst

texture_worst

perimeter_worst

area_worst

smoothness_worst

compactness_worst

concavity_worst

concave points_worst

symmetry_worst

fractal_dimension_worst

Alzheimer's:

Age

Gender

Ethnicity

EducationLevel

BMI

Smoking

AlcoholConsumption

PhysicalActivity

DietQuality

SleepQuality

FamilyHistoryAlzheimers

CardiovascularDisease

Diabetes

Depression

HeadInjury

Hypertension

SystolicBP

DiastolicBP

CholesterolTotal

CholesterolLDL

CholesterolHDL

CholesterolTriglycerides

MMSE

FunctionalAssessment

MemoryComplaints

BehavioralProblems

ADL

Confusion

Disorientation

PersonalityChanges

DifficultyCompletingTasks

Forgetfulness

Thyroid:

age

sex

on thyroxine

query on thyroxine

on antithyroid medication

sick

pregnant

thyroid surgery

I131 treatment

query hypothyroid

query hyperthyroid

lithium

goitre

tumor

hypopituitary

psych

TSH

T3

TT4

T4U

FTI

referral source

Lung Cancer:

GENDER

AGE

SMOKING

YELLOW_FINGERS

ANXIETY

PEER_PRESSURE

CHRONIC DISEASE

FATIGUE

ALLERGY

WHEEZING

ALCOHOL CONSUMING

COUGHING

SHORTNESS OF BREATH

SWALLOWING DIFFICULTY

CHEST PAIN

==================================================

10. PREDICTION RESULT

==================================================

After clicking:

"Run AI Screening"

show a loading screen:

"Analyzing patient information..."

"Running trained models..."

"Preparing screening report..."

Then display results.

For each disease:

Disease name

Prediction

Probability

Risk category

Example:

Diabetes

Potential risk detected

Probability: 72%

Risk category: Higher screening risk

Heart Disease

No positive prediction

Probability: 18%

Risk category: Lower screening risk

IMPORTANT:

For binary models, probability must correspond to the positive disease class.

Do not simply use the maximum probability.

For example, if model.classes_ contains [0,1], use the probability corresponding to class 1.

For multiclass models such as the thyroid model, show:

Predicted class

Predicted-class probability

Clearly label probabilities as model outputs, NOT medical certainty.

==================================================

11. RESULTS DASHBOARD

==================================================

Create a beautiful results dashboard.

Top section:

"AI Screening Results"

Patient summary card.

Then:

Overall screening summary

Disease cards in a responsive grid.

Each card should contain:

Disease

Prediction

Probability

Risk category

Model status

"View Details"

Use visual indicators such as:

Low screening risk

Moderate screening risk

Higher screening risk

Do NOT call these categories medical diagnoses.

Add charts:

- Probability bar chart

- Risk distribution

- Feature importance where available

Add:

"Download Screening Report"

Generate a professional PDF report containing:

Patient information

Input values

Extracted report values

Disease predictions

Model probabilities

Risk categories

Important disclaimer

Timestamp

==================================================

12. EXPLANATION

==================================================

For every prediction, provide a simple explanation.

Example:

"Based on the supplied input values, the trained model produced a positive prediction with a probability of 72%."

If feature importance is available, display the important model features.

Do NOT invent explanations that are not supported by the model.

==================================================

13. PREVENTION / NEXT STEPS

==================================================

Provide general educational next-step information.

Examples:

- Maintain a balanced diet

- Regular physical activity

- Monitor relevant health measurements

- Discuss abnormal results with a healthcare professional

Do not provide a definitive diagnosis or personalized medical treatment plan.

Include:

"Discuss these results with a qualified healthcare professional."

==================================================

14. HISTORY

==================================================

Create a screening history page.

Store previous screening records.

Each record should contain:

- Date

- Patient identifier

- Number of models run

- Summary

- Link to result

Allow:

View

Delete

Download report

If authentication/database is implemented, use a proper database.

Prefer:

PostgreSQL / Supabase

Do not store sensitive medical information insecurely in browser localStorage as the primary database.

==================================================

15. BACKEND API STRUCTURE

==================================================

Create:

GET /api/health

GET /api/models/status

POST /api/extract-report

POST /api/predict

POST /api/report

GET /api/history

GET /api/history/:id

DELETE /api/history/:id

==================================================

16. VALIDATION

==================================================

Validate:

Age

Height

Weight

BMI

Blood pressure

Glucose

Cholesterol

File type

File size

Show friendly validation errors.

Never crash if data is missing.

If a model requires information that the user has not supplied:

show:

"Additional information is required to run this model."

Do not silently invent values.

==================================================

17. ERROR HANDLING

==================================================

Handle:

Missing model

Invalid patient data

Missing required features

Invalid PDF

Unreadable PDF

Prediction error

Backend unavailable

Network error

Show user-friendly messages.

Never expose Python stack traces to the user.

==================================================

18. SECURITY

==================================================

Implement:

- File type validation

- File size limits

- Secure file handling

- Input validation

- CORS configuration

- No hard-coded secrets

- Environment variables for credentials

- Do not expose model files through public static URLs

Medical documents should not be permanently retained unless the user explicitly chooses to save them.

==================================================

19. DEMO / TEST MODE

==================================================

Create a clearly labeled:

"Demo Patient"

button that fills the form with sample values.

IMPORTANT:

This must only be test data.

Never present sample predictions as real medical results.

==================================================

20. PROJECT STRUCTURE

==================================================

Create a clean structure:

multi-disease-ai/

│

├── frontend/

│ ├── src/

│ ├── components/

│ ├── pages/

│ ├── services/

│ └── assets/

│

├── backend/

│ ├── app.py

│ ├── model_manager.py

│ ├── prediction_service.py

│ ├── report_parser.py

│ ├── validators.py

│ ├── models/

│ │ ├── diabetes_model.joblib

│ │ ├── heart_disease_model.joblib

│ │ ├── kidney_disease_model.joblib

│ │ ├── liver_disease_model.joblib

│ │ ├── stroke_disease_model.joblib

│ │ ├── parkinsons_model.joblib

│ │ ├── breast_cancer_model.joblib

│ │ ├── thyroid_model.joblib

│ │ ├── lung_cancer_model.joblib

│ │ └── alzheimers_model.joblib

│ └── requirements.txt

│

├── README.md

├── .env.example

└── docker/

    └── Dockerfile

==================================================

21. IMPORTANT MODEL INTEGRATION RULE

==================================================

I will provide the actual trained .joblib model files.

Before writing the prediction code:

1. Inspect every model.

2. Determine its expected input structure.

3. Determine whether it contains a preprocessing pipeline.

4. Determine model.classes_.

5. Determine required feature names/order.

6. Create the correct adapter for each model.

DO NOT assume all models have the same preprocessing.

DO NOT retrain the models unless explicitly requested.

DO NOT replace the models with another algorithm.

DO NOT create fake model files.

==================================================

22. FINAL QUALITY REQUIREMENT

==================================================

The finished application should feel like a real modern AI healthcare screening platform:

- Professional frontend

- Functional backend

- Real trained model integraation

- Real PDF extraction

- Real REST APIs

- Real prediction results

- Responsive design

- Error handling

- Model status

- Screening history

- Downloadable report

- Clear medical disclaimer

Do not stop after generating the frontend.

Build the frontend AND backend integration.

Make every major button functional.

Use real API calls between frontend and backend.

If some model cannot safely run because required features are unavailable, show the missing fields instead of fabricating values.

At the end, provide:

1. Complete project structure

2. All frontend files

3. All backend files

4. requirements.txt

5. Environment variable example

6. Setup commands

7. Run commands

8. Model placement instructions

9. API documentation

10. Deployment instructions

Most importantly:

THIS MUST BE A FUNCTIONAL FULL-STACK APPLICATION USING MY 10 TRAINED MODELS, NOT A UI MOCKUP.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e636dbfc-7e62-5faa-acdf-1c9aad246202).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
