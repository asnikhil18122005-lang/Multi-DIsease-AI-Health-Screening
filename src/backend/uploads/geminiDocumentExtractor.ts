import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { GoogleGenAI } from "@google/genai";
import type { ExtractedPatientData } from "./index";

export interface FileIntegrityCheck {
  validFormat: boolean;
  isCorrupted: boolean;
  isEmpty: boolean;
  isBlankContent: boolean;
  detectedType: "pdf" | "jpeg" | "png" | "webp" | "docx_or_xlsx" | "text" | "unsupported";
  errorCode?:
    | "EMPTY_FILE"
    | "UNSUPPORTED_FILE_TYPE"
    | "CORRUPTED_FILE"
    | "BLANK_DOCUMENT"
    | "CANNOT_READ_DOCUMENT";
  errorMessage?: string;
}

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".docx",
  ".doc",
  ".txt",
  ".csv",
  ".json",
  ".xlsx",
  ".rtf",
  ".xml",
  ".html",
]);

const UNSUPPORTED_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".aac",
  ".flac",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dmg",
  ".iso",
  ".apk",
  ".msi",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".bz2",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".cs",
  ".go",
  ".rs",
  ".php",
  ".rb",
  ".sh",
  ".bat",
  ".ps1",
  ".sql",
  ".ppt",
  ".pptx",
]);

/**
 * Checks whether a PNG buffer is a completely blank / single-color image by decompressing IDAT chunks.
 */
function isPngBlankOrCorrupted(buf: Buffer): { corrupted: boolean; blank: boolean } {
  if (buf.length < 33) return { corrupted: true, blank: false };
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47 ||
    buf[4] !== 0x0d ||
    buf[5] !== 0x0a ||
    buf[6] !== 0x1a ||
    buf[7] !== 0x0a
  ) {
    return { corrupted: true, blank: false };
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  const idatParts: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) {
      return { corrupted: true, blank: false };
    }
    if (type === "IHDR") {
      if (length < 13) return { corrupted: true, blank: false };
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      sawIhdr = true;
    } else if (type === "IDAT") {
      sawIdat = true;
      idatParts.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
    offset = dataEnd + 4;
  }

  if (!sawIhdr || !sawIdat || !sawIend || width === 0 || height === 0) {
    return { corrupted: true, blank: false };
  }

  try {
    const combinedIdat = Buffer.concat(idatParts);
    const decompressed = zlib.inflateSync(combinedIdat);
    if (decompressed.length < height * 2) {
      return { corrupted: true, blank: false };
    }
    // Check pixel variance across decompressed scanlines (ignoring filter byte at start of each row)
    const rowBytes = Math.floor(decompressed.length / height);
    let firstByte: number | null = null;
    let nonZeroDiffs = 0;
    const step = Math.max(1, Math.floor(decompressed.length / 4000));
    for (let i = 1; i < decompressed.length; i += step) {
      if (rowBytes > 1 && i % rowBytes === 0) continue;
      const b = decompressed[i]!;
      if (firstByte === null) {
        firstByte = b;
      } else if (Math.abs(b - firstByte) > 3) {
        nonZeroDiffs++;
      }
    }
    if (nonZeroDiffs < 5) {
      return { corrupted: false, blank: true };
    }
    return { corrupted: false, blank: false };
  } catch {
    return { corrupted: true, blank: false };
  }
}

/**
 * Checks whether a JPEG buffer has valid SOI/EOI/SOF markers and isn't truncated or blank.
 */
function isJpegBlankOrCorrupted(buf: Buffer): { corrupted: boolean; blank: boolean } {
  if (buf.length < 120) return { corrupted: true, blank: false };
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return { corrupted: true, blank: false };
  }
  // Check for Start of Scan (FF DA) and End of Image (FF D9)
  let hasSos = false;
  let hasEoi = false;
  let sosOffset = 0;
  for (let i = 2; i + 1 < buf.length; i++) {
    if (buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda && !hasSos) {
        hasSos = true;
        sosOffset = i + 2;
      } else if (marker === 0xd9) {
        hasEoi = true;
      }
    }
  }
  if (!hasSos || !hasEoi) {
    return { corrupted: true, blank: false };
  }
  const scanData = buf.subarray(sosOffset, buf.length - 2);
  if (scanData.length < 32) {
    return { corrupted: false, blank: true };
  }
  // Measure byte entropy in scan data; solid-color JPEGs have very short or near-uniform repeated scan blocks
  const uniqueBytes = new Set<number>();
  for (let i = 0; i < Math.min(scanData.length, 4096); i++) {
    uniqueBytes.add(scanData[i]!);
  }
  if (scanData.length < 250 && uniqueBytes.size < 18) {
    return { corrupted: false, blank: true };
  }
  return { corrupted: false, blank: false };
}

