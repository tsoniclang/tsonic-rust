import type { Node } from "@tsonic/tsts";
import {
  KindArrayBindingPattern,
  KindBindingElement,
  KindIdentifier,
  KindObjectBindingPattern,
  KindOmittedExpression,
  Node_Initializer,
  Node_Name,
} from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  rustBindingProjectionFactKey,
  rustMutatedBindingFactKey,
  type RustBindingProjectionFact,
} from "../../../analysis/facts/keys.js";
import {
  isRustJsArrayCarrier,
  isRustVecCarrier,
  rustCloneTrait,
  rustFixedArrayCarrierValue,
  rustStructuralObjectCarrierValue,
  rustTupleTargetType,
} from "../../../target-model/types/index.js";
import {
  rustSealedCarrierSupportsTrait,
  rustSealedOwnedCarrierReadKind,
} from "../ownership/traits.js";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import {
  createRustStructuralObjectFromCarrier,
  readRustStoredObjectField,
} from "../objects/project-storage.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustActiveErrorType,
} from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustOptionDefaultValue } from "../option-default.js";

export type RustBindingExpressionPlanner = (
  node: Node,
  context: RustPlanContext,
) => RustExpr | undefined;

export function planRustBindingPattern(
  pattern: Node,
  source: RustExpr,
  sourceCarrier: RustBindingProjectionFact["sourceCarrier"],
  context: RustPlanContext,
  planExpression: RustBindingExpressionPlanner,
): readonly RustStmt[] | undefined {
  const kind = context.input.program.source.ast.kindName(pattern);
  if (kind !== KindArrayBindingPattern && kind !== KindObjectBindingPattern) {
    return undefined;
  }
  const statements: RustStmt[] = [];
  for (const element of context.input.program.source.ast.elements(pattern)) {
    if (element === undefined || context.input.program.source.ast.kindName(element) === KindOmittedExpression) {
      continue;
    }
    if (context.input.program.source.ast.kindName(element) !== KindBindingElement ||
      !context.input.program.source.ast.is.IsBindingElement(element)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, pattern),
        "rust.backend.binding-pattern-shape",
        "Binding pattern contains a non-binding element slot.",
      ));
      return undefined;
    }
    const fact = context.input.program.facts.getFact(element, rustBindingProjectionFactKey);
    if (fact === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, element),
        "rust.backend.binding-projection",
        "Binding element has no finalized Rust projection fact.",
      ));
      return undefined;
    }
    if (!rustTargetTypeRefEquals(fact.sourceCarrier, sourceCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, element),
        "rust.backend.binding-source-carrier",
        "Binding projection fact conflicts with its finalized source carrier.",
      ));
      return undefined;
    }
    const projected = planBindingProjection(source, fact, element, context);
    const normalized = projected === undefined
      ? undefined
      : normalizeBindingValue(projected, fact, element, context, planExpression);
    if (normalized === undefined) {
      return undefined;
    }
    const name = Node_Name(context.input.program.source.ast, element);
    const nameKind = name === undefined ? "" : context.input.program.source.ast.kindName(name);
    if (name === undefined) {
      return undefined;
    }
    if (nameKind === KindIdentifier) {
      const bindingName = context.input.program.names.nameForDeclaration(element) ?? "";
      if (!isValidRustIdentifier(bindingName)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, name),
          "rust.backend.binding-name",
          "Binding pattern leaf is not a valid Rust identifier.",
        ));
        return undefined;
      }
      const bindingType = rustTypeFromCarrierInContext(fact.bindingCarrier, context);
      if (bindingType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, name),
          "rust.backend.binding-carrier",
          "Binding pattern leaf has no renderable finalized Rust carrier.",
        ));
        return undefined;
      }
      statements.push({
        kind: "let",
        name: bindingName,
        mutable: context.input.program.facts.getFact(element, rustMutatedBindingFactKey) !== undefined,
        type: bindingType,
        init: normalized,
      });
      continue;
    }
    if (nameKind !== KindArrayBindingPattern && nameKind !== KindObjectBindingPattern) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, name),
        "rust.backend.binding-name",
        "Binding pattern leaf has no supported finalized Rust binding form.",
      ));
      return undefined;
    }
    if (context.syntheticNames === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, name),
        "rust.backend.binding-temporary",
        "Nested binding pattern requires a finalized hygienic-name scope.",
      ));
      return undefined;
    }
    const temporary = allocateRustSyntheticName(context.syntheticNames, "binding");
    statements.push({ kind: "let", name: temporary, mutable: false, init: normalized });
    const nested = planRustBindingPattern(
      name,
      { kind: "path", path: temporary },
      fact.bindingCarrier,
      context,
      planExpression,
    );
    if (nested === undefined) {
      return undefined;
    }
    statements.push(...nested);
  }
  return statements;
}

