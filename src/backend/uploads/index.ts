import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { serverDb } from "../database/store";
import { serverLogger } from "../logging/logger";
import {
  analyzeDocumentWithGemini,
  extractPdfTextWithGhostscript,
  verifyUploadedFileIntegrity,
} from "./geminiDocumentExtractor";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export interface ExtractedPatientData {
  name?: string | null;
  patient_ref?: string | null;
  age: number | null;
  sex: "Male" | "Female" | null;
  height: number | null;
  weight: number | null;
  bmi: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  heart_rate: number | null;
  glucose: number | null;
  cholesterol: number | null;
  hemoglobin: number | null;
  tsh: number | null;
  t3: number | null;
  tt4: number | null;
  t4u: number | null;
  fti: number | null;
  creatinine: number | null;
  urea: number | null;
  sg: number | null;
  albumin: number | null;
  total_bilirubin: number | null;
  direct_bilirubin: number | null;
  alkaline_phosphotase: number | null;
  sgpt: number | null;
  sgot: number | null;
  total_proteins: number | null;
  ag_ratio: number | null;
  radius_mean: number | null;
  texture_mean: number | null;
  perimeter_mean: number | null;
  area_mean: number | null;
  MDVP_Fo_Hz: number | null;
  MDVP_Jitter_Percent: number | null;
  MDVP_Shimmer: number | null;
  HNR: number | null;
  MMSE: number | null;
  FunctionalAssessment: number | null;
  smoking?: boolean;
  alcohol?: boolean;
  diabetes?: boolean;
  hypertension?: boolean;
  heart_disease?: boolean;
  family_history?: boolean;
  symptoms?: string[];
  [key: string]: unknown;
}

export interface DocumentValidationReport {
  isValidPatientDocument: boolean;
  isPatientMismatch: boolean;
  classifierProbability: number;
  documentCategory:
    | "valid_patient_report"
    | "patient_details_mismatch"
    | "non_medical_resume"
    | "non_medical_academic_or_project"
    | "non_medical_invoice_or_finance"
    | "non_medical_code_or_config"
    | "unsupported_or_unreadable_binary"
    | "unrelated_document";
  recognizedFieldsCount: number;
  recognizedVitalsAndLabsCount: number;
  recognizedFields: string[];
  mismatchedFields: string[];
  reason: string;
}

export class DocumentValidationError extends Error {
  code: string;
  status: number;
  validation: DocumentValidationReport;
  extractedData: ExtractedPatientData;

  constructor(
    message: string,
    code: string,
    validation: DocumentValidationReport,
    extractedData: ExtractedPatientData,
    status = 400,
  ) {
    super(message);
    this.name = "DocumentValidationError";
    this.code = code;
    this.status = status;
    this.validation = validation;
    this.extractedData = extractedData;
  }
}

export interface ExtractedReportResult {
  reportId: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  fileTypeLabel: string;
  status: "Uploaded & Extracted" | "Uploaded (Manual Entry Needed)" | "Processed" | "Failed";
  extractionSuccess: boolean;
  textFound: boolean;
  extractedData: ExtractedPatientData;
  validation?: DocumentValidationReport;
  message: string;
}

function findNextZipHeaderOffset(buf: Buffer, start: number): number {
  for (let i = start; i + 4 <= buf.length; i++) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      ((buf[i + 2] === 0x03 && buf[i + 3] === 0x04) ||
        (buf[i + 2] === 0x01 && buf[i + 3] === 0x02) ||
        (buf[i + 2] === 0x05 && buf[i + 3] === 0x06) ||
        (buf[i + 2] === 0x07 && buf[i + 3] === 0x08))
    ) {
      return i;
    }
  }
  return buf.length;
}

function extractTextFromZipOfficeBuffer(buf: Buffer): string {
  const chunks: string[] = [];
  const sharedStrings: string[] = [];
  const worksheetXmls: string[] = [];

  let offset = 0;
  while (offset + 30 < buf.length) {
    if (
      buf[offset] === 0x50 &&
      buf[offset + 1] === 0x4b &&
      buf[offset + 2] === 0x03 &&
      buf[offset + 3] === 0x04
    ) {
      const flags = buf.readUInt16LE(offset + 6);
      const compression = buf.readUInt16LE(offset + 8);
      let compressedSize = buf.readUInt32LE(offset + 18);
      const fileNameLen = buf.readUInt16LE(offset + 26);
      const extraLen = buf.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const nameEnd = nameStart + fileNameLen;
      if (nameEnd > buf.length) break;
      const entryName = buf.subarray(nameStart, nameEnd).toString("utf-8");
      const dataStart = nameEnd + extraLen;

      if ((compressedSize === 0 || (flags & 0x08) !== 0) && dataStart < buf.length) {
        const nextPk = findNextZipHeaderOffset(buf, dataStart);
        compressedSize = Math.max(0, nextPk - dataStart);
      }

      const dataEnd = Math.min(buf.length, dataStart + compressedSize);

      if (entryName.endsWith(".xml") && dataStart < dataEnd) {
        try {
          const slice = buf.subarray(dataStart, dataEnd);
          let rawXml = "";
          if (compression === 8) {
            rawXml = zlib.inflateRawSync(slice).toString("utf-8");
          } else if (compression === 0) {
            rawXml = slice.toString("utf-8");
          }
          if (rawXml) {
            if (entryName.includes("sharedStrings.xml")) {
              const siMatches = rawXml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
              for (const m of siMatches) {
                sharedStrings.push(m.replace(/<[^>]+>/g, "").trim());
              }
            } else if (entryName.includes("worksheets/sheet")) {
              worksheetXmls.push(rawXml);
            }
            const plain = rawXml
              .replace(/<\/w:p>|<\/row>|<\/text:p>/g, "\n")
              .replace(/<\/w:tc>|<\/c>|<\/table:table-cell>/g, " : ")
              .replace(/<[^>]+>/g, " ")
              .replace(/[ \t]+/g, " ")
              .trim();
            if (plain) chunks.push(plain);
          }
        } catch {
          // ignore individual zip stream error
        }
      }
      offset = dataEnd > offset ? dataEnd : offset + 1;
    } else {
      offset++;
    }
  }

  // Reconstruct Excel shared string cells if present
  if (sharedStrings.length > 0 && worksheetXmls.length > 0) {
    for (const ws of worksheetXmls) {
      const rowMatches = ws.match(/<row[^>]*>([\s\S]*?)<\/row>/g) || [];
      for (const rowXml of rowMatches) {
        const cellVals: string[] = [];
        const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g;
        let cm: RegExpExecArray | null;
        while ((cm = cellRegex.exec(rowXml)) !== null) {
          const attrs = cm[1] || "";
          const inner = cm[2] || "";
          const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (vMatch && vMatch[1] !== undefined) {
            const rawV = vMatch[1].trim();
            if (/t="s"/.test(attrs)) {
              const idx = parseInt(rawV, 10);
              if (sharedStrings[idx]) cellVals.push(sharedStrings[idx]);
            } else {
              cellVals.push(rawV);
            }
          }
        }
        if (cellVals.length > 0) {
          chunks.push(cellVals.join(": "));
        }
      }
    }
  }

  return chunks.join("\n");
}

function decodePdfLiteralString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function decodePdfHexString(hexRaw: string): string {
  const cleanHex = hexRaw.replace(/\s+/g, "");
  if (cleanHex.length < 2) return "";
  try {
    const bytes = Buffer.from(
      cleanHex.length % 2 === 0 ? cleanHex : `${cleanHex}0`,
      "hex",
    );
    // Check UTF-16BE BOM or alternating 0x00 bytes
    if (
      (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes.length >= 4 && bytes[0] === 0x00 && bytes[2] === 0x00)
    ) {
      let out = "";
      const start = bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0;
      for (let i = start; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i]! << 8) | bytes[i + 1]!;
        if (code >= 32 && code <= 126) out += String.fromCharCode(code);
        else if (code === 10 || code === 13 || code === 9) out += " ";
      }
      return out;
    }
    let out = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
        out += String.fromCharCode(b);
      }
    }
    return out;
  } catch {
    return "";
  }
}

