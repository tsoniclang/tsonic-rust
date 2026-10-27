import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustBinaryHookPlan } from "../../../target-model/records/operations/binary-execution.js";
import type { RustPlanningContext } from "../context.js";
import { applyRustDispatchContextBindings, projectRustDispatchContext } from "../project/dispatch-contexts.js";
import type { RustDispatchContextBinding } from "../project/dispatch-contexts.js";
import { rustTypeFromCarrier } from "../types/carrier-syntax.js";
import { allocateRustSyntheticName, type RustSyntheticNameState } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

export interface RustBinaryHookCallPlan {
  call(args: readonly RustExpr[]): RustExpr;
}

export function planRustBinaryHookCallPlan(hook: RustBinaryHookPlan, input: RustPlanningContext): RustBinaryHookCallPlan {
  const selected = input.program.records.binaryDispatch.get(hook.id);
  if (selected === undefined) failRustPlannerInvariant("A binary hook requires its admitted native dispatch plan.");
  if (selected.groups.length === 0) return { call: args => ({ kind: "call", path: hook.path, args }) };
  const names: RustSyntheticNameState = { reserved: new Set(selected.reservedNames), nextSuffixByBase: new Map() };
  const bindings = new Map<string, RustDispatchContextBinding>();
  const groupArgs = new Map<number, RustExpr>();
  for (const group of selected.groups) {
    const values = new Map<string, RustExpr>();
    for (const component of group.components) {
      let value = emptyGroup(component.emptyOwner, group.emptyMethod);
      for (let index = component.children.length - 1; index >= 0; index -= 1) {
        const child = values.get(component.children[index]!);
        if (child === undefined) failRustPlannerInvariant("An admitted binary group requires its dependency value.");
        value = { kind: "call", path: group.prependPath, args: [{ kind: "reference", expr: child }, value] };
      }
      for (let index = component.accesses.length - 1; index >= 0; index -= 1) {
        const access = component.accesses[index]!;
        let binding = bindings.get(access.identity);
        if (binding === undefined) {
          binding = { name: allocateRustSyntheticName(names, "hook_context"), path: access.path };
          bindings.set(access.identity, binding);
        }
        value = { kind: "call", path: group.prependPath, args: [
          projectRustDispatchContext({ kind: "path", path: binding.name }, access.projections), value,
        ] };
      }
      values.set(component.componentId, value);
    }
    groupArgs.set(group.targetArgumentIndex, values.get(selected.rootComponentId) ?? emptyGroup(group.rootEmptyOwner, group.emptyMethod));
  }
  return { call(args) {
    if (args.length !== selected.inputCount) failRustPlannerInvariant("Binary hook inputs disagree with its sealed native lifecycle ABI.");
    const argumentNames = args.map(() => allocateRustSyntheticName(names, "hook_argument"));
    const evaluated: RustStmt[] = args.map((argument, index) => ({
      kind: "let", name: argumentNames[index]!, mutable: false, init: argument,
    }));
    let argumentIndex = 0;
    const finalArgs = Array.from({ length: args.length + selected.groups.length }, (_, index): RustExpr => {
      const group = groupArgs.get(index);
      if (group !== undefined) return group;
      return { kind: "path", path: argumentNames[argumentIndex++]! };
    });
    const expression = applyRustDispatchContextBindings({ kind: "call", path: hook.path, args: finalArgs }, [...bindings.values()]);
    return evaluated.length === 0 ? expression : { kind: "block", body: { statements: [...evaluated, { kind: "tail", expr: expression }] } };
  } };

  function emptyGroup(carrier: TargetTypeRef, method: string): RustExpr {
    const owner = rustTypeFromCarrier(carrier);
    if (owner === undefined) failRustPlannerInvariant("An admitted binary group requires its native empty constructor type.");
    return { kind: "associated-call", owner, method, args: [] };
  }
}