/**
 * Validates binary file structure, extension, and corruption before extraction.
 */
export function verifyUploadedFileIntegrity(
  buf: Buffer,
  filename: string,
  mimeType: string,
): FileIntegrityCheck {
  if (!buf || buf.length === 0) {
    return {
      validFormat: false,
      isCorrupted: false,
      isEmpty: true,
      isBlankContent: true,
      detectedType: "unsupported",
      errorCode: "EMPTY_FILE",
      errorMessage:
        "Document Error: The uploaded file is empty (0 bytes). Please upload a valid medical report or patient document.",
    };
  }

  const ext = path.extname(filename || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (
    UNSUPPORTED_EXTENSIONS.has(ext) ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/")
  ) {
    return {
      validFormat: false,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "unsupported",
      errorCode: "UNSUPPORTED_FILE_TYPE",
      errorMessage:
        "Unsupported file type. Supported formats: PDF, JPG, JPEG, PNG (and clinical text/spreadsheet documents). Please upload a valid medical report or patient document.",
    };
  }

  if (ext && !SUPPORTED_EXTENSIONS.has(ext)) {
    return {
      validFormat: false,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "unsupported",
      errorCode: "UNSUPPORTED_FILE_TYPE",
      errorMessage: `Unsupported file type (${ext}). Supported formats: PDF, JPG, JPEG, PNG. Please upload a valid medical report or patient document.`,
    };
  }

  // 1. Check PDF files
  if (ext === ".pdf" || mime.includes("pdf")) {
    const headerStr = buf.subarray(0, Math.min(buf.length, 1024)).toString("latin1");
    if (!headerStr.includes("%PDF-")) {
      return {
        validFormat: false,
        isCorrupted: true,
        isEmpty: false,
        isBlankContent: false,
        detectedType: "pdf",
        errorCode: "CORRUPTED_FILE",
        errorMessage:
          "Document Error: The uploaded PDF file is corrupted or unreadable (missing valid PDF header). Please upload a valid medical report or patient document.",
      };
    }
    const fullLatin = buf.toString("latin1");
    if (!fullLatin.includes("%%EOF") && !fullLatin.includes("endobj")) {
      return {
        validFormat: false,
        isCorrupted: true,
        isEmpty: false,
        isBlankContent: false,
        detectedType: "pdf",
        errorCode: "CORRUPTED_FILE",
        errorMessage:
          "Document Error: The uploaded PDF file appears to be truncated or corrupted. Please upload a valid medical report or patient document.",
      };
    }
    return {
      validFormat: true,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "pdf",
    };
  }

  // 2. Check PNG files
  if (ext === ".png" || mime.includes("png")) {
    const check = isPngBlankOrCorrupted(buf);
    if (check.corrupted) {
      return {
        validFormat: false,
        isCorrupted: true,
        isEmpty: false,
        isBlankContent: false,
        detectedType: "png",
        errorCode: "CORRUPTED_FILE",
        errorMessage:
          "Document Error: The uploaded PNG image is corrupted or cannot be read. Please upload a valid medical report or patient document.",
      };
    }
    if (check.blank) {
      return {
        validFormat: false,
        isCorrupted: false,
        isEmpty: false,
        isBlankContent: true,
        detectedType: "png",
        errorCode: "BLANK_DOCUMENT",
        errorMessage:
          "Document Error: The uploaded image is blank and contains no medical information. Please upload a valid medical report or patient document.",
      };
    }
    return {
      validFormat: true,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "png",
    };
  }

  // 3. Check JPG/JPEG files
  if (ext === ".jpg" || ext === ".jpeg" || mime.includes("jpeg") || mime.includes("jpg")) {
    const check = isJpegBlankOrCorrupted(buf);
    if (check.corrupted) {
      return {
        validFormat: false,
        isCorrupted: true,
        isEmpty: false,
        isBlankContent: false,
        detectedType: "jpeg",
        errorCode: "CORRUPTED_FILE",
        errorMessage:
          "Document Error: The uploaded JPG/JPEG image is corrupted or cannot be read. Please upload a valid medical report or patient document.",
      };
    }
    if (check.blank) {
      return {
        validFormat: false,
        isCorrupted: false,
        isEmpty: false,
        isBlankContent: true,
        detectedType: "jpeg",
        errorCode: "BLANK_DOCUMENT",
        errorMessage:
          "Document Error: The uploaded image is blank and contains no medical information. Please upload a valid medical report or patient document.",
      };
    }
    return {
      validFormat: true,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "jpeg",
    };
  }

  // 4. Check DOCX/XLSX files
  if (ext === ".docx" || ext === ".xlsx" || mime.includes("officedocument")) {
    if (
      buf.length < 30 ||
      buf[0] !== 0x50 ||
      buf[1] !== 0x4b ||
      buf[2] !== 0x03 ||
      buf[3] !== 0x04
    ) {
      return {
        validFormat: false,
        isCorrupted: true,
        isEmpty: false,
        isBlankContent: false,
        detectedType: "docx_or_xlsx",
        errorCode: "CORRUPTED_FILE",
        errorMessage:
          "Document Error: The uploaded Office document is corrupted or unreadable. Please upload a valid medical report or patient document.",
      };
    }
    return {
      validFormat: true,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "docx_or_xlsx",
    };
  }

  // 5. Check Text / CSV / JSON / RTF / HTML / XML
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let printable = 0;
  let nonWhitespace = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i]!;
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13 || b >= 128) {
      printable++;
      if (b > 32) nonWhitespace++;
    }
  }
  if (sample.length > 0 && printable / sample.length < 0.65) {
    return {
      validFormat: false,
      isCorrupted: true,
      isEmpty: false,
      isBlankContent: false,
      detectedType: "unsupported",
      errorCode: "CORRUPTED_FILE",
      errorMessage:
        "Document Error: The uploaded file is corrupted or in an unreadable binary format. Please upload a valid medical report or patient document.",
    };
  }
  if (nonWhitespace === 0) {
    return {
      validFormat: false,
      isCorrupted: false,
      isEmpty: false,
      isBlankContent: true,
      detectedType: "text",
      errorCode: "BLANK_DOCUMENT",
      errorMessage:
        "Document Error: The uploaded document is blank and contains no text or patient information. Please upload a valid medical report or patient document.",
    };
  }

  return {
    validFormat: true,
    isCorrupted: false,
    isEmpty: false,
    isBlankContent: false,
    detectedType: "text",
  };
}

