import type { Node } from "@tsonic/tsts";
import type { RustModuleBindingFact } from "../../../target-model/records/operations/operation-selections.js";
import type { RustExpr, RustItem, RustStmt } from "../../target-ast/syntax/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { planNativeModuleFunction } from "../declarations/callables/functions.js";
import { planExpression } from "../expressions/index.js";
import { planRustSourceCallableValue } from "../expressions/source-callable-value.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustModuleCell, rustModuleCellCallableAlias } from "../project/module-storage.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { normalizeRustBindingValue, planRustBindingProjection } from "../bindings/binding-patterns.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { isUpperSnakeName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustAuthoredDeadCodeDisposition } from "./reachability-directives.js";

interface PlannedTopLevelVariableStatement {
  readonly items: readonly RustItem[];
  readonly initialization: readonly RustStmt[];
}

export function planTopLevelVariableStatement(
  statement: Node,
  context: RustPlanContext,
): PlannedTopLevelVariableStatement | undefined {
  const { ast } = context.input.program.source;
  const declarations: Node[] = [];
  const visit = (candidate: Node): void => {
    if (ast.kindName(candidate) === "KindVariableDeclaration") {
      declarations.push(candidate);
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(statement);
  if (declarations.length === 0) {
    failRustPlannerInvariant("An admitted top-level variable statement requires its declarations.", statement);
  }
  const items: RustItem[] = [];
  const initialization: import("../../target-ast/syntax/nodes.js").RustStmt[] = [];
  for (const declaration of declarations) {
    if (context.input.program.records.compileTimeSource.get(declaration)) continue;
    const binding = context.input.program.records.moduleBinding.get(declaration);
    if (binding?.storage === "module-pattern") {
      const pattern = planModuleBindingPattern(declaration, binding, context);
      if (pattern === undefined) return undefined;
      items.push(...pattern.items);
      initialization.push(...pattern.initialization);
      continue;
    }
    const emission = context.input.program.records.moduleBindingEmission.get(declaration);
    if (binding === undefined || emission === undefined)
      failRustPlannerInvariant("An admitted module binding requires its exact native storage and emission plan.", declaration);
    const { name, initializer, visibility } = emission;
    // As for function declarations (source-file.ts), an erased module callable has no native item.
    if (binding.storage === "native-callable" &&
      context.input.program.records.nativeParticipation.get(binding.callableDeclaration) === "erased") continue;
    if (binding.storage === "native-callable") {
      const callablePlan = planNativeModuleFunction(
        declaration,
        binding.callableDeclaration,
        binding.name,
        context,
        undefined,
      );
      items.push(callablePlan.item);
      if (callablePlan.helper !== undefined) items.push(callablePlan.helper);
      const storage = context.input.program.records.moduleCallableStorage.get(declaration);
      if (binding.value !== undefined && storage === undefined) {
        failRustPlannerInvariant("Module callable values require their finalized native storage selection.", declaration);
      }
      if (binding.value === undefined || storage?.kind === "inline") {
        continue;
      }
      const value = planRustSourceCallableValue({
        form: "function",
        sourceDeclaration: binding.callableDeclaration,
        fileName: ast.getFileName(context.sourceFile),
        name: binding.name,
        carrier: binding.value.carrier,
        parameterCarriers: binding.value.parameterCarriers,
        resultCarrier: binding.value.resultCarrier,
      }, context);
      const physical = context.input.program.records.moduleHoistedCallable.get(declaration)?.carrier;
      if (physical === undefined) failRustPlannerInvariant("An admitted observed module callable requires its sealed physical value carrier.", declaration);
      const rustType = rustTypeFromCarrierInContext(physical, context);
      if (value === undefined || rustType === undefined)
        failRustPlannerInvariant("An admitted module callable requires its rendered native value and carrier.", declaration);
      if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted module callable requires its native hygienic scope.", declaration);
      context.usedAliases?.add("rt");
      const planned = planRustModuleCell(
        binding.value.name,
        rustType,
        value,
        visibility,
        context.syntheticNames,
        rustModuleCellCallableAlias(physical, context.input),
        [
          ...(isUpperSnakeName(binding.value.name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
        ],
      );
      items.push(...planned.items);
      initialization.push(planned.initialization);
      continue;
    }
    const storage = context.input.program.records.localBinding.get(declaration);
    if (storage?.kind !== "value") failRustPlannerInvariant("An admitted module value requires its exact physical native storage.", declaration);
    const rustType = rustTypeFromCarrierInContext(storage.nativeCarrier, context);
    if (rustType === undefined) {
      failRustPlannerInvariant("Top-level value binding has no finalized renderable Rust carrier.", declaration);
    }
    const value = initializer === undefined ? undefined : planExpression(initializer, context);
    if (initializer !== undefined && value === undefined) {
      return undefined;
    }
    if (binding.storage === "native-const") {
      if (value === undefined) failRustPlannerInvariant("An admitted native constant requires its initializer.", declaration);
      const deadCode = rustAuthoredDeadCodeDisposition(context, declaration);
      const attrs = [
        ...(isUpperSnakeName(name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
      ];
      items.push({
        kind: "const",
        name,
        visibility,
        ...(attrs.length === 0 ? {} : { attrs }),
        ...(deadCode === undefined ? {} : { deadCode }),
        type: emission.staticString !== undefined
          ? { kind: "reference", referent: { kind: "str" }, mutable: false }
          : rustType,
        value: emission.staticString !== undefined
          ? { kind: "str-literal", value: emission.staticString }
          : value,
      });
      continue;
    }
    if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted module cell requires its native hygienic scope.", declaration);
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(
      name,
      rustType,
      value,
      visibility,
      context.syntheticNames,
      rustModuleCellCallableAlias(storage.nativeCarrier, context.input),
      [
        ...(isUpperSnakeName(name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
      ],
    );
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
function planModuleBindingPattern(
  declaration: Node,
  binding: Extract<RustModuleBindingFact, { readonly storage: "module-pattern" }>,
  context: RustPlanContext,
): PlannedTopLevelVariableStatement | undefined {
  if (context.syntheticNames === undefined) return failRustPlannerInvariant("Module binding patterns require a hygienic initializer scope.", declaration);
  const value = planExpression(binding.initializer, context);
  if (value === undefined) return undefined;
  const rootName = allocateRustSyntheticName(context.syntheticNames, "module_pattern");
  const initialization: RustStmt[] = [{ kind: "let", name: rootName, mutable: false, init: value }];
  const items: RustItem[] = [];
  const sources = new Map<Node, RustExpr>([[declaration, { kind: "path", path: rootName }]]);
  for (const step of binding.steps) {
    const source = sources.get(step.source);
    const projection = context.input.program.records.bindingProjectionEmission.get(step.declaration)?.fact;
    if (source === undefined || projection === undefined) return failRustPlannerInvariant(
      "Module binding pattern has no sealed ordered projection source.", step.declaration);
    const projected = planRustBindingProjection(source, projection, step.declaration, context);
    const normalized = projected === undefined ? undefined :
      normalizeRustBindingValue(projected, projection, step.declaration, step.initializer, context, planExpression);
    if (normalized === undefined) return undefined;
    if (step.kind === "pattern") {
      const temporary = allocateRustSyntheticName(context.syntheticNames, "module_pattern");
      initialization.push({ kind: "let", name: temporary, mutable: false, init: normalized });
      sources.set(step.declaration, { kind: "path", path: temporary });
      continue;
    }
    const leaf = context.input.program.records.moduleBinding.get(step.declaration);
    if (leaf?.storage !== "module-cell" || leaf.initialization !== "value") return failRustPlannerInvariant(
      "Module binding leaf has no sealed initialized native module storage.", step.declaration);
    const emission = context.input.program.records.moduleBindingEmission.get(step.declaration);
    const type = rustTypeFromCarrierInContext(projection.bindingCarrier, context);
    if (emission === undefined || type === undefined) return failRustPlannerInvariant(
      "Module binding leaf has no sealed native name and carrier.", step.declaration);
    const { name, visibility } = emission;
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(name, type, normalized, visibility, context.syntheticNames,
      rustModuleCellCallableAlias(projection.bindingCarrier, context.input),
      isUpperSnakeName(name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]);
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
