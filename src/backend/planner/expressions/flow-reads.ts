import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustRuntimeUnionProjection } from "../../../target-model/types/carriers/runtime-unions.js";
import { rustUnionTypePathInContext } from "../types/render.js";
import {
  isRustCopyCarrier,
  isRustJsValueCarrier,
  isRustProgramErrorCarrier,
  rustJsErrorTargetType,
  rustCarrierSupportsClone,
} from "../../../target-model/types/index.js";
import type { RustFlowReadProjectionFact } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustProjectDowncastValue } from "../objects/project-downcasts.js";
import { planRustProgramErrorFlowRead } from "./error-operations.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { rustTargetOperationFactKey } from "../../../analysis/facts/keys.js";
import {
  allocateRustSyntheticName,
  createRustSyntheticNameState,
} from "../names/synthetic.js";

export function planRustFlowReadProjection(
  node: Node,
  expression: RustExpr,
  fact: RustFlowReadProjectionFact,
  context: RustPlanContext,
): RustExpr | undefined {
  const sourceCarrier = context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
  if (sourceCarrier === undefined ||
    !rustTargetTypeRefEquals(sourceCarrier, fact.sourceCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.flow-read-source",
      "The finalized flow-read projection conflicts with the expression's raw Rust carrier.",
    ));
    return undefined;
  }
  const override = context.flowReadOverrides?.get(node);
  if (override !== undefined) {
    if (!rustTargetTypeRefEquals(override.sourceCarrier, fact.sourceCarrier) ||
      !rustTargetTypeRefEquals(override.selectedCarrier, fact.selectedCarrier)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-read-override",
        "The exact branch-local flow-read selection conflicts with finalized source evidence.",
      ));
      return undefined;
    }
    return override.expression;
  }
  if (fact.kind === "builtin-error") {
    if ((!isRustJsValueCarrier(fact.sourceCarrier) && !(isRustProgramErrorCarrier(fact.sourceCarrier) &&
      context.input.program.projectTypes.builtinErrorProjectionAvailable === true)) ||
      !rustTargetTypeRefEquals(fact.selectedCarrier, rustJsErrorTargetType())) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.builtin-error-projection",
        "The selected builtin Error projection has contradictory native carriers."));
      return undefined;
    }
    return { kind: "method-call", receiver: planRustNonConsumingValue(node, expression, context), method: "error_value", args: [] };
  }
  if (fact.kind === "runtime-union") {
    if (rustRuntimeUnionProjection(fact.sourceCarrier, fact.selectedCarrier) !== fact.method) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node), "rust.backend.runtime-union-projection",
        "The finalized native union projection conflicts with its exact carrier contract.",
      ));
      return undefined;
    }
    return { kind: "method-call", receiver: planRustNonConsumingValue(node, expression, context), method: fact.method, args: [] };
  }
  const operation = context.input.program.facts.getFact(node, rustTargetOperationFactKey);
  const ownsValue = context.input.program.valueLifetimes.canMove(node) ||
    operation?.kind === "provider-operation" &&
      (operation.abi.target.form === "method" || operation.abi.target.form === "call" ||
        operation.abi.target.form === "receiver-method") &&
      operation.abi.result.kind === "sync" && operation.abi.result.carrier.kind !== "reference" &&
      rustTargetTypeRefEquals(operation.abi.result.carrier, fact.sourceCarrier);
  if (fact.kind === "source-union") {
    const variants = context.input.program.typeDefinitions.sourceUnionVariants(fact.sourceCarrier);
    const path = rustUnionTypePathInContext(fact.sourceCarrier, context);
    const selected = variants?.filter(variant => variant.name === fact.variant &&
      rustTargetTypeRefEquals(variant.carrier, fact.selectedCarrier));
    if (path === undefined || selected?.length !== 1 ||
      !ownsValue && !rustCarrierSupportsClone(fact.selectedCarrier, context.input.program.typeDefinitions) &&
        !requireRustCarrierRequirements(fact.selectedCarrier, ["clone"], node, context)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.source-union-projection", "The selected union payload has no exact non-consuming projection."));
      return undefined;
    }
    const name = allocateRustSyntheticName(context.syntheticNames ??
      createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_value");
    return bindRustFlowMatchSubject({ kind: "match", expression: ownsValue ? expression : { kind: "reference", expr: expression }, arms: [
      { pattern: { kind: "tuple-variant", path: `${path}::${fact.variant}`,
        elements: [{ kind: "binding", name }] },
        expression: ownsValue ? { kind: "path", path: name }
          : isRustCopyCarrier(fact.selectedCarrier)
            ? { kind: "dereference", pointer: { kind: "path", path: name } }
            : { kind: "method-call", receiver: { kind: "path", path: name }, method: "clone", args: [] } },
      { pattern: { kind: "wildcard" }, expression: { kind: "unreachable",
        message: "TSTS-selected source refinement excluded this union variant" } },
    ] }, node, context);
  }
  if (fact.kind === "option-value") {
    if (!ownsValue && !rustCarrierSupportsClone(fact.selectedCarrier, context.input.program.typeDefinitions) &&
      (context.callableDeclaration === undefined ||
        !requireRustCarrierRequirements(fact.selectedCarrier, ["clone"], node, context))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.flow-read-projection-clone",
        "A narrowed optional Rust value requires a selected carrier with a proven non-consuming clone contract.",
      ));
      return undefined;
    }
    const valueName = allocateRustSyntheticName(
      context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
      "flow_value",
    );
    return bindRustFlowMatchSubject({
      kind: "match",
      expression: ownsValue ? expression : {
        kind: "method-call",
        receiver: expression,
        method: "as_ref",
        args: [],
      },
      arms: [
        {
          pattern: {
            kind: "tuple-variant",
            path: "Some",
            elements: [{ kind: "binding", name: valueName }],
          },
          expression: ownsValue ? { kind: "path", path: valueName } : isRustCopyCarrier(fact.selectedCarrier)
            ? {
                kind: "dereference",
                pointer: { kind: "path", path: valueName },
              }
            : {
                kind: "method-call",
                receiver: { kind: "path", path: valueName },
                method: "clone",
                args: [],
              },
        },
        {
          pattern: { kind: "path", path: "None" },
          expression: {
            kind: "unreachable",
            message: "checked flow selected a missing optional value",
          },
        },
      ],
    }, node, context);
  }
  if (fact.kind === "program-error-variant") {
    return planRustProgramErrorFlowRead(node, expression, fact, context);
  }
  return planRustProjectDowncastValue(
    node,
    expression,
    fact.sourceCarrier,
    fact.dispatchCarrier,
    fact.selectedCarrier,
    context,
  );
}

function bindRustFlowMatchSubject(
  expression: Extract<RustExpr, { readonly kind: "match" }>,
  node: Node,
  context: RustPlanContext,
): RustExpr {
  if (expression.expression.kind !== "evaluate-then" &&
    (expression.expression.kind !== "block" || expression.expression.bindings.length === 0)) {
    return expression;
  }
  if (context.input.program.configuration.edition === "2021") {
    return {
      kind: "block",
      valueAttrs: [rustLintAttributes.matchTemporaryScope],
      bindings: [],
      value: expression,
    };
  }
  const name = allocateRustSyntheticName(
    context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []),
    "flow_input",
  );
  return {
    kind: "block",
    bindings: [{ name, value: expression.expression }],
    value: { ...expression, expression: { kind: "path", path: name } },
  };
}
