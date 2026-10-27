import type { Node } from "@tsonic/tsts";
import { KindArrayBindingPattern, KindBindingElement, KindIdentifier, KindObjectBindingPattern, KindOmittedExpression, Node_Initializer, Node_Name } from "@tsonic/target-api/source";
import type { RustBindingProjectionFact, RustBindingValueProjectionFact } from "../../../target-model/records/objects/value-projections.js";
import type { RustBindingProjectionOwnership } from "../../../target-model/records/storage/binding-emission.js";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import { createRustStructuralObjectFromCarrier, readRustStoredObjectField } from "../objects/project-storage.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustOptionDefaultValue } from "../expressions/option-default.js";
import { planRustCheckedSourceOptional } from "../expressions/optional-storage.js";
import { rustBindingStorageForDeclaration } from "../expressions/typed-locations.js";
import { planRustLocalBindingStorage } from "./local-storage.js";
import { rustBindingLivenessAttributes } from "./liveness.js";

export type RustBindingExpressionPlanner = (node: Node, context: RustPlanContext) => RustExpr | undefined;

export function planRustBindingPattern(
  pattern: Node, source: RustExpr, _sourceCarrier: RustBindingProjectionFact["sourceCarrier"],
  context: RustPlanContext, planExpression: RustBindingExpressionPlanner,
): readonly RustStmt[] {
  const ast = context.input.program.source.ast;
  const kind = ast.kindName(pattern);
  if (kind !== KindArrayBindingPattern && kind !== KindObjectBindingPattern)
    failRustPlannerInvariant("An admitted binding pattern requires its checked object or array syntax.", pattern);
  const statements: RustStmt[] = [];
  for (const element of ast.elements(pattern)) {
    if (element === undefined || ast.kindName(element) === KindOmittedExpression) continue;
    if (ast.kindName(element) !== KindBindingElement || !ast.is.IsBindingElement(element))
      failRustPlannerInvariant("Binding pattern contains a non-binding element slot.", element);
    if (ast.name(element) === undefined) continue;
    const fact = context.input.program.records.bindingProjectionEmission.get(element)?.fact;
    if (fact === undefined) failRustPlannerInvariant("Binding element has no finalized Rust projection fact.", element);
    const projected = planRustBindingProjection(source, fact, element, context);
    const normalized = normalizeRustBindingValue(projected, fact, element, Node_Initializer(ast, element), context, planExpression);
    const name = Node_Name(ast, element);
    if (name === undefined) failRustPlannerInvariant("An admitted binding projection requires its checked destination name.", element);
    const nameKind = ast.kindName(name);
    if (nameKind === KindIdentifier) {
      const bindingName = context.input.program.records.sourceName.get(element);
      if (bindingName === undefined) failRustPlannerInvariant("An admitted binding leaf requires its sealed native name.", element);
      const bindingType = rustTypeFromCarrierInContext(fact.bindingCarrier, context);
      if (bindingType === undefined) failRustPlannerInvariant("Binding pattern leaf has no renderable finalized Rust carrier.", name);
      const location = rustBindingStorageForDeclaration(element, context);
      const storage = planRustLocalBindingStorage(element, bindingName, fact.bindingCarrier, bindingType, normalized, location, context);
      if (storage === undefined) failRustPlannerInvariant("An admitted binding leaf requires its native storage initialization.", element);
      if (storage.kind === "store") statements.push(storage.statement);
      else {
        const mutable = location?.iterationScope !== undefined || location === undefined && context.input.program.records.mutatedBinding.get(element) !== undefined;
        statements.push({ kind: "let", name: bindingName, mutable,
          attrs: rustBindingLivenessAttributes(element, mutable, context),
          ...(storage.type === undefined ? {} : { type: storage.type }), init: storage.value });
      }
      continue;
    }
    if (nameKind !== KindArrayBindingPattern && nameKind !== KindObjectBindingPattern)
      failRustPlannerInvariant("An admitted binding leaf requires its checked native binding form.", name);
    if (context.syntheticNames === undefined) failRustPlannerInvariant("Nested binding pattern requires a finalized hygienic-name scope.", name);
    const temporary = allocateRustSyntheticName(context.syntheticNames, "binding");
    statements.push({ kind: "let", name: temporary, mutable: false, init: normalized });
    statements.push(...planRustBindingPattern(name, { kind: "path", path: temporary }, fact.bindingCarrier, context, planExpression));
  }
  return statements;
}

