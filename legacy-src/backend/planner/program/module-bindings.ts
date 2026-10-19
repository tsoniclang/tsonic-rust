import type { Node } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import type { RustModuleBindingFact } from "../../../target-model/records/operation-selections.js";
import { isRustStringCarrier, rustCarrierSupportsClone } from "../../../target-model/types/index.js";
import type { RustExpr, RustItem, RustStmt } from "../../target-ast/syntax/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { planNativeModuleFunction } from "../declarations/callables/functions.js";
import { planExpression } from "../expressions/index.js";
import { planRustSourceCallableValue } from "../expressions/source-callable-value.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustModuleCell } from "../project/module-storage.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { normalizeRustBindingValue, planRustBindingProjection } from "../bindings/binding-patterns.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { diagnosticInput, isUpperSnakeName, isValidRustIdentifier, rustSourceItemIsPubliclyReachable } from "./plan-context.js";
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
    context.diagnostics.push(unsupportedConstructDiagnostic(
      { ast, sourceFile: context.sourceFile, node: statement },
      "rust.backend.module-binding",
      "Top-level variable statements require at least one exact variable declaration.",
    ));
    return undefined;
  }
  const items: RustItem[] = [];
  const initialization: import("../../target-ast/syntax/nodes.js").RustStmt[] = [];
  for (const declaration of declarations) {
    if (context.input.program.records.compileTimeSource.get(declaration)) continue;
    const name = context.input.program.names.nameForDeclaration(declaration) ?? "";
    const initializer = Node_Initializer(ast, declaration);
    const binding = context.input.program.records.moduleBinding.get(declaration);
    if (binding?.storage === "module-pattern") {
      const pattern = planModuleBindingPattern(declaration, binding, statement, context);
      if (pattern === undefined) return undefined;
      items.push(...pattern.items);
      initialization.push(...pattern.initialization);
      continue;
    }
    if (binding === undefined || !isValidRustIdentifier(name) ||
      initializer === undefined && (binding.storage !== "module-cell" || binding.initialization !== "declaration") ||
      initializer !== undefined && binding.storage === "module-cell" && binding.initialization !== "value") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding",
        "Top-level bindings require a plain Rust identifier and one finalized module-binding fact matching their initialization.",
      ));
      return undefined;
    }
    const visibility = ast.hasModifierKind(statement, "export") ||
        rustSourceItemIsPubliclyReachable(context, name)
      ? "public" as const
      : "crate" as const;
    if (binding.storage === "native-callable") {
      const item = planNativeModuleFunction(
        declaration,
        binding.callableDeclaration,
        binding.name,
        binding.value === undefined && visibility === "public",
        context,
      );
      if (item === undefined) {
        return undefined;
      }
      items.push(item);
      const storage = context.input.program.records.moduleCallableStorage.get(declaration);
      if (binding.value !== undefined && storage === undefined) {
        context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, declaration),
          "rust.backend.module-callable-storage", "Module callable values require their finalized native storage selection."));
        return undefined;
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
      const physical = context.input.program.callableValues.nativeProducers.physicalFor(binding.callableDeclaration, binding.value.carrier);
      const rustType = rustTypeFromCarrierInContext(physical, context);
      if (value === undefined || rustType === undefined ||
        !rustCarrierSupportsClone(binding.value.carrier, context.input.program.typeDefinitions)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          { ast, sourceFile: context.sourceFile, node: declaration },
          "rust.backend.module-callable-value",
          "Observed module callable values require one exact renderable Clone-capable carrier.",
        ));
        return undefined;
      }
      context.usedAliases?.add("rt");
      const planned = planRustModuleCell(
        binding.value.name,
        rustType,
        value,
        visibility,
        context.syntheticNames!,
        [
          ...(isUpperSnakeName(binding.value.name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]),
        ],
      );
      items.push(...planned.items);
      initialization.push(planned.initialization);
      continue;
    }
    const rustType = rustTypeFromCarrierInContext(binding.valueCarrier, context);
    if (rustType === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding-carrier",
        "Top-level value binding has no finalized renderable Rust carrier.",
      ));
      return undefined;
    }
    const value = initializer === undefined ? undefined : planExpression(initializer, context);
    if (initializer !== undefined && value === undefined) {
      return undefined;
    }
    if (binding.storage === "native-const") {
      if (value === undefined) return undefined;
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
        type: isRustStringCarrier(binding.valueCarrier)
          ? { kind: "reference", referent: { kind: "str" }, mutable: false }
          : rustType,
        value: isRustStringCarrier(binding.valueCarrier) && value.kind === "string-literal"
          ? { kind: "str-literal", value: value.value }
          : value,
      });
      continue;
    }
    if (!rustCarrierSupportsClone(binding.valueCarrier, context.input.program.typeDefinitions)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        { ast, sourceFile: context.sourceFile, node: declaration },
        "rust.backend.module-binding-carrier",
        "Runtime module bindings require one exact Clone-capable Rust value carrier.",
      ));
      return undefined;
    }
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(
      name,
      rustType,
      value,
      visibility,
      context.syntheticNames!,
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
  statement: Node,
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
    const projection = context.input.program.records.bindingProjection.get(step.declaration);
    if (source === undefined || projection === undefined || !("bindingCarrier" in projection)) return failRustPlannerInvariant(
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
    const name = context.input.program.names.nameForDeclaration(step.declaration);
    const type = rustTypeFromCarrierInContext(leaf.valueCarrier, context);
    if (name === undefined || !isValidRustIdentifier(name) || type === undefined) return failRustPlannerInvariant(
      "Module binding leaf has no sealed native name and carrier.", step.declaration);
    const visibility = context.input.program.source.ast.hasModifierKind(statement, "export") ||
      rustSourceItemIsPubliclyReachable(context, name) ? "public" : "crate";
    context.usedAliases?.add("rt");
    const planned = planRustModuleCell(name, type, normalized, visibility, context.syntheticNames,
      isUpperSnakeName(name) ? [] : [rustLintAttributes.nonUpperCaseGlobal]);
    items.push(...planned.items);
    initialization.push(planned.initialization);
  }
  return { items, initialization };
}
