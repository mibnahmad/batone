import { z } from 'zod';
import { ServiceId } from './traceability';

/**
 * All four services share the same pipeline shape, which the UI renders as a
 * numbered horizontal stepper that doubles as async job-status display.
 */
export const PipelineStep = {
  IMPORT: 'import',
  ANALYSIS_2D: 'analysis_2d',
  SPECIFICATIONS: 'specifications',
  DETECTION: 'detection',
  GENERATION: 'generation',
  VERIFICATION: 'verification',
  DONE: 'done',
} as const;
export type PipelineStep = (typeof PipelineStep)[keyof typeof PipelineStep];

export const PIPELINE_ORDER: PipelineStep[] = [
  PipelineStep.IMPORT,
  PipelineStep.ANALYSIS_2D,
  PipelineStep.SPECIFICATIONS,
  PipelineStep.DETECTION,
  PipelineStep.GENERATION,
  PipelineStep.VERIFICATION,
  PipelineStep.DONE,
];

/** Per-service labels for the shared stepper component. */
export const PIPELINE_LABELS: Record<ServiceId, Record<PipelineStep, string>> = {
  takeoff: {
    import: 'Importation',
    analysis_2d: 'Analyse 2D',
    specifications: 'Cahier des charges',
    detection: 'Détection ouvrages',
    generation: 'Génération métré',
    verification: 'Vérification',
    done: 'Terminé',
  },
  model3d: {
    import: 'Importation',
    analysis_2d: 'Analyse 2D',
    specifications: 'Cahier des charges',
    detection: 'Détection',
    generation: 'Génération 3D',
    verification: 'Vérification',
    done: 'Terminé',
  },
  rebar: {
    import: 'Importation',
    analysis_2d: 'Analyse des coupes',
    specifications: 'Règles de calcul',
    detection: 'Détection armatures',
    generation: 'Calcul ferraillage',
    verification: 'Vérification',
    done: 'Terminé',
  },
  price_study: {
    import: 'Importation',
    analysis_2d: 'Analyse quantités',
    specifications: 'Formules & taux',
    detection: 'Rapprochement postes',
    generation: 'Calcul du prix',
    verification: 'Vérification',
    done: 'Terminé',
  },
};

export const JobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  BLOCKED: 'blocked',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const jobProgressSchema = z.object({
  jobId: z.string(),
  projectId: z.string(),
  service: z.nativeEnum(ServiceId),
  status: z.nativeEnum(JobStatus),
  step: z.nativeEnum(PipelineStep),
  /** 0..100 within the whole pipeline. */
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  error: z.string().optional(),
  /** Number of clarification questions currently blocking finalization. */
  openClarifications: z.number().int().nonnegative().default(0),
  updatedAt: z.string(),
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export const DocumentKind = {
  PLAN: 'plan',
  CCTP: 'cctp',
  SECTION: 'coupe',
  QUANTITIES: 'quantities',
  OTHER: 'other',
} as const;
export type DocumentKind = (typeof DocumentKind)[keyof typeof DocumentKind];

export const SUPPORTED_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.dwg',
  '.dxf',
  '.jpg',
  '.jpeg',
  '.png',
  '.xlsx',
  '.csv',
] as const;

export const ExportFormat = {
  XLSX: 'xlsx',
  PDF: 'pdf',
  GLB: 'glb',
  GLTF: 'gltf',
  OBJ: 'obj',
} as const;
export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const SERVICE_EXPORT_FORMATS: Record<ServiceId, ExportFormat[]> = {
  takeoff: [ExportFormat.XLSX, ExportFormat.PDF],
  model3d: [ExportFormat.GLB, ExportFormat.GLTF, ExportFormat.OBJ, ExportFormat.PDF],
  rebar: [ExportFormat.XLSX, ExportFormat.PDF],
  price_study: [ExportFormat.XLSX, ExportFormat.PDF],
};

/**
 * Product-mandated disclaimers. Each service must surface what it does NOT guarantee.
 */
export const SERVICE_DISCLAIMERS: Record<ServiceId, string> = {
  takeoff:
    "Le métré généré est une aide à la quantification. Il ne remplace pas la vérification d'un métreur ni la validation contractuelle des quantités.",
  model3d:
    "Visualisation pré-construction uniquement. Le modèle 3D ne constitue ni un plan d'exécution, ni une garantie de conformité réglementaire.",
  rebar:
    "Les quantités d'acier sont calculées selon les règles paramétrées par BatiOne. Elles ne remplacent pas une note de calcul de structure signée par un ingénieur.",
  price_study:
    "L'étude de prix repose sur les quantités et prix unitaires saisis. Elle ne constitue pas un engagement commercial ni une offre contractuelle.",
};