function planBindingProjection(
  source: RustExpr,
  fact: RustBindingProjectionFact,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  switch (fact.projection.kind) {
    case "object-field":
      if (rustSealedOwnedCarrierReadKind(fact.projectedCarrier, context) === undefined) {
        return rejectClone(node, context);
      }
      return readRustStoredObjectField(
        fact.projection.storage,
        fact.sourceCarrier,
        source,
        fact.projection.storageIndex,
        fact.projectedCarrier,
        context,
      );
    case "object-rest":
      return planObjectRest(source, fact, node, context);
    case "tuple-element":
      return ownedProjection(
        { kind: "field", receiver: source, name: String(fact.projection.index) },
        fact.projectedCarrier,
        node,
        context,
      );
    case "fixed-array-element":
      return ownedProjection(indexExpression(source, fact.projection.index), fact.projectedCarrier, node, context);
    case "vec-element": {
      if (fact.projection.checked) {
        if (!rustSealedCarrierSupportsTrait(
          fact.sourceCarrier.kind === "sequence" ? fact.sourceCarrier.element : undefined,
          rustCloneTrait,
          context,
        )) {
          return rejectClone(node, context);
        }
        return {
          kind: "method-call",
          receiver: {
            kind: "method-call",
            receiver: source,
            method: fact.projection.index === 0 ? "first" : "get",
            args: fact.projection.index === 0 ? [] : [integer(fact.projection.index)],
          },
          method: "cloned",
          args: [],
        };
      }
      return ownedProjection(indexExpression(source, fact.projection.index), fact.projectedCarrier, node, context);
    }
    case "js-array-element":
      return {
        kind: "method-call",
        receiver: source,
        method: "get",
        args: [integer(fact.projection.index)],
      };
    case "tuple-rest":
      return planTupleRest(source, fact, node, context);
    case "fixed-array-rest":
      return planArrayRest(source, fact, node, context);
    case "vec-rest":
      return planVecRest(source, fact, node, context);
    case "js-array-rest":
      if (!isRustJsArrayCarrier(fact.bindingCarrier)) {
        return rejectProjection(node, context, "JavaScript array rest projection conflicts with its finalized binding carrier.");
      }
      return {
        kind: "method-call",
        receiver: source,
        method: "slice_from",
        args: [{ kind: "float-literal", text: `${fact.projection.start}.0` }],
      };
  }
}