function extractTextFromPdfBuffer(buf: Buffer): string {
  const decompressedStreams: string[] = [];
  const scanBuf = buf.length > 2 * 1024 * 1024 ? buf.subarray(0, 2 * 1024 * 1024) : buf;
  const rawLatin = scanBuf.toString("latin1");

  const streamRegex = /stream(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)?endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(rawLatin)) !== null) {
    const content = match[1];
    if (!content) continue;
    const rawStreamBuf = Buffer.from(content, "latin1");
    let decoded = "";
    try {
      decoded = zlib.inflateSync(rawStreamBuf).toString("latin1");
    } catch {
      try {
        decoded = zlib.inflateRawSync(rawStreamBuf).toString("latin1");
      } catch {
        // Only keep uncompressed stream if it looks like readable ASCII text operators
        if (/\b(?:BT|ET|Tj|TJ)\b/.test(content)) {
          decoded = content;
        }
      }
    }
    if (decoded) {
      decompressedStreams.push(decoded);
    }
  }

  // Also include top-level uncompressed BT...ET blocks if any
  const btEtRegex = /\bBT\b([\s\S]{1,20000}?)\bET\b/g;
  let btm: RegExpExecArray | null;
  while ((btm = btEtRegex.exec(rawLatin)) !== null) {
    if (btm[1]) decompressedStreams.push(btm[1]);
  }

  const combinedStreams = decompressedStreams.join("\n").slice(0, 400_000);
  const extractedLines: string[] = [];

  // 1. Parse TJ arrays: [(Pa)-15(tient )10(Name: )(Kavya)] TJ
  const tjArrayRegex = /\[([^\]]+)\]\s*TJ/g;
  let tjm: RegExpExecArray | null;
  while ((tjm = tjArrayRegex.exec(combinedStreams)) !== null) {
    const arrayBody = tjm[1] || "";
    let lineStr = "";
    const tokenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g;
    let tk: RegExpExecArray | null;
    while ((tk = tokenRegex.exec(arrayBody)) !== null) {
      if (tk[1] !== undefined) {
        lineStr += decodePdfLiteralString(tk[1]);
      } else if (tk[2] !== undefined) {
        lineStr += decodePdfHexString(tk[2]);
      } else if (tk[3] !== undefined) {
        const kern = parseFloat(tk[3]);
        if (kern <= -120) lineStr += " ";
      }
    }
    if (lineStr.trim()) extractedLines.push(lineStr.trim());
  }

  // 2. Parse single literal strings (...) Tj / ' / "
  const parenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|'|")/g;
  let pm: RegExpExecArray | null;
  while ((pm = parenRegex.exec(combinedStreams)) !== null) {
    if (pm[1]) {
      const dec = decodePdfLiteralString(pm[1]).trim();
      if (dec) extractedLines.push(dec);
    }
  }

  // 3. Fallback: general parenthesized text inside decompressed streams (ignoring PDF metadata dicts)
  if (extractedLines.length < 3) {
    const generalParenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let gpm: RegExpExecArray | null;
    while ((gpm = generalParenRegex.exec(combinedStreams)) !== null) {
      if (gpm[1]) {
        const dec = decodePdfLiteralString(gpm[1]).trim();
        if (dec && /[A-Za-z0-9]/.test(dec)) extractedLines.push(dec);
      }
    }
  }

  // 4. Parse hex strings <...> Tj
  const hexTjRegex = /<([0-9A-Fa-f\s]{4,})>\s*Tj/g;
  let hm: RegExpExecArray | null;
  while ((hm = hexTjRegex.exec(combinedStreams)) !== null) {
    if (hm[1]) {
      const dec = decodePdfHexString(hm[1]).trim();
      if (dec) extractedLines.push(dec);
    }
  }

  return extractedLines.join("\n").slice(0, 200_000);
}

function extractMetadataTextFromImageBuffer(buf: Buffer): string {
  // Never scan raw compressed pixel data. Extract structured PNG text chunks (tEXt/zTXt/iTXt) and JPEG COM/APP1 metadata.
  const chunks: string[] = [];

  // 1. PNG structured chunks
  if (
    buf.length > 33 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    let offset = 8;
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buf.length) break;
      const chunkData = buf.subarray(dataStart, dataEnd);
      if (type === "tEXt" || type === "iTXt") {
        const str = chunkData.toString("utf-8").replace(/\0+/g, ": ").trim();
        if (str.length >= 4) chunks.push(str);
      } else if (type === "zTXt") {
        const nulIdx = chunkData.indexOf(0);
        if (nulIdx >= 0 && nulIdx + 2 < chunkData.length) {
          try {
            const inflated = zlib.inflateSync(chunkData.subarray(nulIdx + 2)).toString("utf-8");
            if (inflated.trim()) chunks.push(inflated.trim());
          } catch {
            // ignore
          }
        }
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }
  }

  // 2. JPEG COM (0xFF 0xFE) and APP1 (0xFF 0xE1) metadata segments before SOS (0xFF 0xDA)
  if (buf.length > 20 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1]!;
      if (marker === 0xda || marker === 0xd9) break; // stop at Start of Scan or End of Image
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segLen = buf.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buf.length) break;
      if (marker === 0xfe || marker === 0xe1) {
        const segData = buf.subarray(offset + 4, offset + 2 + segLen).toString("utf-8");
        const cleaned = segData.replace(/[^\x20-\x7E\r\n\t]/g, " ").replace(/\s+/g, " ").trim();
        if (cleaned.length >= 8) chunks.push(cleaned);
      }
      offset += 2 + segLen;
    }
  }

  return chunks.join("\n");
}

function getFileTypeLabel(ext: string, mimeType: string): string {
  const e = ext.toLowerCase();
  if (e === ".pdf" || mimeType.includes("pdf")) return "PDF Document";
  if (e === ".docx" || mimeType.includes("wordprocessingml")) return "Word Document (DOCX)";
  if (e === ".doc" || mimeType.includes("msword")) return "Word Document (DOC)";
  if (e === ".csv" || mimeType.includes("csv")) return "CSV Clinical Data";
  if (e === ".json" || mimeType.includes("json")) return "JSON Clinical Data";
  if (
    e === ".xlsx" ||
    e === ".xls" ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel")
  )
    return "Spreadsheet Document";
  if (e === ".rtf" || mimeType.includes("rtf")) return "Rich Text Document (RTF)";
  if (e === ".xml" || mimeType.includes("xml")) return "XML Clinical Document";
  if (e === ".html" || e === ".htm" || mimeType.includes("html")) return "HTML Clinical Report";
  if (e === ".jpg" || e === ".jpeg" || mimeType.includes("jpeg")) return "JPEG Medical Image";
  if (e === ".png" || mimeType.includes("png")) return "PNG Medical Image";
  if (e === ".webp" || mimeType.includes("webp")) return "WebP Medical Image";
  if (e === ".txt" || e === ".md" || mimeType.includes("text")) return "Text Document";
  if (e) return `${e.replace(".", "").toUpperCase()} Document`;
  return mimeType || "Medical Document";
}

function boundedNum(val: number | null, min: number, max: number): number | null {
  if (val === null || !Number.isFinite(val)) return null;
  if (val < min || val > max) return null;
  return val;
}

