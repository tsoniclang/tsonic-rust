import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustBinaryHookPlan } from "../../../analysis/runtime/hooks.js";
import type { RustPlanningContext } from "../context.js";
import type { RustSourcePackageComponentPlan } from "./source-package-components.js";
import type { RustSourcePackageErrorPlan } from "./source-package-errors.js";
import { applyRustDispatchContextBindings, projectRustDispatchContext, rustDispatchContextRootName } from "../project/dispatch-contexts.js";
import type { RustDispatchContextBinding } from "../project/dispatch-contexts.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { isRustProgramErrorCarrier, rustNamedTargetType } from "../../../target-model/types/index.js";
import { rustTypeFromCarrier } from "../types/render.js";
import type { RustDispatchContextGroupInput } from "../../../target-model/operations/dispatch-contexts.js";
import { allocateRustSyntheticName, createRustSyntheticNameState, type RustSyntheticNameState } from "../names/synthetic.js";

export interface RustBinaryHookCallPlan {
  call(args: readonly RustExpr[]): RustExpr;
}

export function planRustBinaryHookCallPlan(
  hook: RustBinaryHookPlan,
  input: RustPlanningContext,
  components: readonly RustSourcePackageComponentPlan[],
  errors: RustSourcePackageErrorPlan,
  diagnostics: TargetDiagnostic[],
): RustBinaryHookCallPlan | undefined {
  const groups = input.program.binaryDispatchDemand.forHook(hook.id);
  if (groups === undefined) return invalid("A binary hook has no sealed native context-group demand.");
  if (groups.length === 0) return { call: args => ({ kind: "call", path: hook.path, args }) };
  const byId = new Map(components.map(component => [component.componentId, component]));
  const root = components.find(component => component.root);
  if (root === undefined) return invalid("Binary context groups have no exact root component.");
  const names: RustSyntheticNameState = { reserved: new Set(), nextSuffixByBase: new Map() };
  for (const file of input.program.sourceFiles) {
    const selected = createRustSyntheticNameState(input.program.source.ast, file, []);
    for (const name of selected.reserved) names.reserved.add(name);
  }
  const bindings = new Map<string, RustDispatchContextBinding>();
  const groupArgs = new Map<number, RustExpr>();
  for (const group of groups) {
    const values = new Map<string, RustExpr>();
    for (const selected of group.components) {
      const component = byId.get(selected.componentId);
      if (component === undefined) return invalid("Binary context grouping lost its exact component owner.");
      let value = emptyGroup(component, group.input.empty);
      if (value === undefined) return undefined;
      for (let index = selected.children.length - 1; index >= 0; index -= 1) {
        const child = values.get(selected.children[index]!);
        if (child === undefined) return invalid("Binary context grouping lost its exact dependency-error route.");
        value = { kind: "call", path: group.input.prepend.path, args: [
          { kind: "reference", expr: child }, value,
        ] };
      }
      for (let index = selected.accesses.length - 1; index >= 0; index -= 1) {
        const access = selected.accesses[index]!;
        const key = `${selected.componentId}:${access.rootContextId}`;
        let binding = bindings.get(key);
        if (binding === undefined) {
          const demand = input.program.dispatchContextDemand.forComponent(selected.componentId);
          const rootIndex = demand?.rootContextIds.indexOf(access.rootContextId);
          if (rootIndex === undefined || rootIndex < 0) return invalid("Binary context access has no exact demanded physical root.");
          const crateName = component.root ? input.program.configuration.crateName : component.crateName;
          if (crateName === undefined) return invalid("Binary context access has no exact native crate identity.");
          binding = { name: allocateRustSyntheticName(names, "hook_context"),
            path: `${crateName}::${component.programModuleName}::${rustDispatchContextRootName(rootIndex)}` };
          bindings.set(key, binding);
        }
        value = { kind: "call", path: group.input.prepend.path, args: [
          projectRustDispatchContext({ kind: "path", path: binding.name }, access.projections), value,
        ] };
      }
      values.set(selected.componentId, value);
    }
    const value = values.get(root.componentId) ?? emptyGroup(root, group.input.empty);
    if (value === undefined) return undefined;
    groupArgs.set(group.input.targetArgumentIndex, value);
  }
  return { call(args) {
    if (args.length !== (hook.phase === "async-execution" ? 1 : 0)) {
      throw new Error("Binary hook inputs disagree with its sealed native lifecycle ABI.");
    }
    const argumentNames = args.map(() => allocateRustSyntheticName(names, "hook_argument"));
    const evaluated: RustStmt[] = args.map((argument, index) => ({
      kind: "let", name: argumentNames[index]!, mutable: false, init: argument,
    }));
    let argumentIndex = 0;
    const finalArgs = Array.from({ length: args.length + groups.length }, (_, index): RustExpr => {
      const group = groupArgs.get(index);
      if (group !== undefined) return group;
      const name = argumentNames[argumentIndex++]!;
      return { kind: "path", path: name };
    });
    const expression = applyRustDispatchContextBindings({ kind: "call", path: hook.path, args: finalArgs }, [...bindings.values()]);
    return evaluated.length === 0 ? expression : {
      kind: "block", body: { statements: [...evaluated, { kind: "tail", expr: expression }] },
    };
  } };

  function emptyGroup(
    component: RustSourcePackageComponentPlan,
    construction: RustDispatchContextGroupInput["empty"],
  ): RustExpr | undefined {
    const domain = errors.domainsByComponentId.get(component.componentId);
    if (domain === undefined) return invalid("Binary context grouping has no exact component error domain.");
    if (domain.errorDomain === "project" && !component.root && component.crateName === undefined) {
      return invalid("Binary dependency error grouping has no exact native crate identity.");
    }
    const errorPath = domain.errorDomain === "runtime" ? "tsonic_rust_runtime::TsonicError"
      : `${component.root ? input.program.configuration.crateName : component.crateName}::${component.programModuleName}::TsonicError`;
    const owner = rustTypeFromCarrier(mapRustTargetTypes(construction.owner,
      carrier => isRustProgramErrorCarrier(carrier) ? rustNamedTargetType(domain.errorTypeIdentity, errorPath) : carrier));
    if (owner === undefined) return invalid("Binary context grouping has no exact renderable native empty constructor.");
    return { kind: "associated-call", owner, method: construction.method, args: [] };
  }

  function invalid(message: string): undefined {
    diagnostics.push({ code: "RUST_BINARY_DISPATCH_INPUT_INVALID", category: "error", source: "tsonic-rust", message,
      evidence: ["rust.backend.binary-dispatch-input"] });
    return undefined;
  }
}
