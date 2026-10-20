import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustSourcePackageFacadePlan, RustSourcePackageEmissionRecords } from "../../../target-model/records/source-packages.js";
import type { RustSourcePackageComponentPlan } from "../../../target-model/records/source-packages.js";
import type { RustSourcePackageErrorPlan, RustSourcePackageErrorBoundary, RustProgramErrorRoute } from "../../../target-model/records/source-package-errors.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import type { RustProgramErrorOwner } from "../../../target-model/types/model.js";

export function createRustSourcePackageEmissionProducer(assertOpen: () => void) {
  let facades: RustSourcePackageFacadePlan | undefined;
  let components: readonly RustSourcePackageComponentPlan[] | undefined;
  let errors: RustSourcePackageErrorPlan | undefined;
  const boundaries = new Map<string, Map<string, RustSourcePackageErrorBoundary>>();
  const physical = new Map<string, Map<string, RustSourcePackageErrorBoundary>>();
  const runtime = new Map<string, RustSourcePackageErrorBoundary>();
  const routes = new Map<string, WeakMap<RustProjectTypeDefinition, Map<string, RustProgramErrorRoute>>>();
  const admitBoundary = (table: Map<string, Map<string, RustSourcePackageErrorBoundary>>,
    consumer: string, owner: string, value: RustSourcePackageErrorBoundary): void => {
    assertOpen();
    const selected = table.get(consumer) ?? new Map<string, RustSourcePackageErrorBoundary>();
    if (selected.has(owner)) failTargetAnalysisInvariant("tsonic-rust", "A native error boundary has one exact source owner.");
    selected.set(owner, Object.freeze(value));
    table.set(consumer, selected);
  };
  const records: RustSourcePackageEmissionRecords = Object.freeze({
    sourcePackageErrors: Object.freeze({ get: () => errors }),
    sourcePackageErrorBoundary: Object.freeze({ get: (consumer: string, owner: string) => boundaries.get(consumer)?.get(owner) }),
    physicalProgramErrorBoundary: Object.freeze({ get: (consumer: string, owner: RustProgramErrorOwner) =>
      owner.kind !== "physical" ? undefined : owner.domain === "runtime" ? runtime.get(consumer) : physical.get(consumer)?.get(owner.componentId) }),
    programErrorRoute: Object.freeze({ get: (consumer: string, definition: RustProjectTypeDefinition, variant: string) =>
      routes.get(consumer)?.get(definition)?.get(variant) }),
    sourcePackageComponents: Object.freeze({ get: () => components }),
    sourcePackageFacades: Object.freeze({ get: () => facades }),
  });
  return Object.freeze({ records,
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
    route(consumer: string, definition: RustProjectTypeDefinition, variant: string, value: RustProgramErrorRoute): void {
      assertOpen();
      const declarations = routes.get(consumer) ?? new WeakMap<RustProjectTypeDefinition, Map<string, RustProgramErrorRoute>>();
      const selected = declarations.get(definition) ?? new Map<string, RustProgramErrorRoute>();
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