export function extractMedicalValuesFromText(rawText: string): {
  data: ExtractedPatientData;
  hasRecognizedValues: boolean;
  vitalCount: number;
  labCount: number;
  demographicCount: number;
  symptomCount: number;
  historyCount: number;
  recognizedFields: string[];
} {
  const data: ExtractedPatientData = {
    name: null,
    patient_ref: null,
    age: null,
    sex: null,
    height: null,
    weight: null,
    bmi: null,
    systolic_bp: null,
    diastolic_bp: null,
    heart_rate: null,
    glucose: null,
    cholesterol: null,
    hemoglobin: null,
    tsh: null,
    t3: null,
    tt4: null,
    t4u: null,
    fti: null,
    creatinine: null,
    urea: null,
    sg: null,
    albumin: null,
    total_bilirubin: null,
    direct_bilirubin: null,
    alkaline_phosphotase: null,
    sgpt: null,
    sgot: null,
    total_proteins: null,
    ag_ratio: null,
    radius_mean: null,
    texture_mean: null,
    perimeter_mean: null,
    area_mean: null,
    MDVP_Fo_Hz: null,
    MDVP_Jitter_Percent: null,
    MDVP_Shimmer: null,
    HNR: null,
    MMSE: null,
    FunctionalAssessment: null,
    symptoms: [],
  };

  // Strip parenthetical unit/range labels so digits inside units aren't captured as values
  const cleanedForNumbers = rawText
    .toLowerCase()
    .replace(
      /\((?:kg\/m2|kg\/m²|mm2|mm²|0-30|0-10|1-10|m\/f|years?|yrs?|cm|kg|mmhg|bpm|mg\/dl|g\/dl|miu\/l|iu\/l|u\/l|nmol\/l|%|hz|db)\)/gi,
      " ",
    )
    .replace(/\bkg\/m2\b|\bkg\/m²\b|\bmm2\b|\bmm²\b/gi, " ")
    .replace(/\bb\.?\s*sc\b|\bm\.?\s*sc\b/gi, " ");

  const text = rawText.toLowerCase();

  const matchBounded = (regex: RegExp, min: number, max: number): number | null => {
    const m = cleanedForNumbers.match(regex);
    if (!m || !m[1]) return null;
    const n = parseFloat(m[1]);
    return boundedNum(n, min, max);
  };

  // Patient Name & ID
  const nameMatch = rawText.match(
    /\b(?:patient\s*name|full\s*name|patient|name)\s*[:=-]\s*([A-Za-z][A-Za-z\s.]{1,40}?)(?:\r|\n|,|;|\||age|sex|gender|id|dob|date|$)/i,
  );
  if (nameMatch && nameMatch[1]) {
    const candidateName = nameMatch[1].trim();
    if (
      candidateName.length >= 2 &&
      !/^(male|female|unknown|none|n\/a|report|summary|details|information|document|test|portal|system|form)$/i.test(
        candidateName,
      )
    ) {
      data.name = candidateName;
    }
  }

  const refMatch = rawText.match(
    /\b(?:patient\s*(?:id|ref|reference)|mrn|uhid|record\s*id|reg\s*no)\s*[:=-]\s*([A-Za-z0-9_-]{3,25})/i,
  );
  if (refMatch && refMatch[1]) {
    data.patient_ref = refMatch[1].trim();
  }

  // Sex / Gender (require explicit label or age/sex shorthand so random prose doesn't trigger)
  const sexMatch = text.match(/\b(?:sex|gender)\s*(?:\([^)]*\))?\s*[:=-]?\s*(male|female|m|f)\b/i);
  if (sexMatch && sexMatch[1]) {
    const s = sexMatch[1].toLowerCase();
    data.sex = s.startsWith("f") ? "Female" : "Male";
  } else if (/\b(\d{1,3})\s*(?:yrs?|years?|y|yo|y\/o)?\s*[/,-]\s*(male|female)\b/i.test(text)) {
    const m = text.match(/\b(\d{1,3})\s*(?:yrs?|years?|y|yo|y\/o)?\s*[/,-]\s*(male|female)\b/i);
    if (m) {
      const parsedAge = parseInt(m[1] || "0", 10);
      if (parsedAge >= 1 && parsedAge <= 120) data.age = parsedAge;
      data.sex = (m[2] || "").toLowerCase().startsWith("f") ? "Female" : "Male";
    }
  } else if (/\b(\d{1,3})\s*(?:yrs?|years?|y)\s*[/]\s*(male|female|m|f)\b/i.test(text)) {
    const m = text.match(/\b(\d{1,3})\s*(?:yrs?|years?|y)\s*[/]\s*(male|female|m|f)\b/i);
    if (m) {
      const parsedAge = parseInt(m[1] || "0", 10);
      if (parsedAge >= 1 && parsedAge <= 120) data.age = parsedAge;
      data.sex = (m[2] || "").toLowerCase().startsWith("f") ? "Female" : "Male";
    }
  }

  // Age
  const explicitAge = matchBounded(/\bage\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,3})\b/, 1, 120);
  if (explicitAge !== null) {
    data.age = explicitAge;
  } else if (data.age === null) {
    const narrativeAge = text.match(
      /\b(\d{1,3})\s*(?:-|\s+)?(?:years?\s*old|yrs?\s*old|year-old|yr-old|y\/o)\b/i,
    );
    if (narrativeAge && narrativeAge[1]) {
      const na = parseInt(narrativeAge[1], 10);
      if (na >= 1 && na <= 120) data.age = na;
    }
  }

  // Vitals & Anthropometrics
  data.height = matchBounded(/\bheight\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)\b/, 45, 250);
  data.weight = matchBounded(/\bweight\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\b/, 2, 350);
  data.bmi = matchBounded(
    /\b(?:bmi|body\s*mass\s*index)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    10,
    75,
  );

  if (data.bmi === null && data.height !== null && data.weight !== null && data.height > 45) {
    const hMeters = data.height / 100;
    const computedBmi = Number((data.weight / (hMeters * hMeters)).toFixed(1));
    if (computedBmi >= 10 && computedBmi <= 75) {
      data.bmi = computedBmi;
    }
  }

  // Blood pressure e.g. BP: 120/80 or 130/85 mmHg or Systolic BP: 135
  const bpSlash =
    cleanedForNumbers.match(
      /\b(?:bp|blood\s*pressure)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3})\s*[/]\s*(\d{2,3})\b/,
    ) || cleanedForNumbers.match(/\b(\d{2,3})\s*[/]\s*(\d{2,3})\s*mm\s*hg\b/);
  if (bpSlash && bpSlash[1] && bpSlash[2]) {
    const sys = boundedNum(parseFloat(bpSlash[1]), 60, 260);
    const dia = boundedNum(parseFloat(bpSlash[2]), 35, 160);
    if (sys !== null && dia !== null && sys > dia) {
      data.systolic_bp = sys;
      data.diastolic_bp = dia;
    }
  } else {
    data.systolic_bp = matchBounded(
      /\b(?:systolic\s*(?:bp|blood\s*pressure)?|resting\s*bp|restingbp|trestbps)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3})\b/,
      60,
      260,
    );
    data.diastolic_bp = matchBounded(
      /\b(?:diastolic\s*(?:bp|blood\s*pressure)?)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3})\b/,
      35,
      160,
    );
  }

  data.heart_rate =
    matchBounded(
      /\b(?:heart\s*rate|pulse(?:\s*rate)?|max\s*hr|maxhr|thalach)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3})\b/,
      30,
      240,
    ) ?? matchBounded(/\bhr\s*[:=]\s*(\d{2,3})\b/, 30, 240);

  // Metabolic & Hematology Labs
  data.glucose = matchBounded(
    /\b(?:fasting\s*blood\s*(?:sugar|glucose)|fbs|random\s*blood\s*(?:sugar|glucose)|rbs|avg\s*glucose(?:\s*level)?|blood\s*(?:glucose|sugar)|glucose)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)\b/,
    35,
    600,
  );
  if (data.glucose === null) {
    // Support HbA1c (%) conversion to estimated average glucose (eAG = 28.7 * A1c - 46.7)
    const hba1c = matchBounded(/\bhba1c\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/, 3.5, 18.0);
    if (hba1c !== null) {
      data.glucose = Math.round(28.7 * hba1c - 46.7);
    }
  }

  data.cholesterol = matchBounded(
    /\b(?:total\s*cholesterol|serum\s*cholesterol|cholesterol)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)\b/,
    70,
    600,
  );
  data.hemoglobin =
    matchBounded(
      /\b(?:hemoglobin|haemoglobin|hgb|hemo)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
      3.0,
      22.0,
    ) ?? matchBounded(/\bhb\s*[:=]\s*(\d{1,2}(?:\.\d+)?)\b/, 3.0, 22.0);

  // Thyroid Panel
  data.tsh = matchBounded(
    /\b(?:thyroid\s*stimulating\s*hormone|tsh)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\b/,
    0.005,
    150.0,
  );
  data.t3 = matchBounded(
    /\b(?:free\s*t3|total\s*t3|serum\s*t3|triiodothyronine)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b|\bt3\s*[:=]\s*(\d{1,2}(?:\.\d+)?)\b/,
    0.2,
    15.0,
  );
  data.tt4 = matchBounded(
    /\b(?:tt4|total\s*t4|free\s*t4|serum\s*t4|thyroxine)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\b|\bt4\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\b/,
    10.0,
    350.0,
  );
  data.t4u = matchBounded(/\bt4u\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/, 0.3, 2.5);
  data.fti = matchBounded(
    /\b(?:free\s*thyroxine\s*index|fti)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\b/,
    10.0,
    350.0,
  );

  // Renal Panel
  data.creatinine =
    matchBounded(
      /\b(?:serum\s*creatinine|s\.?\s*creatinine|creatinine)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
      0.1,
      25.0,
    ) ?? matchBounded(/\bsc\s*[:=]\s*(\d{1,2}\.\d+)\b/, 0.1, 25.0);
  data.urea =
    matchBounded(
      /\b(?:blood\s*urea(?:\s*nitrogen)?|serum\s*urea|urea|bun)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,3}(?:\.\d+)?)\b/,
      5.0,
      350.0,
    ) ?? matchBounded(/\bbu\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\b/, 5.0, 350.0);
  data.sg = matchBounded(
    /\b(?:specific\s*gravity|urine\s*sg)\s*(?:\([^)]*\))?\s*[:=-]?\s*(1\.0\d{2})\b|\bsg\s*[:=]\s*(1\.0\d{2})\b/,
    1.001,
    1.04,
  );

  // Hepatic Panel
  data.albumin = matchBounded(
    /\b(?:serum\s*albumin|albumin)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    0.5,
    6.5,
  );
  data.total_bilirubin = matchBounded(
    /\b(?:total\s*bilirubin|serum\s*bilirubin|bilirubin)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    0.1,
    45.0,
  );
  data.direct_bilirubin = matchBounded(
    /\bdirect\s*bilirubin\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    0.05,
    25.0,
  );
  data.alkaline_phosphotase = matchBounded(
    /\b(?:alkaline\s*phosphatase|alkaline\s*phosphotase|alp)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,4}(?:\.\d+)?)\b/,
    20,
    2500,
  );
  data.sgpt =
    matchBounded(
      /\b(?:sgpt|alamine\s*aminotransferase|alanine\s*aminotransferase|alt\s*\(?sgpt\)?)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,4}(?:\.\d+)?)\b/,
      5,
      2500,
    ) ?? matchBounded(/\balt\s*[:=]\s*(\d{1,4}(?:\.\d+)?)\b/, 5, 2500);
  data.sgot =
    matchBounded(
      /\b(?:sgot|aspartate\s*aminotransferase|ast\s*\(?sgot\)?)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,4}(?:\.\d+)?)\b/,
      5,
      3000,
    ) ?? matchBounded(/\bast\s*[:=]\s*(\d{1,4}(?:\.\d+)?)\b/, 5, 3000);
  data.total_proteins = matchBounded(
    /\btotal\s*proteins?\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    2.0,
    12.0,
  );
  data.ag_ratio = matchBounded(
    /\b(?:a\/g\s*ratio|albumin\s*and\s*globulin\s*ratio)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    0.1,
    4.0,
  );

  // Breast Cancer Biopsy Morphometrics
  data.radius_mean = matchBounded(
    /\b(?:radius[_\s]*mean|mean\s*radius)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    5.0,
    35.0,
  );
  data.texture_mean = matchBounded(
    /\b(?:texture[_\s]*mean|mean\s*texture)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    5.0,
    50.0,
  );
  data.perimeter_mean = matchBounded(
    /\b(?:perimeter[_\s]*mean|mean\s*perimeter)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)\b/,
    30.0,
    250.0,
  );
  data.area_mean = matchBounded(
    /\b(?:area[_\s]*mean|mean\s*area)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,4}(?:\.\d+)?)\b/,
    100.0,
    3000.0,
  );

  // Parkinson's Vocal Biomarkers
  data.MDVP_Fo_Hz = matchBounded(
    /\b(?:mdvp[_\s:]*fo|fundamental\s*frequency|vocal\s*fo)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)\b/,
    60.0,
    300.0,
  );
  data.MDVP_Jitter_Percent = matchBounded(
    /\b(?:mdvp[_\s:]*jitter|vocal\s*jitter|jitter\s*%?)\s*[:=-]\s*(0\.\d+|\d+\.\d+)\b/,
    0.0001,
    0.2,
  );
  data.MDVP_Shimmer = matchBounded(
    /\b(?:mdvp[_\s:]*shimmer|vocal\s*shimmer|shimmer)\s*[:=-]\s*(0\.\d+|\d+\.\d+)\b/,
    0.001,
    0.3,
  );
  data.HNR = matchBounded(
    /\b(?:hnr|harmonics\s*to\s*noise)\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    2.0,
    45.0,
  );

  // Alzheimer's Cognitive Assessment
  data.MMSE = matchBounded(
    /\bmmse(?:\s*score)?\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    0,
    30,
  );
  data.FunctionalAssessment = matchBounded(
    /\bfunctional\s*assessment(?:\s*score)?\s*(?:\([^)]*\))?\s*[:=-]?\s*(\d{1,2}(?:\.\d+)?)\b/,
    0,
    10,
  );

  // Presenting Symptoms
  const recognizedSymptoms = [
    "Fatigue",
    "Cough",
    "Shortness of breath",
    "Chest pain",
    "Wheezing",
    "Difficulty swallowing",
    "Frequent urination",
    "Excessive thirst",
    "Dizziness",
    "Headache",
    "Memory problems",
    "Tremor",
    "Joint pain",
    "Nausea",
    "Blurred vision",
    "Unexplained weight loss",
    "Swelling in legs/ankles",
    "Yellowing of skin/eyes (Jaundice)",
    "Speech difficulty",
    "Muscle stiffness",
  ];
  const foundSymptoms: string[] = [];
  for (const sym of recognizedSymptoms) {
    const symLower = sym.toLowerCase();
    const negated = new RegExp(`(?:no|denies|without|negative\\s+for)\\s+${symLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
    if (!negated && text.includes(symLower)) {
      foundSymptoms.push(sym);
    }
  }
  if (!foundSymptoms.includes("Yellowing of skin/eyes (Jaundice)") && /\bjaundice\b/i.test(text) && !/(?:no|without)\s+jaundice/i.test(text)) {
    foundSymptoms.push("Yellowing of skin/eyes (Jaundice)");
  }
  data.symptoms = foundSymptoms;

  if (/\bsmoking\s*[:=-]?\s*(yes|true|positive|active|current|smokes|smoker)\b/.test(text)) {
    data.smoking = true;
  } else if (/\bsmoking\s*[:=-]?\s*(no|false|negative|never|non-smoker)\b/.test(text)) {
    data.smoking = false;
  }

  if (/\balcohol\s*[:=-]?\s*(yes|true|positive|regular|active)\b/.test(text)) {
    data.alcohol = true;
  }

  if (
    /\bhypertension\s*[:=-]?\s*(yes|true|positive|present|history)\b/.test(text) ||
    /\bhistory\s+of\s+hypertension\b/.test(text) ||
    /\bknown\s+hypertensive\b/.test(text)
  ) {
    data.hypertension = true;
  }
  if (
    /\bdiabetes\s*[:=-]?\s*(yes|true|positive|present|history|type\s*2|type\s*1)\b/.test(text) ||
    /\bhistory\s+of\s+diabetes\b/.test(text) ||
    /\bknown\s+diabetic\b/.test(text)
  ) {
    data.diabetes = true;
  }
  if (
    /\bheart\s*disease\s*[:=-]?\s*(yes|true|positive|present|history)\b/.test(text) ||
    /\bcoronary\s+artery\s+disease\b/.test(text)
  ) {
    data.heart_disease = true;
  }
  if (/\bfamily\s*history\s*[:=-]?\s*(yes|true|positive|present)\b/.test(text)) {
    data.family_history = true;
  }

  const historyNotesMatch = rawText.match(
    /(?:past\s*medical\s*history|medical\s*history|clinical\s*history|diagnosis)\s*[:=-]\s*([^\r\n]{3,200})/i,
  );
  if (historyNotesMatch && historyNotesMatch[1]) {
    data["medical_history_notes"] = historyNotesMatch[1].trim();
  }

  const vitalKeys = ["height", "weight", "bmi", "systolic_bp", "diastolic_bp", "heart_rate"];
  const labKeys = [
    "glucose",
    "cholesterol",
    "hemoglobin",
    "tsh",
    "t3",
    "tt4",
    "t4u",
    "fti",
    "creatinine",
    "urea",
    "sg",
    "albumin",
    "total_bilirubin",
    "direct_bilirubin",
    "alkaline_phosphotase",
    "sgpt",
    "sgot",
    "total_proteins",
    "ag_ratio",
    "radius_mean",
    "texture_mean",
    "perimeter_mean",
    "area_mean",
    "MDVP_Fo_Hz",
    "MDVP_Jitter_Percent",
    "MDVP_Shimmer",
    "HNR",
    "MMSE",
    "FunctionalAssessment",
  ];
  const demographicKeys = ["name", "patient_ref", "age", "sex"];
  const historyKeys = [
    "smoking",
    "alcohol",
    "diabetes",
    "hypertension",
    "heart_disease",
    "family_history",
    "medical_history_notes",
  ];

  // If unlabeled male/female was in text, only accept it if at least 1 other clinical/demographic value was found
  if (
    data.sex === null &&
    (data.age !== null || vitalKeys.some((k) => data[k] !== null) || labKeys.some((k) => data[k] !== null))
  ) {
    const hasMale = /\bmale\b/i.test(text);
    const hasFemale = /\bfemale\b/i.test(text);
    if (hasFemale && !hasMale) data.sex = "Female";
    else if (hasMale && !hasFemale) data.sex = "Male";
  }

  const recognizedFields: string[] = [];
  let vitalCount = 0;
  for (const k of vitalKeys) {
    if (data[k] !== null && data[k] !== undefined) {
      vitalCount++;
      recognizedFields.push(k);
    }
  }
  let labCount = 0;
  for (const k of labKeys) {
    if (data[k] !== null && data[k] !== undefined) {
      labCount++;
      recognizedFields.push(k);
    }
  }
  let demographicCount = 0;
  for (const k of demographicKeys) {
    if (data[k] !== null && data[k] !== undefined && data[k] !== "") {
      demographicCount++;
      recognizedFields.push(k);
    }
  }
  let historyCount = 0;
  for (const k of historyKeys) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== "") {
      historyCount++;
      recognizedFields.push(k);
    }
  }
  const symptomCount = data.symptoms ? data.symptoms.length : 0;
  if (symptomCount > 0) recognizedFields.push("symptoms");

  const hasRecognizedValues =
    vitalCount > 0 || labCount > 0 || demographicCount > 0 || historyCount > 0 || symptomCount > 0;

  return {
    data,
    hasRecognizedValues,
    vitalCount,
    labCount,
    demographicCount,
    symptomCount,
    historyCount,
    recognizedFields,
  };
}

function sigmoid(z: number): number {
  if (z >= 0) {
    return 1.0 / (1.0 + Math.exp(-Math.min(z, 50.0)));
  }
  const ez = Math.exp(Math.max(z, -50.0));
  return ez / (1.0 + ez);
}

function evaluateTrainedDocumentClassifier(features: number[]): number {
  try {
    const modelPath = path.join(process.cwd(), "models", "patient_document_classifier.joblib");
    const scalerPath = path.join(process.cwd(), "models", "patient_document_scaler.joblib");
    if (fs.existsSync(modelPath)) {
      const modelDoc = JSON.parse(fs.readFileSync(modelPath, "utf-8")) as {
        coefficients?: number[];
        intercept?: number;
        scaler_mean?: number[];
        scaler_scale?: number[];
      };
      const scalerDoc = fs.existsSync(scalerPath)
        ? (JSON.parse(fs.readFileSync(scalerPath, "utf-8")) as {
            mean?: number[];
            scale?: number[];
          })
        : null;
      const coeffs = modelDoc.coefficients || [];
      const intercept = Number(modelDoc.intercept || 0);
      const means = scalerDoc?.mean || modelDoc.scaler_mean || [];
      const scales = scalerDoc?.scale || modelDoc.scaler_scale || [];
      if (coeffs.length === features.length) {
        let logit = intercept;
        for (let i = 0; i < coeffs.length; i++) {
          const x = features[i] ?? 0;
          const m = means[i] ?? 0;
          const s = scales[i] && Math.abs(scales[i]!) > 1e-6 ? scales[i]! : 1.0;
          logit += coeffs[i]! * ((x - m) / s);
        }
        return Number(sigmoid(logit).toFixed(4));
      }
    }
  } catch {
    // Fallback to inline calibrated weights below
  }

  // Calibrated fallback weights matching train_patient_document_classifier
  const [
    vitals = 0,
    labs = 0,
    hasId = 0,
    demog = 0,
    syms = 0,
    hist = 0,
    clinKw = 0,
    units = 0,
    nonMed = 0,
    mismatch = 0,
    structKeys = 0,
  ] = features;
  const score =
    -1.2 +
    0.85 * vitals +
    0.95 * labs +
    0.55 * hasId +
    0.45 * demog +
    0.4 * syms +
    0.5 * hist +
    0.22 * clinKw +
    0.35 * units +
    0.6 * structKeys -
    1.15 * nonMed -
    4.5 * mismatch;
  return Number(sigmoid(score).toFixed(4));
}

function normalizePersonName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr|prof|shri|smt|patient|name)\b\.?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesConflict(enteredRaw: unknown, docRaw: unknown): boolean {
  const a = normalizePersonName(enteredRaw);
  const b = normalizePersonName(docRaw);
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  if (a === b || a.includes(b) || b.includes(a)) return false;
  const tokensA = a.split(" ").filter((t) => t.length >= 3);
  const tokensB = b.split(" ").filter((t) => t.length >= 3);
  if (tokensA.length > 0 && tokensB.length > 0) {
    const hasSharedToken = tokensA.some((ta) => tokensB.some((tb) => ta === tb || ta.includes(tb) || tb.includes(ta)));
    if (hasSharedToken) return false;
  }
  return true;
}

export function validateUploadedPatientDocument(params: {
  filename: string;
  lowerExt: string;
  lowerMime: string;
  rawText: string;
  extractedData: ExtractedPatientData;
  vitalCount: number;
  labCount: number;
  demographicCount: number;
  symptomCount: number;
  historyCount: number;
  structuredMedicalKeysCount: number;
  recognizedFields: string[];
  existingPatientData?: Record<string, unknown>;
  forceOverrideMismatch?: boolean;
}): DocumentValidationReport {
  const {
    filename,
    lowerExt,
    rawText,
    extractedData,
    vitalCount,
    labCount,
    demographicCount,
    symptomCount,
    historyCount,
    structuredMedicalKeysCount,
    recognizedFields,
    existingPatientData,
    forceOverrideMismatch,
  } = params;

  const totalVitalsAndLabs = vitalCount + labCount;
  const totalRecognized =
    totalVitalsAndLabs + demographicCount + symptomCount + historyCount + structuredMedicalKeysCount;

  // 1. Disallow source code, executables, media, and non-document archives immediately
  const disallowedExts = new Set([
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
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".bin",
    ".dmg",
    ".iso",
    ".mp3",
    ".wav",
    ".ogg",
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".zip",
    ".tar",
    ".gz",
    ".rar",
    ".7z",
  ]);
  if (disallowedExts.has(lowerExt)) {
    return {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability: 0.01,
      documentCategory: "non_medical_code_or_config",
      recognizedFieldsCount: 0,
      recognizedVitalsAndLabsCount: 0,
      recognizedFields: [],
      mismatchedFields: [],
      reason: `Document Error: Invalid file format ('${filename}'). Only documents containing related patient details or clinical laboratory records are allowed.`,
    };
  }

  const lowerText = rawText.toLowerCase();

  // Count clinical terminology & measurement units
  const clinicalTerms = [
    "patient",
    "clinical",
    "medical",
    "laboratory",
    "pathology",
    "diagnosis",
    "diagnostic",
    "hospital",
    "clinic",
    "physician",
    "doctor",
    "blood pressure",
    "heart rate",
    "pulse",
    "glucose",
    "cholesterol",
    "hemoglobin",
    "haemoglobin",
    "creatinine",
    "urea",
    "bilirubin",
    "albumin",
    "aminotransferase",
    "phosphatase",
    "sgpt",
    "sgot",
    "thyroid",
    "tsh",
    "specimen",
    "serum",
    "plasma",
    "urinalysis",
    "biopsy",
    "screening",
    "symptoms",
    "hypertension",
    "diabetes",
    "vital signs",
    "reference range",
  ];
  let clinicalKeywordCount = 0;
  for (const kw of clinicalTerms) {
    if (lowerText.includes(kw)) clinicalKeywordCount++;
  }

  const unitTerms = [
    "mg/dl",
    "g/dl",
    "mmol/l",
    "miu/l",
    "uiu/ml",
    "iu/l",
    "u/l",
    "ng/dl",
    "pg/ml",
    "nmol/l",
    "mmhg",
    "mm hg",
    "bpm",
    "kg/m2",
    "kg/m²",
  ];
  let measurementUnitCount = 0;
  for (const u of unitTerms) {
    if (lowerText.includes(u)) measurementUnitCount++;
  }

  // Count non-medical document markers
  const resumeMarkers = [
    "curriculum vitae",
    "work experience",
    "professional experience",
    "technical skills",
    "career objective",
    "linkedin.com",
    "github.com",
    "cgpa",
    "internship",
    "extracurricular",
    "certifications",
  ];
  const academicProjectMarkers = [
    "literature survey",
    "literature review",
    "proposed system",
    "existing system",
    "system architecture",
    "train_test_split",
    "confusion matrix",
    "random forest",
    "logistic regression",
    "submitted in partial fulfillment",
    "bachelor of technology",
    "bachelor of science",
    "bachelor of engineering",
    "master of technology",
    "master of science",
    "department of computer",
    "question paper",
    "semester examination",
    "syllabus",
    "course outcomes",
    "this is to certify",
    "hereby certified",
    "bonafide certificate",
    "bona fide certificate",
    "degree certificate",
    "provisional certificate",
    "college of engineering",
    "university of",
    "controller of examinations",
    "academic year",
    "roll number",
    "marksheet",
    "grade sheet",
    "official transcript",
    "convocation",
  ];
  const invoiceFinanceMarkers = [
    "tax invoice",
    "purchase order",
    "proforma invoice",
    "gstin",
    "ifsc code",
    "bill to",
    "ship to",
    "total amount payable",
    "payment terms",
    "balance due",
  ];
  const codeMarkers = [
    "import react",
    "export default",
    "public static void",
    "#include <",
    "select * from",
    "create table",
    "\"dependencies\":",
    "\"devdependencies\":",
    "function(",
  ];

  let resumeHits = 0;
  for (const m of resumeMarkers) if (lowerText.includes(m)) resumeHits++;
  if (/\bresume\b/i.test(lowerText) || /resume|cv/i.test(filename)) resumeHits += 2;

  let academicHits = 0;
  for (const m of academicProjectMarkers) if (lowerText.includes(m)) academicHits++;
  if (
    /certificate|college|university|degree|marksheet|transcript|diploma|bonafide|syllabus|assignment|synopsis|ieee|thesis|project_report/i.test(
      filename,
    )
  ) {
    academicHits += 2;
  }

  let invoiceHits = 0;
  for (const m of invoiceFinanceMarkers) if (lowerText.includes(m)) invoiceHits++;
  if (/invoice|receipt|payslip|statement/i.test(filename)) invoiceHits += 2;

  let codeHits = 0;
  for (const m of codeMarkers) if (lowerText.includes(m)) codeHits++;

  const nonMedicalKeywordCount = resumeHits + academicHits + invoiceHits + codeHits;

  // Check if entered patient details on the form conflict with extracted patient details in the document
  const mismatchedFields: string[] = [];
  if (existingPatientData && !forceOverrideMismatch) {
    const enteredName = existingPatientData["name"];
    const enteredAgeRaw = existingPatientData["age"];
    const enteredAge =
      enteredAgeRaw !== "" && enteredAgeRaw !== null && enteredAgeRaw !== undefined
        ? Number(enteredAgeRaw)
        : null;
    const enteredSex =
      existingPatientData["sex"] === "Male" || existingPatientData["sex"] === "Female"
        ? (existingPatientData["sex"] as "Male" | "Female")
        : null;

    if (
      typeof enteredName === "string" &&
      enteredName.trim().length >= 2 &&
      extractedData.name &&
      namesConflict(enteredName, extractedData.name)
    ) {
      mismatchedFields.push(
        `Patient Name (Entered: '${enteredName.trim()}' vs Document: '${extractedData.name}')`,
      );
    }

    if (
      enteredAge !== null &&
      Number.isFinite(enteredAge) &&
      enteredAge > 0 &&
      extractedData.age !== null &&
      Math.abs(enteredAge - extractedData.age) > 2
    ) {
      mismatchedFields.push(
        `Age (Entered: ${enteredAge} yrs vs Document: ${extractedData.age} yrs)`,
      );
    }

    if (
      enteredSex !== null &&
      extractedData.sex !== null &&
      enteredSex !== extractedData.sex
    ) {
      mismatchedFields.push(
        `Sex (Entered: ${enteredSex} vs Document: ${extractedData.sex})`,
      );
    }
  }

  const isPatientMismatch = mismatchedFields.length > 0;
  const hasPatientIdentity =
    extractedData.name !== null ||
    extractedData.patient_ref !== null ||
    (extractedData.age !== null && extractedData.sex !== null)
      ? 1
      : 0;
  const hasDemogCount =
    (extractedData.age !== null ? 1 : 0) + (extractedData.sex !== null ? 1 : 0);
  const textDensityScore = Math.min(1.0, Number((rawText.trim().length / 400).toFixed(3)));

  const classifierFeatures = [
    vitalCount,
    labCount,
    hasPatientIdentity,
    hasDemogCount,
    symptomCount,
    historyCount,
    clinicalKeywordCount,
    measurementUnitCount,
    nonMedicalKeywordCount,
    isPatientMismatch ? 1 : 0,
    structuredMedicalKeysCount,
    textDensityScore,
  ];

  const classifierProbability = evaluateTrainedDocumentClassifier(classifierFeatures);

  // 2. Reject non-medical documents (Resume, Academic/College/Project Paper, Invoice, Code)
  const stdInvalidPrefix =
    "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document.";

  if (resumeHits >= 2 && totalVitalsAndLabs === 0) {
    return {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability,
      documentCategory: "non_medical_resume",
      recognizedFieldsCount: totalRecognized,
      recognizedVitalsAndLabsCount: totalVitalsAndLabs,
      recognizedFields,
      mismatchedFields: [],
      reason: `${stdInvalidPrefix} (Detected a Resume / CV in '${filename}' without clinical patient information.)`,
    };
  }

  if (academicHits >= 2 && (totalVitalsAndLabs < 2 || !extractedData.name)) {
    return {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability,
      documentCategory: "non_medical_academic_or_project",
      recognizedFieldsCount: totalRecognized,
      recognizedVitalsAndLabsCount: totalVitalsAndLabs,
      recognizedFields,
      mismatchedFields: [],
      reason: `${stdInvalidPrefix} (Detected a college certificate, academic record, or project document in '${filename}'.)`,
    };
  }

  if (invoiceHits >= 2 && totalVitalsAndLabs === 0) {
    return {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability,
      documentCategory: "non_medical_invoice_or_finance",
      recognizedFieldsCount: totalRecognized,
      recognizedVitalsAndLabsCount: totalVitalsAndLabs,
      recognizedFields,
      mismatchedFields: [],
      reason: `${stdInvalidPrefix} (Detected a commercial invoice or financial receipt in '${filename}'.)`,
    };
  }

  if (codeHits >= 2 && totalVitalsAndLabs === 0) {
    return {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability,
      documentCategory: "non_medical_code_or_config",
      recognizedFieldsCount: totalRecognized,
      recognizedVitalsAndLabsCount: totalVitalsAndLabs,
      recognizedFields,
      mismatchedFields: [],
      reason: `${stdInvalidPrefix} (Detected source code or configuration content in '${filename}'.)`,
    };
  }

  // 3. Verify that the document actually contains related patient / clinical details
  const hasClinicalBiomarkers = totalVitalsAndLabs >= 1 || structuredMedicalKeysCount >= 2;
  const hasDemographicsWithClinicalContext =
    (extractedData.age !== null || extractedData.sex !== null || extractedData.name !== null) &&
    (totalVitalsAndLabs >= 1 ||
      symptomCount >= 1 ||
      historyCount >= 1 ||
      clinicalKeywordCount >= 1 ||
      measurementUnitCount >= 1 ||
      (extractedData.age !== null &&
        extractedData.sex !== null &&
        nonMedicalKeywordCount === 0));
  const hasExplicitSymptomsAndHistory =
    symptomCount >= 2 && (historyCount >= 1 || clinicalKeywordCount >= 2) && nonMedicalKeywordCount === 0;

  if (!hasClinicalBiomarkers && !hasDemographicsWithClinicalContext && !hasExplicitSymptomsAndHistory) {
    const isImageFile = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"].includes(lowerExt);
    return {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability,
      documentCategory: isImageFile ? "unsupported_or_unreadable_binary" : "unrelated_document",
      recognizedFieldsCount: totalRecognized,
      recognizedVitalsAndLabsCount: totalVitalsAndLabs,
      recognizedFields,
      mismatchedFields: [],
      reason: `${stdInvalidPrefix} (No recognizable patient details, vital signs, or laboratory biomarkers were found in '${filename}'.)`,
    };
  }

  // 4. Verify that the uploaded document's patient details do not conflict with the patient details already entered
  if (isPatientMismatch) {
    return {
      isValidPatientDocument: false,
      isPatientMismatch: true,
      classifierProbability,
      documentCategory: "patient_details_mismatch",
      recognizedFieldsCount: totalRecognized,
      recognizedVitalsAndLabsCount: totalVitalsAndLabs,
      recognizedFields,
      mismatchedFields,
      reason: `Document Error: The uploaded document ('${filename}') belongs to a different patient and does not match the entered patient details — ${mismatchedFields.join("; ")}. Please upload a document related to the entered patient details, or click 'Allow & Use Document Patient Details' to screen the patient from this document.`,
    };
  }

  return {
    isValidPatientDocument: true,
    isPatientMismatch: false,
    classifierProbability: Math.max(classifierProbability, 0.85),
    documentCategory: "valid_patient_report",
    recognizedFieldsCount: totalRecognized,
    recognizedVitalsAndLabsCount: totalVitalsAndLabs,
    recognizedFields,
    mismatchedFields: [],
    reason: "Validated patient clinical document with recognized medical parameters.",
  };
}

export async function processReportUpload(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  userId: string,
  patientRef?: string,
  options?: {
    existingPatientData?: Record<string, unknown>;
    forceOverrideMismatch?: boolean;
  },
): Promise<ExtractedReportResult> {
  const emptyExtracted = extractMedicalValuesFromText("").data;
  const stdInvalidMsg =
    "The uploaded file does not appear to be a valid medical/patient document. Please upload a valid medical report or patient document.";

  if (fileBuffer && fileBuffer.length > MAX_FILE_SIZE) {
    serverLogger.warn("UPLOAD_FAILURE", "File exceeds maximum size limit", {
      size: fileBuffer.length,
    });
    const sizeReport: DocumentValidationReport = {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability: 0,
      documentCategory: "unrelated_document",
      recognizedFieldsCount: 0,
      recognizedVitalsAndLabsCount: 0,
      recognizedFields: [],
      mismatchedFields: [],
      reason: `${stdInvalidMsg} (File is too large and exceeds the 50 MB maximum upload limit.)`,
    };
    throw new DocumentValidationError(
      sizeReport.reason,
      "FILE_TOO_LARGE",
      sizeReport,
      emptyExtracted,
      400,
    );
  }

  // 0. Binary integrity, supported format, corruption, and blank-file validation
  const integrity = verifyUploadedFileIntegrity(fileBuffer, filename, mimeType);
  if (!integrity.validFormat) {
    const errCode = integrity.errorCode || "INVALID_PATIENT_DOCUMENT";
    const detailMsg = integrity.errorMessage || stdInvalidMsg;
    const fullReason = detailMsg.includes(stdInvalidMsg)
      ? detailMsg
      : `${stdInvalidMsg} (${detailMsg.replace(/^Document Error:\s*/i, "")})`;
    const integrityReport: DocumentValidationReport = {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability: 0,
      documentCategory: "unsupported_or_unreadable_binary",
      recognizedFieldsCount: 0,
      recognizedVitalsAndLabsCount: 0,
      recognizedFields: [],
      mismatchedFields: [],
      reason: fullReason,
    };
    throw new DocumentValidationError(fullReason, errCode, integrityReport, emptyExtracted, 400);
  }

  const lowerMime = (mimeType || "").toLowerCase();
  const lowerExt = path.extname(filename || "").toLowerCase();
  const sanitizedBase =
    path
      .basename(filename || "patient_document")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 80) || "patient_document";

  // 1. Extract text from document buffer according to format (never scanning raw binary pixel noise)
  let rawText = "";
  const isZipSignature =
    fileBuffer.length > 4 &&
    fileBuffer[0] === 0x50 &&
    fileBuffer[1] === 0x4b &&
    fileBuffer[2] === 0x03 &&
    fileBuffer[3] === 0x04;
  const isPdfSignature =
    fileBuffer.length > 5 && fileBuffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const isImageExtOrMime =
    [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff"].includes(lowerExt) ||
    lowerMime.startsWith("image/");

  if (isPdfSignature || lowerExt === ".pdf" || lowerMime.includes("pdf")) {
    rawText = extractTextFromPdfBuffer(fileBuffer);
    const gsOut = extractPdfTextWithGhostscript(fileBuffer);
    if (gsOut.corrupted && !rawText.trim()) {
      const corruptPdfReport: DocumentValidationReport = {
        isValidPatientDocument: false,
        isPatientMismatch: false,
        classifierProbability: 0,
        documentCategory: "unsupported_or_unreadable_binary",
        recognizedFieldsCount: 0,
        recognizedVitalsAndLabsCount: 0,
        recognizedFields: [],
        mismatchedFields: [],
        reason: `${stdInvalidMsg} (The uploaded PDF file is corrupted and cannot be read.)`,
      };
      throw new DocumentValidationError(
        corruptPdfReport.reason,
        "CORRUPTED_FILE",
        corruptPdfReport,
        emptyExtracted,
        400,
      );
    }
    if (gsOut.text.trim()) {
      rawText = rawText ? `${rawText}\n${gsOut.text}` : gsOut.text;
    }
  } else if (
    isZipSignature ||
    [".docx", ".xlsx", ".odt"].includes(lowerExt) ||
    lowerMime.includes("wordprocessingml") ||
    lowerMime.includes("spreadsheetml") ||
    lowerMime.includes("opendocument")
  ) {
    rawText = extractTextFromZipOfficeBuffer(fileBuffer);
  } else if (isImageExtOrMime) {
    rawText = extractMetadataTextFromImageBuffer(fileBuffer);
  } else if (
    lowerMime.includes("text") ||
    lowerMime.includes("json") ||
    lowerMime.includes("csv") ||
    lowerMime.includes("xml") ||
    lowerMime.includes("html") ||
    lowerMime.includes("rtf") ||
    [".txt", ".csv", ".tsv", ".json", ".md", ".xml", ".html", ".htm", ".rtf"].includes(lowerExt)
  ) {
    rawText = fileBuffer.toString("utf-8");
    if (lowerExt === ".rtf" || lowerMime.includes("rtf")) {
      rawText = rawText
        .replace(/\\par\b|\\line\b/g, "\n")
        .replace(/\\[a-z]+-?\d*\s?/gi, " ")
        .replace(/[{}]/g, " ");
    } else if (
      lowerExt === ".html" ||
      lowerExt === ".htm" ||
      lowerExt === ".xml" ||
      lowerMime.includes("html") ||
      lowerMime.includes("xml")
    ) {
      rawText = rawText
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&");
    }
  } else {
    // Unknown extension: check if buffer is mostly printable UTF-8 text (>= 70% printable ASCII)
    const sample = fileBuffer.subarray(0, Math.min(fileBuffer.length, 16384));
    let printable = 0;
    for (let i = 0; i < sample.length; i++) {
      const b = sample[i]!;
      if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printable++;
    }
    if (sample.length > 0 && printable / sample.length >= 0.7) {
      rawText = fileBuffer.toString("utf-8");
    }
  }

  // 1b. For images (JPG, JPEG, PNG, WebP) or scanned/image PDFs with sparse text, run multimodal Gemini OCR & medical verification
  const needsMultimodalOcr =
    isImageExtOrMime ||
    ((isPdfSignature || lowerExt === ".pdf" || lowerMime.includes("pdf")) &&
      rawText.trim().length < 50);

  let geminiOcrData: Partial<ExtractedPatientData> | null = null;
  if (needsMultimodalOcr) {
    const preCheck = extractMedicalValuesFromText(rawText);
    const geminiRes = await analyzeDocumentWithGemini(fileBuffer, mimeType, sanitizedBase);
    if (geminiRes && geminiRes.invoked) {
      if (!geminiRes.isValidMedicalDocument && preCheck.vitalCount + preCheck.labCount === 0) {
        const reasonDetail = geminiRes.rejectionReason
          ? ` (${geminiRes.rejectionReason})`
          : "";
        const fullMsg = `${stdInvalidMsg}${reasonDetail}`;
        const rejectedReport: DocumentValidationReport = {
          isValidPatientDocument: false,
          isPatientMismatch: false,
          classifierProbability: 0.02,
          documentCategory:
            geminiRes.documentTypeClassified === "resume_or_cv"
              ? "non_medical_resume"
              : geminiRes.documentTypeClassified === "college_or_academic_document"
                ? "non_medical_academic_or_project"
                : "unrelated_document",
          recognizedFieldsCount: 0,
          recognizedVitalsAndLabsCount: 0,
          recognizedFields: [],
          mismatchedFields: [],
          reason: fullMsg,
        };
        const errCode =
          geminiRes.documentTypeClassified === "blank_document"
            ? "BLANK_DOCUMENT"
            : "NO_MEDICAL_INFO_DETECTED";
        throw new DocumentValidationError(fullMsg, errCode, rejectedReport, emptyExtracted, 400);
      }
      if (geminiRes.isValidMedicalDocument) {
        geminiOcrData = geminiRes.extractedData;
        if (geminiRes.extractedTextSummary) {
          rawText = rawText
            ? `${rawText}\n${geminiRes.extractedTextSummary}`
            : geminiRes.extractedTextSummary;
        }
      }
    }
  }

  // Check if a PDF has 0 extractable text and 0 OCR fields (blank PDF)
  if (
    (isPdfSignature || lowerExt === ".pdf" || lowerMime.includes("pdf")) &&
    rawText.trim().length === 0 &&
    !geminiOcrData
  ) {
    const blankPdfReport: DocumentValidationReport = {
      isValidPatientDocument: false,
      isPatientMismatch: false,
      classifierProbability: 0,
      documentCategory: "unrelated_document",
      recognizedFieldsCount: 0,
      recognizedVitalsAndLabsCount: 0,
      recognizedFields: [],
      mismatchedFields: [],
      reason: `${stdInvalidMsg} (The uploaded PDF is blank or contains no readable patient medical information.)`,
    };
    throw new DocumentValidationError(
      blankPdfReport.reason,
      "BLANK_DOCUMENT",
      blankPdfReport,
      emptyExtracted,
      400,
    );
  }

  // 2. Extract clinical values from text
  const extraction = extractMedicalValuesFromText(rawText);
  const extractedValues = extraction.data;
  let structuredMedicalKeysCount = 0;

  // Merge Gemini multimodal OCR fields (if any) without overwriting explicit regex matches unless null
  if (geminiOcrData) {
    for (const [k, v] of Object.entries(geminiOcrData)) {
      if (v === null || v === undefined) continue;
      if (k === "symptoms" && Array.isArray(v)) {
        const mergedSyms = new Set([...(extractedValues.symptoms || []), ...v.map(String)]);
        extractedValues.symptoms = Array.from(mergedSyms);
        if (extractedValues.symptoms.length > 0) {
          structuredMedicalKeysCount++;
          if (!extraction.recognizedFields.includes("symptoms")) {
            extraction.recognizedFields.push("symptoms");
          }
        }
      } else if (
        extractedValues[k] === null ||
        extractedValues[k] === undefined ||
        extractedValues[k] === ""
      ) {
        extractedValues[k] = v;
        structuredMedicalKeysCount++;
        if (!extraction.recognizedFields.includes(k)) {
          extraction.recognizedFields.push(k);
        }
      }
    }
  }

  // 3. Parse structured JSON or CSV key-value pairs if present
  try {
    const trimmedText = rawText.trim();
    if (trimmedText.startsWith("{")) {
      const parsedJson = JSON.parse(trimmedText) as Record<string, unknown>;
      const flattenJson = (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === "object" && !Array.isArray(v)) {
            flattenJson(v as Record<string, unknown>);
            continue;
          }
          const lowerKey = k.toLowerCase().trim();
          if (lowerKey === "name" || lowerKey === "patient_name" || lowerKey === "patientname") {
            if (typeof v === "string" && v.trim()) {
              extractedValues.name = v.trim();
              structuredMedicalKeysCount++;
            }
          } else if (lowerKey === "patient_ref" || lowerKey === "patient_id" || lowerKey === "mrn") {
            if (typeof v === "string" && v.trim()) {
              extractedValues.patient_ref = v.trim();
              structuredMedicalKeysCount++;
            }
          } else if (lowerKey === "sex" || lowerKey === "gender") {
            const s = String(v).toLowerCase();
            if (s.startsWith("f")) {
              extractedValues.sex = "Female";
              structuredMedicalKeysCount++;
            } else if (s.startsWith("m")) {
              extractedValues.sex = "Male";
              structuredMedicalKeysCount++;
            }
          } else if (lowerKey === "symptoms" && Array.isArray(v)) {
            extractedValues.symptoms = v.map((item) => String(item));
            structuredMedicalKeysCount++;
          } else if (lowerKey in extractedValues) {
            const num = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
            if (Number.isFinite(num)) {
              extractedValues[lowerKey] = num;
              structuredMedicalKeysCount++;
            } else if (typeof v === "boolean") {
              extractedValues[lowerKey] = v;
              structuredMedicalKeysCount++;
            }
          }
        }
      };
      flattenJson(parsedJson);
    } else if (trimmedText.includes(",") && trimmedText.includes("\n")) {
      const lines = trimmedText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length >= 2) {
        const headers = (lines[0] || "").split(",").map((h) => h.trim().toLowerCase());
        const vals = (lines[1] || "").split(",").map((v) => v.trim());
        headers.forEach((h, idx) => {
          const rawVal = vals[idx];
          if (!rawVal) return;
          const numVal = parseFloat(rawVal);
          if ((h === "name" || h === "patient_name" || h === "patient") && rawVal.length >= 2) {
            extractedValues.name = rawVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "age" || h === "patient_age") && boundedNum(numVal, 1, 120) !== null) {
            extractedValues.age = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "sex" || h === "gender") {
            if (rawVal.toLowerCase().startsWith("f")) {
              extractedValues.sex = "Female";
              structuredMedicalKeysCount++;
            } else if (rawVal.toLowerCase().startsWith("m")) {
              extractedValues.sex = "Male";
              structuredMedicalKeysCount++;
            }
          }
          if (h === "height" && boundedNum(numVal, 45, 250) !== null) {
            extractedValues.height = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "weight" && boundedNum(numVal, 2, 350) !== null) {
            extractedValues.weight = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "bmi" && boundedNum(numVal, 10, 75) !== null) {
            extractedValues.bmi = numVal;
            structuredMedicalKeysCount++;
          }
          if (
            (h === "glucose" || h === "avg_glucose_level" || h === "fbs" || h === "bgr") &&
            boundedNum(numVal, 35, 600) !== null
          ) {
            extractedValues.glucose = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "cholesterol" || h === "chol") && boundedNum(numVal, 70, 600) !== null) {
            extractedValues.cholesterol = numVal;
            structuredMedicalKeysCount++;
          }
          if (
            (h === "systolic_bp" || h === "restingbp" || h === "trestbps" || h === "bp") &&
            boundedNum(numVal, 60, 260) !== null
          ) {
            extractedValues.systolic_bp = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "diastolic_bp" && boundedNum(numVal, 35, 160) !== null) {
            extractedValues.diastolic_bp = numVal;
            structuredMedicalKeysCount++;
          }
          if (
            (h === "heart_rate" || h === "maxhr" || h === "thalach" || h === "pulse") &&
            boundedNum(numVal, 30, 240) !== null
          ) {
            extractedValues.heart_rate = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "creatinine" || h === "sc") && boundedNum(numVal, 0.1, 25) !== null) {
            extractedValues.creatinine = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "hemoglobin" || h === "hemo" || h === "hb") && boundedNum(numVal, 3, 22) !== null) {
            extractedValues.hemoglobin = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "urea" || h === "bu" || h === "bun") && boundedNum(numVal, 5, 350) !== null) {
            extractedValues.urea = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "tsh" && boundedNum(numVal, 0.005, 150) !== null) {
            extractedValues.tsh = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "total_bilirubin" || h === "bilirubin") && boundedNum(numVal, 0.1, 45) !== null) {
            extractedValues.total_bilirubin = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "alkaline_phosphotase" || h === "alp") && boundedNum(numVal, 20, 2500) !== null) {
            extractedValues.alkaline_phosphotase = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "sgpt" || h === "alt") && boundedNum(numVal, 5, 2500) !== null) {
            extractedValues.sgpt = numVal;
            structuredMedicalKeysCount++;
          }
          if ((h === "sgot" || h === "ast") && boundedNum(numVal, 5, 3000) !== null) {
            extractedValues.sgot = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "albumin" && boundedNum(numVal, 0.5, 6.5) !== null) {
            extractedValues.albumin = numVal;
            structuredMedicalKeysCount++;
          }
          if (h === "mmse" && boundedNum(numVal, 0, 30) !== null) {
            extractedValues.MMSE = numVal;
            structuredMedicalKeysCount++;
          }
        });
      }
    }
  } catch {
    // ignore optional JSON/CSV parse errors
  }

  // Recompute BMI if height and weight were extracted via JSON/CSV
  if (
    extractedValues.bmi === null &&
    extractedValues.height !== null &&
    extractedValues.weight !== null &&
    extractedValues.height > 45
  ) {
    const hM = extractedValues.height / 100;
    const computed = Number((extractedValues.weight / (hM * hM)).toFixed(1));
    if (computed >= 10 && computed <= 75) extractedValues.bmi = computed;
  }

  // Recount vitals/labs/demographics after JSON/CSV merge
  const vitalKeys = ["height", "weight", "bmi", "systolic_bp", "diastolic_bp", "heart_rate"];
  const labKeys = [
    "glucose",
    "cholesterol",
    "hemoglobin",
    "tsh",
    "t3",
    "tt4",
    "t4u",
    "fti",
    "creatinine",
    "urea",
    "sg",
    "albumin",
    "total_bilirubin",
    "direct_bilirubin",
    "alkaline_phosphotase",
    "sgpt",
    "sgot",
    "total_proteins",
    "ag_ratio",
    "radius_mean",
    "texture_mean",
    "perimeter_mean",
    "area_mean",
    "MDVP_Fo_Hz",
    "MDVP_Jitter_Percent",
    "MDVP_Shimmer",
    "HNR",
    "MMSE",
    "FunctionalAssessment",
  ];
  const demographicKeys = ["name", "patient_ref", "age", "sex"];

  const finalVitalCount = vitalKeys.filter(
    (k) => extractedValues[k] !== null && extractedValues[k] !== undefined,
  ).length;
  const finalLabCount = labKeys.filter(
    (k) => extractedValues[k] !== null && extractedValues[k] !== undefined,
  ).length;
  const finalDemogCount = demographicKeys.filter(
    (k) =>
      extractedValues[k] !== null &&
      extractedValues[k] !== undefined &&
      extractedValues[k] !== "",
  ).length;

  // 4. Validate whether the uploaded document is a genuine patient medical document & matches entered patient details
  const validation = validateUploadedPatientDocument({
    filename: sanitizedBase,
    lowerExt,
    lowerMime,
    rawText,
    extractedData: extractedValues,
    vitalCount: finalVitalCount,
    labCount: finalLabCount,
    demographicCount: finalDemogCount,
    symptomCount: extractedValues.symptoms?.length || 0,
    historyCount: extraction.historyCount,
    structuredMedicalKeysCount,
    recognizedFields: extraction.recognizedFields,
    existingPatientData: options?.existingPatientData,
    forceOverrideMismatch: options?.forceOverrideMismatch,
  });

  if (!validation.isValidPatientDocument) {
    serverLogger.warn("UPLOAD_VALIDATION_REJECTED", validation.reason, {
      filename: sanitizedBase,
      category: validation.documentCategory,
      classifierProbability: validation.classifierProbability,
      mismatchedFields: validation.mismatchedFields,
    });
    throw new DocumentValidationError(
      validation.reason,
      validation.isPatientMismatch ? "PATIENT_DETAILS_MISMATCH" : "INVALID_PATIENT_DOCUMENT",
      validation,
      extractedValues,
      400,
    );
  }

  // 5. Assign patient reference if not explicitly present in the validated document
  if (patientRef && !extractedValues.patient_ref) {
    extractedValues.patient_ref = patientRef;
  } else if (!extractedValues.patient_ref) {
    const hash = crypto.createHash("sha256").update(fileBuffer).digest();
    extractedValues.patient_ref = `PT-${100000 + (((hash[0] ?? 12) * 3571 + (hash[1] ?? 34) * 17) % 899999)}`;
  }

  // 6. Store validated patient document on disk and in SQLite database
  const uniqueFileId = crypto.randomUUID();
  const safeName = `${uniqueFileId}_${sanitizedBase}`;
  const baseStorageDir = process.env["STORAGE_DIR"]
    ? path.resolve(process.env["STORAGE_DIR"])
    : path.join(process.cwd(), ".data");
  const uploadDir = path.join(baseStorageDir, "uploads");

  let savedPath = "";
  try {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    savedPath = path.join(uploadDir, safeName);
    fs.writeFileSync(savedPath, fileBuffer);
  } catch (err) {
    serverLogger.error("UPLOAD_FAILURE", "Failed writing uploaded file to storage", {
      error: String(err),
    });
    savedPath = "in-memory";
  }

  const resolvedMime = mimeType || getFileTypeLabel(lowerExt, "");

  const reportRecord = serverDb.createMedicalReport({
    user_id: userId,
    filename: sanitizedBase,
    mime_type: resolvedMime,
    file_size: fileBuffer.length,
    storage_path: savedPath,
    extracted_data: extractedValues as unknown as Record<string, number | null>,
    text_content: rawText.slice(0, 5000),
    patient_ref: extractedValues.patient_ref || patientRef || null,
  });

  serverLogger.info("REPORT_PROCESSED", "Validated medical report processed and analyzed", {
    reportId: reportRecord.id,
    filename: sanitizedBase,
    recognizedFieldsCount: validation.recognizedFieldsCount,
    classifierProbability: validation.classifierProbability,
  });

  return {
    reportId: reportRecord.id,
    filename: reportRecord.filename,
    fileSize: reportRecord.file_size,
    mimeType: reportRecord.mime_type,
    fileTypeLabel: getFileTypeLabel(lowerExt, resolvedMime),
    status: "Uploaded & Extracted",
    extractionSuccess: true,
    textFound: true,
    extractedData: extractedValues,
    validation,
    message:
      "Successfully validated patient medical document, extracted clinical details, and evaluated all trained disease models.",
  };
}
