/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentKind, ServiceId, SERVICE_IDS } from '@batione/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { DocumentsService } from '../src/documents/documents.service';
import type { AuthUser } from '../src/auth/auth.decorators';
import {
  asUploadedFile,
  cctpDocument,
  firstFloorPlan,
  groundFloorPlan,
  quantitiesBordereau,
  structuralSection,
} from './sample-documents';

const DEMO_EMAIL = 'demo@batione.fr';
const DEMO_PASSWORD = 'Demo1234!';

/**
 * Boots the real Nest context so the demo data goes through the same upload and
 * document-processing path as a user upload — a seed that bypassed the pipeline
 * would produce documents the services cannot actually read.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = app.get(PrismaService);
  const auth = app.get(AuthService);
  const documents = app.get(DocumentsService);
  const logger = new Logger('Seed');

  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    logger.log(`Le compte de démonstration existe déjà (${DEMO_EMAIL}) — réinitialisation.`);
    await prisma.organization.delete({ where: { id: existing.organizationId } });
  }

  const session = await auth.register({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    fullName: 'Amine Bensalah',
    organizationName: 'BatiOne Démo',
    role: 'engineer',
  });

  const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_EMAIL } });
  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
  };

  const project = await prisma.project.create({
    data: {
      organizationId: user.organizationId,
      createdById: user.id,
      name: 'Villa R+1 — Aïn Diab',
      reference: 'BAT-2024-018',
      client: 'SCI Atlas Résidences',
      location: 'Casablanca, Maroc',
      description:
        'Villa individuelle R+1, gros œuvre et second œuvre. Projet de démonstration comportant les quatre services.',
      services: [...SERVICE_IDS],
    },
  });

  const uploads: {
    kind: DocumentKind;
    floor?: string;
    label: string;
    file: Awaited<ReturnType<typeof buildFile>>;
  }[] = [
    {
      kind: DocumentKind.PLAN,
      floor: 'RDC',
      label: 'Plan du rez-de-chaussée',
      file: await buildFile(groundFloorPlan()),
    },
    {
      kind: DocumentKind.PLAN,
      floor: 'R+1',
      label: 'Plan du premier étage',
      file: await buildFile(firstFloorPlan()),
    },
    {
      kind: DocumentKind.SECTION,
      label: 'Coupes structure et ferraillage',
      file: await buildFile(structuralSection()),
    },
    {
      kind: DocumentKind.CCTP,
      label: 'Cahier des charges (CCTP)',
      file: await buildFile(await cctpDocument()),
    },
    {
      kind: DocumentKind.QUANTITIES,
      label: 'Bordereau de quantités',
      file: await buildFile(quantitiesBordereau()),
    },
  ];

  for (const upload of uploads) {
    const document = await documents.upload(project.id, authUser, upload.file, {
      kind: upload.kind,
      floor: upload.floor,
      label: upload.label,
    });
    logger.log(`Document importé : ${upload.label} (${document.id})`);
  }

  // Give the asynchronous parsing a moment to settle before reporting status.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const parsed = await prisma.projectDocument.findMany({
    where: { projectId: project.id },
    select: { originalName: true, parseStatus: true, parseError: true },
  });

  console.log('\n────────────────────────────────────────────────────────');
  console.log('  Jeu de démonstration BatiOne prêt');
  console.log('────────────────────────────────────────────────────────');
  console.log(`  Compte      : ${DEMO_EMAIL}`);
  console.log(`  Mot de passe: ${DEMO_PASSWORD}`);
  console.log(`  Organisation: ${session.organization?.name ?? 'BatiOne Démo'}`);
  console.log(`  Projet      : ${project.name} (${project.id})`);
  console.log('  Documents   :');
  for (const document of parsed) {
    console.log(
      `    - ${document.originalName} → ${document.parseStatus}${
        document.parseError ? ` (${document.parseError})` : ''
      }`,
    );
  }
  console.log('  Quotas      :');
  for (const service of SERVICE_IDS) {
    const entitlement = await prisma.serviceEntitlement.findFirst({
      where: { service, subscription: { organizationId: user.organizationId } },
    });
    console.log(
      `    - ${service.padEnd(12)} ${entitlement?.quotaUsed ?? 0}/${entitlement?.quotaTotal ?? 0}`,
    );
  }
  console.log('────────────────────────────────────────────────────────');
  console.log('  Lancez ensuite une analyse depuis chaque espace de travail.');
  console.log('────────────────────────────────────────────────────────\n');

  void (ServiceId.TAKEOFF as string);
  await app.close();
}

async function buildFile(sample: { filename: string; buffer: Buffer }) {
  return asUploadedFile(sample);
}

main().catch((error) => {
  console.error('Échec du seed :', error);
  process.exit(1);
});
