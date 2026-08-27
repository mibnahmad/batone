import type {
  ConfidenceLevel,
  CorrectionEntry,
  Element3DType,
  JobStatus,
  PipelineStep,
  PriceBreakdown,
  ServiceId,
  SourceRef,
  StructuralElementType,
  TakeoffUnit,
  UserRole,
} from '@batione/shared';

/* ------------------------------------------------------------------ */
/* Platform                                                            */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  role: UserRole | string;
  provider: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
  organization: Organization;
}

export interface MeResponse {
  user: User;
  organization: Organization;
}

export interface Project {
  id: string;
  organizationId: string;
  createdById: string;
  name: string;
  reference?: string | null;
  client?: string | null;
  location?: string | null;
  description?: string | null;
  services: ServiceId[];
  createdAt: string;
  updatedAt: string;
}

export type DocumentParseStatus = 'pending' | 'parsing' | 'parsed' | 'failed';

export interface ProjectDocument {
  id: string;
  projectId: string;
  kind: string;
  format: string;
  originalName: string;
  storageKey: string;
  sizeBytes: number;
  floor?: string | null;
  label?: string | null;
  orderIndex: number;
  parseStatus: DocumentParseStatus;
  parseError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  service: ServiceId;
  type: string;
  status: JobStatus;
  step: PipelineStep;
  progress: number;
  message?: string | null;
  error?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Clarifications                                                      */
/* ------------------------------------------------------------------ */

export type ClarificationStatusValue = 'open' | 'answered' | 'dismissed';

export interface Clarification {
  id: string;
  projectId: string;
  service: ServiceId;
  kind: string;
  targetPath: string;
  question: string;
  options: string[];
  sourceRefs: SourceRef[];
  status: ClarificationStatusValue;
  answer?: string | null;
  answeredBy?: string | null;
  answeredAt?: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export interface ChatDiffEntry {
  externalId: string;
  property: string;
  before: unknown;
  after: unknown;
}

export interface ChatProposal {
  instruction?: string;
  summary: string;
  affectedCount: number;
  diff: ChatDiffEntry[];
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  entityRefs?: unknown;
  proposal?: ChatProposal | null;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  projectId: string;
  service: ServiceId;
  title: string;
}

export interface ChatResponse {
  session: ChatSession;
  messages: ChatMessage[];
}

export interface ChatPostResponse {
  messages: ChatMessage[];
  proposal?: ChatProposal | null;
}

/* ------------------------------------------------------------------ */
/* Takeoff (service 1)                                                 */
/* ------------------------------------------------------------------ */

export interface TracedDimension {
  name: string;
  value: number;
  unit: string;
}

export interface TakeoffLine {
  id: string;
  projectId: string;
  ouvrage: string;
  description: string;
  category: string;
  unit: TakeoffUnit | string;
  floor: string;
  quantity?: number | null;
  dimensions: TracedDimension[];
  confidence: ConfidenceLevel;
  score?: number | null;
  sourceRefs: SourceRef[];
  clauseIds: string[];
  blocked: boolean;
  correctionHistory: CorrectionEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface CctpClause {
  id: string;
  projectId: string;
  documentId: string;
  reference: string;
  title: string;
  text: string;
  extractedRule?: string | null;
  category: string;
  page?: number | null;
}

export interface TakeoffSummaryRow {
  unit: string;
  total: number;
}

export interface TakeoffResponse {
  lines: TakeoffLine[];
  clauses: CctpClause[];
  summary: TakeoffSummaryRow[];
}

/* ------------------------------------------------------------------ */
/* Model3D (service 2)                                                 */
/* ------------------------------------------------------------------ */

export interface BoxGeometry {
  kind: 'box';
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
}

export interface Element3DEntity {
  id: string;
  modelId: string;
  externalId: string;
  type: Element3DType | string;
  name: string;
  floor: string;
  geometry: BoxGeometry;
  material: string;
  attributes: Record<string, unknown>;
  visible: boolean;
  confidence: ConfidenceLevel;
  sourceRefs: SourceRef[];
  correctionHistory: CorrectionEntry[];
}

export interface Model3DEntity {
  id: string;
  projectId: string;
  version: number;
  floors: string[];
  status: string;
}

export interface EditHistoryEntry {
  id: string;
  modelId: string;
  sequence: number;
  instructionNl?: string | null;
  summary: string;
  appliedBy: string;
  undone: boolean;
  createdAt: string;
}

export interface Model3DResponse {
  model: Model3DEntity | null;
  elements: Element3DEntity[];
  history: EditHistoryEntry[];
}

/* ------------------------------------------------------------------ */
/* Rebar (service 3)                                                   */
/* ------------------------------------------------------------------ */

export interface RebarCallout {
  raw: { value: string; confidence: ConfidenceLevel };
  role: string;
  diameterMm?: { value: number; confidence: ConfidenceLevel };
  count?: { value: number; confidence: ConfidenceLevel };
  spacingM?: { value: number; confidence: ConfidenceLevel };
}

export interface StructuralElement {
  id: string;
  projectId: string;
  reference: string;
  type: StructuralElementType | string;
  floor: string;
  count: number;
  dimensions: Record<string, { value: number; confidence: ConfidenceLevel; unit?: string }>;
  callouts: RebarCallout[];
  confidence: ConfidenceLevel;
  sourceRefs: SourceRef[];
  blocked: boolean;
  correctionHistory: CorrectionEntry[];
}

export interface RebarLineEntity {
  id: string;
  structuralElementId: string;
  role: string;
  diameterMm: number;
  unitLengthM: number;
  count: number;
  totalLengthM: number;
  unitMassKgPerM: number;
  totalWeightKg: number;
  ruleId: string;
  ruleVersion: string;
  computation: string;
  confidence: ConfidenceLevel;
  sourceRefs: SourceRef[];
}

export interface RebarDiameterTotal {
  diameterMm: number;
  totalLengthM: number;
  totalWeightKg: number;
}

export interface RebarTotals {
  byDiameter: RebarDiameterTotal[];
  grandTotalWeightKg: number;
}

export interface RebarResponse {
  elements: StructuralElement[];
  lines: RebarLineEntity[];
  totals: RebarTotals;
}

/* ------------------------------------------------------------------ */
/* Price study (service 4)                                             */
/* ------------------------------------------------------------------ */

export interface PriceItem {
  id: string;
  studyId: string;
  code: string;
  designation: string;
  category: string;
  unit: string;
  quantity: number;
  unitPriceMaterials: number;
  unitPriceLabour: number;
  unitPriceEquipment: number;
  totalMaterials: number;
  totalLabour: number;
  totalEquipment: number;
  total: number;
  confidence: ConfidenceLevel;
  sourceRefs: SourceRef[];
  correctionHistory: CorrectionEntry[];
  orderIndex: number;
}

export interface PriceStudyEntity {
  id: string;
  projectId: string;
  name: string;
  currency: string;
  ruleSetId?: string | null;
  breakdown?: PriceBreakdown | null;
}

export interface PriceStudyResponse {
  study: PriceStudyEntity | null;
  items: PriceItem[];
  breakdown: PriceBreakdown | null;
}

/* ------------------------------------------------------------------ */
/* Exports & audit                                                     */
/* ------------------------------------------------------------------ */

export interface ExportArtifact {
  id: string;
  filename: string;
  url: string;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  projectId?: string | null;
  actorId?: string | null;
  actorType: string;
  service?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: unknown;
  createdAt: string;
}
