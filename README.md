# BatiOne Construction — plateforme SaaS BTP assistée par IA

Monorepo applicatif implémentant les **quatre services vendables indépendamment** de BatiOne
Construction, au-dessus d'une couche de plateforme commune (comptes, projets, documents,
abonnements, traçabilité, exports).

| # | Service | Entrées | Sortie |
|---|---------|---------|--------|
| 1 | **Métré automatisé** | plans (DXF/PDF/images) + CCTP obligatoire | tableau de métré, chaque ligne rattachée à ses clauses du CCTP |
| 2 | **2D → 3D** | plans par niveau | maquette 3D éditable en langage naturel (proposition → confirmation → application, undo/redo) |
| 3 | **Métré ferraillage** | coupes structurelles | aciers par élément et par diamètre, calculés par un moteur de règles versionné |
| 4 | **Étude de prix** | bordereau de quantités (CSV/XLSX) ou reprise du métré | décomposition coût direct → frais généraux → marge → TVA → prix final |

---

## 1. La règle fondamentale, imposée par l'architecture

> L'IA ne doit **jamais** inventer une valeur technique manquante.

Cette règle n'est pas une consigne de prompt : elle est vérifiée à trois endroits distincts.

1. **Contrat (`packages/shared`)** — `tracedValueSchema` refuse au parsing une valeur déclarée
   `certain` sans `SourceRef`. Une extraction non conforme n'entre pas dans le domaine.
2. **Exécution (`apps/api/src/ai/ai-gateway.service.ts`)** — `enforceSourceBinding` parcourt
   récursivement la sortie du modèle et **rétrograde** tout `certain` non lié en `deduced`.
3. **Persistance (`apps/api/src/common/traceability.service.ts`)** — `assertTraceable` lève une
   exception si une valeur `certain` sans source atteint la base.

S'y ajoutent :

- **Séparation compréhension / calcul** — le LLM lit les documents et résout les instructions en
  langue naturelle ; **toute l'arithmétique** des services 1, 3 et 4 passe par des moteurs
  déterministes (`apps/api/src/rules/`) qui estampillent `ruleId@ruleVersion` et publient la
  formule littérale employée (`computation`, `formula`).
- **Moteur de clarification** — une donnée manquante ou contradictoire ne produit pas une valeur,
  mais une `ClarificationQuestion` ; la ligne concernée est marquée `blocked` et le job se termine
  en `BLOCKED` (jamais `SUCCEEDED`) tant que la question est ouverte.
- **Corrections append-only** — une correction humaine passe `user_confirmed` et **ajoute** une
  entrée à `correctionHistory` ; une ré-analyse ne réécrit jamais une valeur confirmée, elle
  consigne la divergence.

Les tests `npm test` couvrent explicitement ces invariants.

---

## 2. Démarrage local

Prérequis : Node ≥ 20, Docker.

```bash
npm install
npm run bootstrap   # docker compose up + build shared + prisma db push + seed
npm run dev         # API sur :3001, front sur :5173
```

Identifiants de démonstration : **demo@batione.fr** / **Demo1234!**

Le seed crée l'organisation « BatiOne Démo », les quatre `ServiceEntitlement` (30/30/20/50) et le
projet **« Villa R+1 — Aïn Diab »** avec cinq documents réels (deux plans DXF, une coupe
structurelle DXF, un CCTP PDF, un bordereau CSV) — ces fichiers sont générés puis **injectés par
le vrai pipeline d'upload et de parsing**, pas insérés en base.

### Ports (volontairement non standards, pour cohabiter avec d'autres projets)

| Service | Port |
|---------|------|
| PostgreSQL (pgvector) | `55432` |
| Redis | `56379` |
| API | `3001` |
| Front (Vite) | `5173` |

### Sans clé API

`ANTHROPIC_API_KEY` vide (défaut) ⇒ le `LocalInferenceProvider` prend la main : lecture géométrique
réelle des DXF, extraction texte du PDF, minage d'expressions métier (épaisseurs, hauteurs, appels
d'armatures). Tout fonctionne **hors ligne et de façon reproductible**. Renseigner la clé bascule
sur `AnthropicProvider` (tool-use, JSON structuré) sans changer une ligne de service.

---

## 3. Structure

```
packages/shared      contrats zod, SourceRef / ConfidenceLevel, enums, DTO API
apps/api             NestJS + Prisma + PostgreSQL + BullMQ
  src/common         prisma, storage, audit, traceability (garde-fou central)
  src/auth           JWT, organisations, rôles
  src/entitlements   quotas par service (blocage isolé, 402 quota_exhausted)
  src/documents      upload + parseurs DXF / PDF / OCR + normalisation d'unités
  src/ai             AI Gateway, providers, moteur de clarification, heuristiques
  src/rules          jeux de règles versionnés + calculateurs déterministes
  src/jobs           file d'attente, étapes du pipeline, progression SSE
  src/services       les 4 moteurs métier
  src/chat           une session par (projet, service), réponses ancrées dans l'état persisté
  src/exports        XLSX (ExcelJS), PDF (pdfkit), glTF / GLB / OBJ (écrivain maison)
apps/web             React + Vite + Tailwind + TanStack Query + Zustand + three.js
infra                docker-compose (postgres pgvector, redis)
```

### Pipeline commun aux quatre services

`Importation → Analyse → Cahier des charges / Règles → Détection → Génération → Vérification → Terminé`

Le même stepper sert d'indicateur d'avancement des jobs asynchrones dans les quatre espaces de
travail, alimenté par SSE.

---

## 4. Commandes

| Commande | Effet |
|----------|-------|
| `npm run infra:up` / `infra:down` / `infra:reset` | conteneurs Postgres + Redis |
| `npm run db:push` | applique le schéma Prisma |
| `npm run db:seed` | recrée le jeu de démonstration |
| `npm run dev` | API + front en watch |
| `npm run build` | build shared → api → web |
| `npm test` | tests des moteurs déterministes et de la traçabilité |
| `npm run lint` | ESLint api + web |

---

## 5. Limites explicitées dans le produit

Chaque espace de travail affiche l'avertissement propre à son service :

- le métré est une **aide à la quantification**, il ne remplace pas la vérification d'un métreur ;
- la 3D est une **visualisation pré-construction**, ni plan d'exécution ni garantie réglementaire ;
- le ferraillage suit les **règles paramétrées par BatiOne**, il ne remplace pas une note de calcul
  signée par un ingénieur ;
- l'étude de prix n'est **pas un engagement commercial**.

**DWG** n'est volontairement pas supporté (SDK commercial requis) : le fichier est accepté,
rattaché au projet, et signalé par un avertissement invitant à fournir un DXF.
# batone