/**
 * Uses Ghostscript (/usr/bin/gs -sDEVICE=txtwrite) to extract full text from any PDF buffer.
 */
export function extractPdfTextWithGhostscript(buf: Buffer): {
  text: string;
  corrupted: boolean;
} {
  if (!fs.existsSync("/usr/bin/gs")) {
    return { text: "", corrupted: false };
  }
  const tmpFile = path.join(
    os.tmpdir(),
    `med_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
  );
  try {
    fs.writeFileSync(tmpFile, buf);
    const stdout = execFileSync(
      "/usr/bin/gs",
      ["-sDEVICE=txtwrite", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-q", "-o", "-", tmpFile],
      {
        timeout: 6000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return { text: stdout.toString("utf-8"), corrupted: false };
  } catch (err) {
    const msg = String(err);
    const isCorruptErr =
      /Error:\s*\/(?:syntaxerror|undefined|typecheck|rangecheck|ioerror)/i.test(msg);
    return { text: "", corrupted: isCorruptErr };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup error
    }
  }
}

export interface GeminiMedicalExtractionResult {
  invoked: boolean;
  isValidMedicalDocument: boolean;
  documentTypeClassified: string;
  rejectionReason: string | null;
  extractedTextSummary: string;
  extractedData: Partial<ExtractedPatientData>;
}

/**
 * Uses server-side @google/genai (gemini-3.8-flash) to inspect uploaded PDF, JPG/JPEG, and PNG files,
 * verify whether they are genuine patient/medical documents vs unrelated images/documents,
 * and extract structured clinical values without inventing missing fields.
 */
export async function analyzeDocumentWithGemini(
  fileBuffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<GeminiMedicalExtractionResult | null> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) return null;

  const lowerExt = path.extname(filename || "").toLowerCase();
  let resolvedMime = (mimeType || "").toLowerCase();
  if (lowerExt === ".pdf" || resolvedMime.includes("pdf")) {
    resolvedMime = "application/pdf";
  } else if (lowerExt === ".png" || resolvedMime.includes("png")) {
    resolvedMime = "image/png";
  } else if (lowerExt === ".jpg" || lowerExt === ".jpeg" || resolvedMime.includes("jpeg") || resolvedMime.includes("jpg")) {
    resolvedMime = "image/jpeg";
  } else if (lowerExt === ".webp" || resolvedMime.includes("webp")) {
    resolvedMime = "image/webp";
  } else {
    return null;
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const prompt = `Analyze this uploaded file ("${filename}") for a clinical patient health screening system.
Determine carefully if this file is a genuine medical/patient document (e.g., laboratory blood test report, clinical vitals report, medical prescription, discharge summary, pathology/biopsy report, or patient health record) OR if it is an invalid/unrelated document (e.g., normal photo, selfie, landscape, object photo, blank page, resume/CV, college certificate, ID card, academic project report/paper, invoice/receipt, or random diagram).

CRITICAL RULES:
1. Set "is_valid_medical_document" to true ONLY if the file is an actual medical/patient document containing recognizable patient clinical, vital, symptom, or laboratory information.
2. If it is a normal photo, random image, blank page, resume, college certificate, academic paper, or non-medical document, set "is_valid_medical_document" to false and provide a brief "rejection_reason".
3. Extract ONLY the values explicitly visible in the document. If a field is not present in the document, set it to null. NEVER guess, invent, or hallucinate missing numbers.

Return a JSON object with this exact structure:
{
  "is_valid_medical_document": boolean,
  "document_category": "medical_report" | "normal_photo_or_random_image" | "resume_or_cv" | "college_or_academic_document" | "blank_document" | "invoice_or_receipt" | "unrelated_document",
  "rejection_reason": string | null,
  "extracted_text": string,
  "patient_data": {
    "name": string | null,
    "patient_ref": string | null,
    "age": number | null,
    "sex": "Male" | "Female" | null,
    "height": number | null,
    "weight": number | null,
    "bmi": number | null,
    "systolic_bp": number | null,
    "diastolic_bp": number | null,
    "heart_rate": number | null,
    "glucose": number | null,
    "cholesterol": number | null,
    "hemoglobin": number | null,
    "tsh": number | null,
    "t3": number | null,
    "tt4": number | null,
    "creatinine": number | null,
    "urea": number | null,
    "sg": number | null,
    "albumin": number | null,
    "total_bilirubin": number | null,
    "direct_bilirubin": number | null,
    "alkaline_phosphotase": number | null,
    "sgpt": number | null,
    "sgot": number | null,
    "total_proteins": number | null,
    "ag_ratio": number | null,
    "radius_mean": number | null,
    "texture_mean": number | null,
    "perimeter_mean": number | null,
    "area_mean": number | null,
    "MDVP_Fo_Hz": number | null,
    "MDVP_Jitter_Percent": number | null,
    "MDVP_Shimmer": number | null,
    "HNR": number | null,
    "MMSE": number | null,
    "FunctionalAssessment": number | null,
    "smoking": boolean | null,
    "alcohol": boolean | null,
    "hypertension": boolean | null,
    "diabetes": boolean | null,
    "heart_disease": boolean | null,
    "family_history": boolean | null,
    "medical_history_notes": string | null,
    "symptoms": string[]
  }
}`;

    const modelsToTry = ["gemini-3.8-flash", "gemini-flash-latest"];
    let rawJson = "";
    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: resolvedMime,
                  data: fileBuffer.toString("base64"),
                },
              },
              {
                text: prompt,
              },
            ],
          },
          config: {
            responseMimeType: "application/json",
            temperature: 0.0,
          },
        });
        if (response.text) {
          rawJson = response.text;
          break;
        }
      } catch {
        // try next model in fallback list
      }
    }

    if (!rawJson) return null;

    const parsed = JSON.parse(rawJson) as {
      is_valid_medical_document?: boolean;
      document_category?: string;
      rejection_reason?: string | null;
      extracted_text?: string;
      patient_data?: Record<string, unknown>;
    };

    const pd = parsed.patient_data && typeof parsed.patient_data === "object" ? parsed.patient_data : {};
    const cleanedData: Partial<ExtractedPatientData> = {};

    if (typeof pd["name"] === "string" && pd["name"].trim()) cleanedData.name = pd["name"].trim();
    if (typeof pd["patient_ref"] === "string" && pd["patient_ref"].trim()) {
      cleanedData.patient_ref = pd["patient_ref"].trim();
    }
    if (pd["sex"] === "Male" || pd["sex"] === "Female") {
      cleanedData.sex = pd["sex"];
    } else if (typeof pd["sex"] === "string") {
      const s = pd["sex"].trim().toLowerCase();
      if (s.startsWith("m")) cleanedData.sex = "Male";
      else if (s.startsWith("f")) cleanedData.sex = "Female";
    }

    const numericBounds: Record<string, [number, number]> = {
      age: [1, 120],
      height: [45, 250],
      weight: [2, 350],
      bmi: [10, 75],
      systolic_bp: [60, 260],
      diastolic_bp: [35, 160],
      heart_rate: [30, 240],
      glucose: [35, 600],
      cholesterol: [70, 600],
      hemoglobin: [3, 22],
      tsh: [0.005, 150],
      t3: [0.2, 15],
      tt4: [10, 350],
      creatinine: [0.1, 25],
      urea: [5, 350],
      sg: [1.001, 1.04],
      albumin: [0.5, 6.5],
      total_bilirubin: [0.1, 45],
      direct_bilirubin: [0.05, 25],
      alkaline_phosphotase: [20, 2500],
      sgpt: [5, 2500],
      sgot: [5, 3000],
      total_proteins: [2, 12],
      ag_ratio: [0.1, 4],
      radius_mean: [5, 35],
      texture_mean: [5, 50],
      perimeter_mean: [30, 250],
      area_mean: [100, 3000],
      MDVP_Fo_Hz: [60, 300],
      MDVP_Jitter_Percent: [0.0001, 0.2],
      MDVP_Shimmer: [0.001, 0.3],
      HNR: [2, 45],
      MMSE: [0, 30],
      FunctionalAssessment: [0, 10],
    };

    for (const [key, [min, max]] of Object.entries(numericBounds)) {
      const val = pd[key];
      const num = typeof val === "number" ? val : typeof val === "string" ? parseFloat(val) : NaN;
      if (Number.isFinite(num) && num >= min && num <= max) {
        cleanedData[key] = num;
      }
    }

    for (const boolKey of [
      "smoking",
      "alcohol",
      "hypertension",
      "diabetes",
      "heart_disease",
      "family_history",
    ] as const) {
      if (typeof pd[boolKey] === "boolean") {
        cleanedData[boolKey] = pd[boolKey];
      }
    }

    if (typeof pd["medical_history_notes"] === "string" && pd["medical_history_notes"].trim()) {
      cleanedData["medical_history_notes"] = pd["medical_history_notes"].trim();
    }

    if (Array.isArray(pd["symptoms"])) {
      cleanedData.symptoms = pd["symptoms"]
        .map((s) => String(s).trim())
        .filter((s) => s.length > 0);
    }

    return {
      invoked: true,
      isValidMedicalDocument: Boolean(parsed.is_valid_medical_document),
      documentTypeClassified: String(parsed.document_category || "unknown"),
      rejectionReason: parsed.rejection_reason ? String(parsed.rejection_reason) : null,
      extractedTextSummary: String(parsed.extracted_text || ""),
      extractedData: cleanedData,
    };
  } catch {
    return null;
  }
}
