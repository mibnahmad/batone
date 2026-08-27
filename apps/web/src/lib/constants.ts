import { UserRole } from '@batione/shared';
import type { ServiceId } from '@batione/shared';
import {
  Boxes,
  Calculator,
  Grid3x3,
  Ruler,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const ROLE_LABELS: Record<string, string> = {
  [UserRole.ADMIN]: 'Administrateur',
  [UserRole.ENGINEER]: 'Ingénieur',
  [UserRole.ARCHITECT]: 'Architecte',
  [UserRole.QUANTITY_SURVEYOR]: 'Métreur',
  [UserRole.SITE_MANAGER]: 'Conducteur de travaux',
};

export const ROLE_OPTIONS = Object.values(UserRole).map((value) => ({
  value,
  label: ROLE_LABELS[value] ?? value,
}));

export const SERVICE_ICONS: Record<ServiceId, LucideIcon> = {
  takeoff: Ruler,
  model3d: Boxes,
  rebar: Grid3x3,
  price_study: Calculator,
};
