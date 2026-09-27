import type { DiseaseMetadata, DiseasePredictionService } from "./base";
import { HeartDiseaseService, heartMetadata } from "./heart";
import { DiabetesService, diabetesMetadata } from "./diabetes";
import { BreastCancerService, breastCancerMetadata } from "./breast_cancer";
import { KidneyDiseaseService, kidneyMetadata } from "./kidney";
import { LiverDiseaseService, liverMetadata } from "./liver";
import { StrokeService, strokeMetadata } from "./stroke";
import { ParkinsonsService, parkinsonsMetadata } from "./parkinsons";
import { ThyroidService, thyroidMetadata } from "./thyroid";
import { LungCancerService, lungCancerMetadata } from "./lung_cancer";
import { AlzheimersService, alzheimersMetadata } from "./alzheimers";

export const DISEASE_SERVICES: Record<string, () => DiseasePredictionService> = {
  heart_disease: () => new HeartDiseaseService(),
  diabetes: () => new DiabetesService(),
  breast_cancer: () => new BreastCancerService(),
  kidney_disease: () => new KidneyDiseaseService(),
  liver_disease: () => new LiverDiseaseService(),
  stroke: () => new StrokeService(),
  parkinsons: () => new ParkinsonsService(),
  thyroid: () => new ThyroidService(),
  lung_cancer: () => new LungCancerService(),
  alzheimers: () => new AlzheimersService(),
};

export const ALL_DISEASE_METADATA: DiseaseMetadata[] = [
  heartMetadata,
  diabetesMetadata,
  breastCancerMetadata,
  kidneyMetadata,
  liverMetadata,
  strokeMetadata,
  parkinsonsMetadata,
  thyroidMetadata,
  lungCancerMetadata,
  alzheimersMetadata,
];

export function getDiseaseService(diseaseKey: string): DiseasePredictionService | null {
  const normalized = diseaseKey
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[\s_-]+/g, "_");
  const keyMap: Record<string, string> = {
    heart: "heart_disease",
    heart_disease: "heart_disease",
    diabetes: "diabetes",
    breast_cancer: "breast_cancer",
    breastcancer: "breast_cancer",
    kidney: "kidney_disease",
    kidney_disease: "kidney_disease",
    liver: "liver_disease",
    liver_disease: "liver_disease",
    stroke: "stroke",
    stroke_disease: "stroke",
    parkinsons: "parkinsons",
    parkinson: "parkinsons",
    parkinsons_disease: "parkinsons",
    thyroid: "thyroid",
    thyroid_disease: "thyroid",
    lung_cancer: "lung_cancer",
    lungcancer: "lung_cancer",
    alzheimers: "alzheimers",
    alzheimer: "alzheimers",
    alzheimers_disease: "alzheimers",
  };

  const matchedKey = keyMap[normalized];
  if (matchedKey && DISEASE_SERVICES[matchedKey]) {
    return DISEASE_SERVICES[matchedKey]();
  }
  return null;
}

export function getAllServices(): DiseasePredictionService[] {
  return Object.values(DISEASE_SERVICES).map((factory) => factory());
}