function planObjectRest(
  source: RustExpr,
  fact: RustBindingProjectionFact,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (fact.projection.kind !== "object-rest") {
    return undefined;
  }
  const target = rustStructuralObjectCarrierValue(fact.bindingCarrier);
  const fields = [...fact.projection.fields]
    .sort((left, right) => left.targetStorageIndex - right.targetStorageIndex);
  if (target === undefined || fields.length !== target.fields.length ||
    fields.some((field, index) =>
      field.targetStorageIndex !== index ||
      !rustTargetTypeRefEquals(field.carrier, target.fields[index]!.type))) {
    return rejectProjection(
      node,
      context,
      "Object rest projection conflicts with its exact finalized structural carrier.",
    );
  }
  const values: RustExpr[] = [];
  for (const field of fields) {
    if (rustSealedOwnedCarrierReadKind(field.carrier, context) === undefined) {
      return rejectClone(node, context);
    }
    const value = readRustStoredObjectField(
      fact.projection.storage,
      fact.sourceCarrier,
      source,
      field.sourceStorageIndex,
      field.carrier,
      context,
    );
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return createRustStructuralObjectFromCarrier(
    fact.bindingCarrier,
    values.map((value) => ({ kind: "stored" as const, value })),
    context,
  );
}

function planTupleRest(
  source: RustExpr,
  fact: RustBindingProjectionFact,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  if (fact.sourceCarrier.kind !== "tuple") {
    return rejectProjection(node, context, "Tuple rest projection has no tuple source carrier.");
  }
  const remaining = fact.sourceCarrier.elements.slice(fact.projection.kind === "tuple-rest" ? fact.projection.start : 0);
  if (!rustTargetTypeRefEquals(rustTupleTargetType(remaining), fact.bindingCarrier)) {
    return rejectProjection(node, context, "Tuple rest projection conflicts with its finalized binding carrier.");
  }
  const elements: RustExpr[] = [];
  for (const [offset, carrier] of remaining.entries()) {
    const value = ownedProjection(
      { kind: "field", receiver: source, name: String((fact.projection.kind === "tuple-rest" ? fact.projection.start : 0) + offset) },
      carrier,
      node,
      context,
    );
    if (value === undefined) {
      return undefined;
    }
    elements.push(value);
  }
  return rustFixedArrayCarrierValue(fact.bindingCarrier) === undefined
    ? { kind: "tuple-literal", elements }
    : { kind: "slice-literal", elements };
}

function planArrayRest(
  source: RustExpr,
  fact: RustBindingProjectionFact,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const fixedSource = rustFixedArrayCarrierValue(fact.sourceCarrier);
  const fixedBinding = rustFixedArrayCarrierValue(fact.bindingCarrier);
  const start = fact.projection.kind === "fixed-array-rest" ? fact.projection.start : 0;
  if (fixedSource === undefined || start > fixedSource.length ||
    (fixedBinding === undefined && !isRustVecCarrier(fact.bindingCarrier))) {
    return rejectProjection(node, context, "Fixed-array rest projection has incompatible finalized carriers.");
  }
  const slice: RustExpr = {
    kind: "index",
    receiver: source,
    index: { kind: "range", start: integer(start), end: integer(fixedSource.length) },
  };
  if (fixedBinding === undefined) {
    return { kind: "method-call", receiver: slice, method: "to_vec", args: [] };
  }
  if (fixedBinding.length !== fixedSource.length - start ||
    !rustTargetTypeRefEquals(fixedBinding.element, fixedSource.element)) {
    return rejectProjection(node, context, "Fixed-array rest length or element carrier is inconsistent.");
  }
  return {
    kind: "method-call",
    receiver: { kind: "method-call", receiver: slice, method: "try_into", args: [] },
    method: "expect",
    args: [{ kind: "str-literal", value: "validated fixed-array destructuring length" }],
  };
}

function planVecRest(
  source: RustExpr,
  fact: RustBindingProjectionFact,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const start = fact.projection.kind === "vec-rest" ? fact.projection.start : 0;
  if (!isRustVecCarrier(fact.sourceCarrier) || !isRustVecCarrier(fact.bindingCarrier) ||
    !rustTargetTypeRefEquals(fact.sourceCarrier.element, fact.bindingCarrier.element) ||
    !rustSealedCarrierSupportsTrait(fact.sourceCarrier.element, rustCloneTrait, context)) {
    return rejectProjection(node, context, "Vector rest projection has incompatible or non-cloneable finalized carriers.");
  }
  return {
    kind: "method-call",
    receiver: {
      kind: "index",
      receiver: source,
      index: {
        kind: "range",
        start: integer(start),
        end: {
          kind: "method-call",
          receiver: source,
          method: "len",
          args: [],
        },
      },
    },
    method: "to_vec",
    args: [],
  };
}

function normalizeBindingValue(
  value: RustExpr,
  fact: RustBindingProjectionFact,
  element: Node,
  context: RustPlanContext,
  planExpression: RustBindingExpressionPlanner,
): RustExpr | undefined {
  const flattened = fact.normalization === "flatten-option" ||
      fact.normalization === "flatten-expect-some" ||
      fact.normalization === "flatten-default-on-none"
    ? { kind: "method-call" as const, receiver: value, method: "flatten", args: [] }
    : value;
  if (fact.normalization === "identity" || fact.normalization === "flatten-option") {
    return flattened;
  }
  if (fact.normalization === "expect-some" || fact.normalization === "flatten-expect-some") {
    return {
      kind: "method-call",
      receiver: flattened,
      method: "expect",
      args: [{ kind: "str-literal", value: "statically non-null destructuring binding" }],
    };
  }
  const initializer = Node_Initializer(context.input.program.source.ast, element);
  const fallback = initializer === undefined ? undefined : planExpression(initializer, context);
  if (fallback === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, element),
      "rust.backend.binding-default",
      "Defaulted binding projection has no concrete finalized fallback expression.",
    ));
    return undefined;
  }
  const activeErrorType = rustActiveErrorType(context);
  if (activeErrorType === undefined) {
    return rustOptionDefaultValue(flattened, fallback);
  }
  const result = (value: RustExpr): RustExpr => ({
    kind: "call",
    path: "Ok",
    genericArguments: [
      { kind: "type", type: { kind: "infer" } },
      { kind: "type", type: activeErrorType },
    ],
    args: [value],
  });
  return {
    kind: "try",
    resultErrorType: activeErrorType,
    operandErrorType: activeErrorType,
    expr: {
      kind: "method-call",
      receiver: flattened,
      method: "map_or_else",
      args: [
        { kind: "closure", params: [], body: result(fallback) },
        { kind: "path", path: "Ok" },
      ],
    },
  };
}

function ownedProjection(
  value: RustExpr,
  carrier: RustBindingProjectionFact["projectedCarrier"],
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const read = rustSealedOwnedCarrierReadKind(carrier, context);
  if (read === "copy") {
    return value;
  }
  if (read !== "clone") {
    return rejectClone(node, context);
  }
  return { kind: "method-call", receiver: value, method: "clone", args: [] };
}

function indexExpression(receiver: RustExpr, index: number): RustExpr {
  return { kind: "index", receiver, index: integer(index) };
}

function integer(value: number): RustExpr {
  return { kind: "int-literal", text: String(value) };
}

function rejectClone(node: Node, context: RustPlanContext): undefined {
  return rejectProjection(node, context, "Binding projection requires an owned value whose exact carrier is not cloneable.");
}

function rejectProjection(node: Node, context: RustPlanContext, message: string): undefined {
  context.diagnostics.push(missingFactDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.binding-projection-carrier",
    message,
  ));
  return undefined;
}
