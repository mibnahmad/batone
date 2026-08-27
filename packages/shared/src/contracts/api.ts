/**
 * API-level DTO contracts shared by the NestJS backend and the React frontend.
 */
import { z } from 'zod';
import { serviceIdSchema } from '../domain/traceability';
import { DocumentKind, ExportFormat } from '../domain/pipeline';

export const UserRole = {
  ADMIN: 'admin',
  ENGINEER: 'engineer',
  ARCHITECT: 'architect',
  QUANTITY_SURVEYOR: 'quantity_surveyor',
  SITE_MANAGER: 'site_manager',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Mirrors the password-rule checklist rendered live on the signup card. */
export const PASSWORD_RULES = [
  { id: 'length', label: 'Au moins 8 caractères', test: (v: string) => v.length >= 8 },
  { id: 'upper', label: 'Une majuscule', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'Une minuscule', test: (v: string) => /[a-z]/.test(v) },
  { id: 'digit', label: 'Un chiffre', test: (v: string) => /\d/.test(v) },
] as const;

export const passwordSchema = z
  .string()
  .min(8, 'Au moins 8 caractères')
  .regex(/[A-Z]/, 'Une majuscule requise')
  .regex(/[a-z]/, 'Une minuscule requise')
  .regex(/\d/, 'Un chiffre requis');

export const registerSchema = z.object({
  organizationName: z.string().min(2),
  fullName: z.string().min(2),
  email: z.string().email(),
  password: passwordSchema,
  role: z.nativeEnum(UserRole).default(UserRole.ENGINEER),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const createProjectSchema = z.object({
  name: z.string().min(2),
  reference: z.string().optional(),
  client: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  services: z.array(serviceIdSchema).min(1),
});
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const uploadDocumentMetaSchema = z.object({
  kind: z.nativeEnum(DocumentKind),
  floor: z.string().optional(),
  label: z.string().optional(),
});
export type UploadDocumentMetaDto = z.infer<typeof uploadDocumentMetaSchema>;

export const runServiceSchema = z.object({
  service: serviceIdSchema,
  documentIds: z.array(z.string()).default([]),
  options: z.record(z.unknown()).default({}),
});
export type RunServiceDto = z.infer<typeof runServiceSchema>;

export const chatMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

export const answerClarificationSchema = z.object({
  answer: z.string().min(1),
});
export type AnswerClarificationDto = z.infer<typeof answerClarificationSchema>;

export const correctionSchema = z.object({
  field: z.string().min(1),
  value: z.unknown(),
  reason: z.string().max(2000).optional(),
});
export type CorrectionDto = z.infer<typeof correctionSchema>;

export const exportRequestSchema = z.object({
  service: serviceIdSchema,
  format: z.nativeEnum(ExportFormat),
});
export type ExportRequestDto = z.infer<typeof exportRequestSchema>;

export type EntitlementView = {
  service: string;
  label: string;
  unit: string;
  quotaTotal: number;
  quotaUsed: number;
  status: 'active' | 'exhausted' | 'inactive';
  periodEnd: string | null;
};