export function planRustBindingProjection(
  source: RustExpr, fact: RustBindingValueProjectionFact, node: Node, context: RustPlanContext,
): RustExpr {
  const selected = context.input.program.records.bindingProjectionEmission.get(node);
  if (selected === undefined || selected.fact !== fact) failRustPlannerInvariant("An admitted binding requires its exact sealed native projection.", node);
  switch (selected.kind) {
    case "object-field": {
      const value = readRustStoredObjectField(selected.storage, fact.sourceCarrier, source, selected.index, fact.projectedCarrier, context);
      if (value === undefined) failRustPlannerInvariant("An admitted field binding requires its native field read.", node);
      return value;
    }
    case "object-rest": {
      const values = selected.fields.map(field => {
        const value = readRustStoredObjectField(selected.storage, fact.sourceCarrier, source, field.sourceIndex, field.carrier, context);
        if (value === undefined) failRustPlannerInvariant("An admitted object rest requires every native field read.", node);
        return { kind: field.method ? "method" as const : "stored" as const, value };
      });
      const value = createRustStructuralObjectFromCarrier(fact.bindingCarrier, values, context);
      if (value === undefined) failRustPlannerInvariant("An admitted object rest requires its native structural construction.", node);
      return value;
    }
    case "tuple-element": return ownedProjection({ kind: "field", receiver: source, name: String(selected.index) }, selected.ownership);
    case "fixed-array-element": case "vec-element": return ownedProjection(indexExpression(source, selected.index), selected.ownership);
    case "checked-vec-element": return { kind: "method-call", receiver: {
      kind: "method-call", receiver: source, method: selected.index === 0 ? "first" : "get",
      args: selected.index === 0 ? [] : [integer(selected.index)],
    }, method: "cloned", args: [] };
    case "js-array-element": return { kind: "method-call", receiver: source, method: "get", args: [integer(selected.index)] };
    case "tuple-rest": {
      const elements = selected.elements.map((ownership, offset) => ownedProjection({
        kind: "field", receiver: source, name: String(selected.start + offset),
      }, ownership));
      return selected.syntax === "tuple" ? { kind: "tuple-literal", elements } : { kind: "slice-literal", elements };
    }
    case "fixed-array-rest": {
      const slice: RustExpr = { kind: "index", receiver: source,
        index: { kind: "range", start: integer(selected.start), end: { kind: "int-literal", text: selected.end } } };
      return selected.output === "vector" ? { kind: "method-call", receiver: slice, method: "to_vec", args: [] }
        : { kind: "method-call", receiver: { kind: "method-call", receiver: slice, method: "try_into", args: [] },
          method: "expect", args: [{ kind: "str-literal", value: "validated fixed-array destructuring length" }] };
    }
    case "vec-rest": return { kind: "method-call", receiver: { kind: "index", receiver: source,
      index: { kind: "range", start: integer(selected.start), end: { kind: "method-call", receiver: source, method: "len", args: [] } } },
      method: "to_vec", args: [] };
    case "js-array-rest": return { kind: "method-call", receiver: source, method: "slice_from",
      args: [{ kind: "float-literal", text: `${selected.start}.0` }] };
  }
}

export function normalizeRustBindingValue(
  value: RustExpr, fact: RustBindingValueProjectionFact, element: Node, initializer: Node | undefined,
  context: RustPlanContext, planExpression: RustBindingExpressionPlanner,
): RustExpr {
  const selected = context.input.program.records.bindingProjectionEmission.get(element);
  if (selected === undefined || selected.fact !== fact) failRustPlannerInvariant("An admitted binding default requires its sealed native projection.", element);
  const stored = selected.checkedElement === undefined ? value : planRustCheckedSourceOptional(value, selected.checkedElement, context);
  if (fact.normalization === "identity" || fact.normalization === "checked-array") return stored;
  const fallback = initializer === undefined ? undefined : planExpression(initializer, context);
  if (fallback === undefined) failRustPlannerInvariant("Defaulted binding projection has no concrete finalized fallback expression.", element);
  if (fact.normalization === "default-on-absence") return { kind: "evaluate-then", effect: stored, discard: "unit", value: fallback };
  const result = rustOptionDefaultValue(stored, fallback, fact.storageCarrier, context, selected.retainStorage);
  if (result === undefined) failRustPlannerInvariant("An admitted binding default requires its native optional projection.", element);
  return result;
}

function ownedProjection(value: RustExpr, ownership: RustBindingProjectionOwnership): RustExpr {
  return ownership === "copy" ? value : { kind: "method-call", receiver: value, method: "clone", args: [] };
}

function indexExpression(receiver: RustExpr, index: number): RustExpr {
  return { kind: "index", receiver, index: integer(index) };
}

function integer(value: number): RustExpr {
  return { kind: "int-literal", text: String(value) };
}
