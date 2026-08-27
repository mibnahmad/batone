import { ZodType, ZodTypeDef } from 'zod';
import { ClarificationRequest, SourceRef } from '@batione/shared';

/** A parsed document made available to the model as grounding material. */
export interface AiDocumentContext {
  id: string;
  kind: string;
  format: string;
  name: string;
  floor?: string | null;
  /** Plain-text rendition produced by the document-processing pipeline. */
  text: string;
  pageCount: number;
  /** Structured entities (vector geometry, detected symbols) when available. */
  entities?: unknown;
}

export interface AiExtractionRequest<T> {
  /** Stable identifier of the extraction task, used for prompt selection and tracing. */
  task: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  /** JSON-schema-ish description handed to the model to constrain its output. */
  schemaName: string;
  instruction: string;
  documents: AiDocumentContext[];
  /** Extra grounding, e.g. current model state or the active rule set. */
  context?: Record<string, unknown>;
}

export interface AiExtractionResult<T> {
  items: T[];
  clarifications: ClarificationRequest[];
  /** Provider-level notes surfaced in the chat transcript. */
  notes: string[];
  provider: string;
  model: string;
}

export interface AiChatRequest {
  task: string;
  instruction: string;
  history: { role: 'user' | 'assistant' | 'system'; content: string }[];
  documents: AiDocumentContext[];
  context?: Record<string, unknown>;
}

export interface AiChatResult<T = unknown> {
  reply: string;
  /** A structured proposal (e.g. an EditProposal) when the instruction resolved. */
  proposal?: T;
  clarifications: ClarificationRequest[];
}

/**
 * Everything AI-driven in BatiOne goes through this interface, so swapping or
 * mixing models is a configuration concern rather than a code change.
 */
export interface AiProvider {
  readonly name: string;
  readonly model: string;

  /** Must return objects validating against `request.schema`, never free text. */
  extract<T>(request: AiExtractionRequest<T>): Promise<AiExtractionResult<T>>;

  /** Resolves a natural-language instruction against project state. */
  chat<T = unknown>(
    request: AiChatRequest,
    proposalSchema?: ZodType<T, ZodTypeDef, unknown>,
  ): Promise<AiChatResult<T>>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Helper shared by providers: a source ref pointing at a whole document page. */
export function documentRef(
  doc: AiDocumentContext,
  page = 1,
  excerpt?: string,
): SourceRef {
  return { documentId: doc.id, page, excerpt: excerpt?.slice(0, 500) };
}
