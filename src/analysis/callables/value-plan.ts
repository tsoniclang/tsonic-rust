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

export interface RustCallableValuePlan {
  readonly generic: RustGenericCallablePlan;
  readonly suspended: RustSuspendedCallablePlan;
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
    get issues() { return requireCurrent().issues; },
  });
}

function createRustCallableValuePlan(input: RustCallableValuePlanInput): RustCallableValuePlan {
  const flows: { subject: Node; conversion: RustGenericCallableConversion }[] = [];
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
    for (const dispatch of input.facts.getFact(node, rustObjectLiteralMethodAdapterFactKey)?.dispatches ?? []) {
      for (const adapter of rustCallableAdapterValues(dispatch)) record(node, adapter);
    }
    for (const dispatch of input.facts.getFact(node, rustProjectCallableAdaptersKey) ?? []) {
      for (const adapter of rustCallableAdapterValues(dispatch)) record(node, adapter);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of input.sourceFiles) visit(sourceFile);
  const generic = createRustGenericCallablePlan(input.ast, input.sourceFiles, input.facts, input.names, input.navigation, flows);
  const suspended = createRustSuspendedCallablePlan(input.ast, input.sourceFiles, input.facts, input.names, input.lifetimes);
  return Object.freeze({ generic, suspended, issues: Object.freeze([...generic.issues, ...suspended.issues]) });
}
