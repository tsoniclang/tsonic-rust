import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import type { RustLifetimeIndex } from "../../target-model/lifetimes/index.js";
import type { RustGenericCallableConversion } from "../../target-model/conversions/generic-callable.js";
import type { RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { rustObjectLiteralMethodAdapterFactKey } from "../facts/object-methods.js";
import { rustProjectCallableAdaptersKey } from "../facts/project-callable-adapters.js";
import { createRustGenericCallablePlan, type RustGenericCallablePlan } from "./generic-values.js";
import { createRustSuspendedCallablePlan, type RustSuspendedCallablePlan } from "./suspended-values.js";
import type { RustSourceCallableSpecializationIssue } from "./specializations.js";
import { rustCallableAdapterValues } from "./adapter-values.js";
import { rustTargetOperationFactKey, rustBindingProjectionFactKey } from "../facts/keys.js";
import { rustObjectReferenceViewKey } from "../facts/object-reference-views.js";
import { rustStructuralObjectCarrierValue } from "../../target-model/types/carriers/source-types.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { createRustFrameCallablePlan, type RustFrameCallablePlan } from "./frame-values.js";
import type { RustCallableOwnershipPlan } from "./ownership-plan.js";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustProjectTypePolicy } from "../project-types/type-policy.js";

export interface RustCallableValuePlan {
  readonly generic: RustGenericCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
  readonly frames: RustFrameCallablePlan;
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
}

export interface RustCallableValuePlanInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly names: RustNamePlan;
  readonly navigation: SourceProgramNavigation;
  readonly lifetimes: RustLifetimeIndex;
  readonly classValueAdapters: readonly { readonly subject: Node; readonly adapter: RustCallableValueAdapter }[];
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly ownership: RustCallableOwnershipPlan;
  readonly sourceStorage: SourceStorageQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly objectRepresentations: import("../project-types/object-representation.js").RustObjectRepresentationPlan;
}

export interface RustCallableValuePlanRegistry extends RustCallableValuePlan {
  initialize(input: RustCallableValuePlanInput): RustCallableValuePlan;
  seal(): RustCallableValuePlan;
}

export function createRustCallableValuePlanRegistry(): RustCallableValuePlanRegistry {
  let current: RustCallableValuePlan | undefined;
  const requireCurrent = (): RustCallableValuePlan => {
    if (current === undefined) throw new Error("Rust callable values must be finalized after their selected adapters and before effect analysis.");
    return current;
  };
  return Object.freeze({
    initialize(input: RustCallableValuePlanInput) {
      if (current !== undefined) throw new Error("Rust callable value representations can be initialized only once.");
      current = createRustCallableValuePlan(input);
      return current;
    },
    seal: requireCurrent,
    get generic() { return requireCurrent().generic; },
    get suspended() { return requireCurrent().suspended; },
    get frames() { return requireCurrent().frames; },
    get issues() { return requireCurrent().issues; },
  });
}

function createRustCallableValuePlan(input: RustCallableValuePlanInput): RustCallableValuePlan {
  const flows: { subject: Node; conversion: RustGenericCallableConversion }[] = [];
  const usedNames = new Set<string>();
  const recordField = (subject: Node, source: TargetTypeRef | undefined, target: TargetTypeRef | undefined): void => {
    if (source === undefined || target === undefined) return;
    const sourceCarrier = rustOptionElementCarrier(source) ?? source;
    const targetCarrier = rustOptionElementCarrier(target) ?? target;
    if (rustGenericCallableValue(sourceCarrier) !== undefined && rustGenericCallableValue(targetCarrier) !== undefined) flows.push({ subject,
      conversion: { kind: "generic-callable-flow", source: sourceCarrier, target: targetCarrier },
    });
  };
  const record = (subject: Node, adapter: RustCallableValueAdapter): void => {
    switch (adapter.kind) {
      case "conversion":
        if (adapter.conversion.kind === "generic-callable-flow") flows.push({ subject, conversion: adapter.conversion });
        break;
      case "option-map":
      case "option-some": record(subject, adapter.element); break;
      case "identity":
      case "project-structural-view":
      case "project-upcast":
      case "call-scoped-lifetime": break;
    }
  };
  for (const { subject, adapter } of input.classValueAdapters) record(subject, adapter);
  const visit = (node: Node): void => {
    for (const name of [input.names.nameForDeclaration(node), input.names.functionNameForDeclaration(node),
      input.names.callableValueNameForDeclaration(node)]) {
      if (name !== undefined) usedNames.add(name);
    }
    const operation = input.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "record-literal") {
      const targets = new Map(operation.fields.map(field => [field.storageIndex, field.carrier]));
      for (const contribution of operation.contributions) {
        if (contribution.kind !== "spread") continue;
        const source = rustStructuralObjectCarrierValue(contribution.sourceCarrier);
        for (const field of contribution.fields) recordField(node, source?.fields[field.sourceStorageIndex]?.type,
          targets.get(field.targetStorageIndex));
      }
    }
    const view = input.facts.getFact(node, rustObjectReferenceViewKey);
    if (view?.kind === "structural") {
      const target = rustStructuralObjectCarrierValue(view.targetCarrier);
      for (const field of view.fields) recordField(node, field.source.resultCarrier,
        target?.fields[field.destinationIndex]?.type);
    }
    const binding = input.facts.getFact(node, rustBindingProjectionFactKey);
    if (binding?.projection.kind === "object-rest") {
      const source = rustStructuralObjectCarrierValue(binding.sourceCarrier);
      const target = rustStructuralObjectCarrierValue(binding.bindingCarrier);
      for (const field of binding.projection.fields) recordField(node,
        source?.fields[field.sourceStorageIndex]?.type, target?.fields[field.targetStorageIndex]?.type);
    }
    for (const dispatch of input.facts.getFact(node, rustObjectLiteralMethodAdapterFactKey)?.dispatches ?? []) {
      for (const adapter of rustCallableAdapterValues(dispatch)) record(node, adapter);
    }
    for (const dispatch of input.facts.getFact(node, rustProjectCallableAdaptersKey) ?? []) {
      for (const adapter of rustCallableAdapterValues(dispatch)) record(node, adapter);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of input.sourceFiles) visit(sourceFile);
  const generic = createRustGenericCallablePlan(input.ast, input.sourceFiles, input.facts, input.names, input.navigation, flows, input.closedSourceFiles);
  const suspended = createRustSuspendedCallablePlan(input.ast, input.sourceFiles, input.facts, input.names, input.lifetimes);
  for (const definition of generic.definitions) {
    usedNames.add(definition.targetName);
    for (const implementation of definition.implementations) {
      usedNames.add(implementation.functionName);
      usedNames.add(implementation.stateName);
    }
  }
  for (const implementation of suspended.implementations) usedNames.add(implementation.stateName);
  const frames = createRustFrameCallablePlan({ ...input, usedNames });
  return Object.freeze({ generic, suspended, frames,
    issues: Object.freeze([...generic.issues, ...suspended.issues, ...frames.issues]) });
}
