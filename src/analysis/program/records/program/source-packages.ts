import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustSourcePackageFacadePlan, RustSourcePackageEmissionRecords, RustWorkerEntryEmission } from "../../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageComponentPlan } from "../../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageInitializerPlan } from "../../../../target-model/records/program/source-packages.js";
import type { RustSourcePackageErrorPlan, RustSourcePackageErrorBoundary } from "../../../../target-model/records/errors/source-package-errors.js";
import type { RustSourcePackageErrorRoute } from "../../../../target-model/records/errors/source-package-errors.js";
import type { RustProjectTypeDefinition } from "../../../../target-model/types/project-types.js";
import type { RustProgramErrorOwner } from "../../../../target-model/types/model.js";
import type { RustProgramEmission } from "../../../../target-model/records/program/program-emission.js";
import type { RustSignatureVisibility } from "../../../../target-model/records/types/signature-visibility.js";
import type { RustPackageCargoEmission } from "../../../../target-model/records/program/source-package-crates.js";

export function createRustSourcePackageEmissionProducer(assertOpen: () => void) {
  let facades: RustSourcePackageFacadePlan | undefined;
  let components: readonly RustSourcePackageComponentPlan[] | undefined;
  let initializers: RustSourcePackageInitializerPlan | undefined;
  let errors: RustSourcePackageErrorPlan | undefined;
  let workers: readonly RustWorkerEntryEmission[] | undefined;
  let program: RustProgramEmission | undefined;
  let cargo: RustPackageCargoEmission | undefined;
  const visibility = new Map<string, RustSignatureVisibility>();
  const boundaries = new Map<string, Map<string, RustSourcePackageErrorBoundary>>();
  const physical = new Map<string, Map<string, RustSourcePackageErrorBoundary>>();
  const runtime = new Map<string, RustSourcePackageErrorBoundary>();
  const routes = new Map<string, WeakMap<RustProjectTypeDefinition, Map<string, RustSourcePackageErrorRoute>>>();
  const admitBoundary = (table: Map<string, Map<string, RustSourcePackageErrorBoundary>>,
    consumer: string, owner: string, value: RustSourcePackageErrorBoundary): void => {
    assertOpen();
    const selected = table.get(consumer) ?? new Map<string, RustSourcePackageErrorBoundary>();
    if (selected.has(owner)) failTargetAnalysisInvariant("tsonic-rust", "A native error boundary has one exact source owner.");
    selected.set(owner, Object.freeze(value));
    table.set(consumer, selected);
  };
  const records: RustSourcePackageEmissionRecords = Object.freeze({
    workerEntries: Object.freeze({ get: () => workers }),
    programEmission: Object.freeze({ get: () => program }),
    packageCargo: Object.freeze({ get: () => cargo }),
    signatureVisibility: Object.freeze({ get: (component: string) => visibility.get(component) }),
    sourcePackageInitializers: Object.freeze({ get: () => initializers }),
    sourcePackageErrors: Object.freeze({ get: () => errors }),
    sourcePackageErrorBoundary: Object.freeze({ get: (consumer: string, owner: string) => boundaries.get(consumer)?.get(owner) }),
    physicalProgramErrorBoundary: Object.freeze({ get: (consumer: string, owner: RustProgramErrorOwner | undefined) =>
      owner?.kind !== "physical" ? undefined : owner.domain === "runtime" ? runtime.get(consumer) : physical.get(consumer)?.get(owner.componentId) }),
    programErrorRoute: Object.freeze({ get: (consumer: string, definition: RustProjectTypeDefinition, variant: string) =>
      routes.get(consumer)?.get(definition)?.get(variant) }),
    sourcePackageComponents: Object.freeze({ get: () => components }),
    sourcePackageFacades: Object.freeze({ get: () => facades }),
  });
  return Object.freeze({ records,
    cargo(value: RustPackageCargoEmission): void {
      assertOpen();
      if (cargo !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native package manifests have one exact component owner.");
      cargo = Object.freeze(value);
    },
    visibility(component: string, value: RustSignatureVisibility): void {
      assertOpen();
      if (visibility.has(component)) failTargetAnalysisInvariant("tsonic-rust", "A component native signature surface has one closed source owner.");
      visibility.set(component, Object.freeze(value));
    },
    program(value: RustProgramEmission): void {
      assertOpen();
      if (program !== undefined) failTargetAnalysisInvariant("tsonic-rust", "A program has one exact sealed native output contract.");
      program = Object.freeze(value);
    },
    workers(value: readonly RustWorkerEntryEmission[]): void {
      assertOpen();
      if (workers !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Worker entries have one exact closed source inventory.");
      workers = Object.freeze(value);
    },
    initializers(value: RustSourcePackageInitializerPlan): void {
      assertOpen();
      if (initializers !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package initializer paths have one owner.");
      initializers = Object.freeze(value);
    },
    errors(value: RustSourcePackageErrorPlan): void {
      assertOpen();
      if (errors !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package error domains have one owner.");
      errors = Object.freeze(value);
    },
    boundary(consumer: string, owner: string, value: RustSourcePackageErrorBoundary): void {
      admitBoundary(boundaries, consumer, owner, value);
    },
    physicalBoundary(consumer: string, owner: string, value: RustSourcePackageErrorBoundary): void {
      admitBoundary(physical, consumer, owner, value);
    },
    runtimeBoundary(consumer: string, value: RustSourcePackageErrorBoundary): void {
      assertOpen();
      if (runtime.has(consumer)) failTargetAnalysisInvariant("tsonic-rust", "A native runtime error boundary has one exact source owner.");
      runtime.set(consumer, Object.freeze(value));
    },
    route(consumer: string, definition: RustProjectTypeDefinition, variant: string, value: RustSourcePackageErrorRoute): void {
      assertOpen();
      const declarations = routes.get(consumer) ?? new WeakMap<RustProjectTypeDefinition, Map<string, RustSourcePackageErrorRoute>>();
      const selected = declarations.get(definition) ?? new Map<string, RustSourcePackageErrorRoute>();
      if (selected.has(variant)) failTargetAnalysisInvariant("tsonic-rust", "A project error route has one exact native owner.", definition.declaration);
      selected.set(variant, Object.freeze(value));
      declarations.set(definition, selected);
      routes.set(consumer, declarations);
    },
    components(value: readonly RustSourcePackageComponentPlan[]): void {
      assertOpen();
      if (components !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package components have one owner.");
      components = Object.freeze(value);
    },
    facades(value: RustSourcePackageFacadePlan): void {
      assertOpen();
      if (facades !== undefined) failTargetAnalysisInvariant("tsonic-rust", "Native source-package facade paths have one owner.");
      facades = Object.freeze(value);
    },
  });
}

export type RustSourcePackageEmissionProducer = ReturnType<typeof createRustSourcePackageEmissionProducer>;
