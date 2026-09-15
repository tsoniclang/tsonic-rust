import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustRuntimeUnionProjection } from "../../../target-model/types/carriers/runtime-unions.js";
import { rustSourceUnionCarrierValue } from "../../../target-model/types/carriers/source-types.js";
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
import { missingFactDiagnostic } from "../diagnostics.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustProjectDowncastValue } from "../objects/project-downcasts.js";
import { planRustProgramErrorFlowRead } from "./error-operations.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
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
  if (fact.kind === "source-union") {
    const union = rustSourceUnionCarrierValue(fact.sourceCarrier);
    const path = rustUnionTypePathInContext(fact.sourceCarrier, context);
    const selected = union?.variants.filter(variant => variant.name === fact.variant &&
      rustTargetTypeRefEquals(variant.carrier, fact.selectedCarrier));
    if (path === undefined || selected?.length !== 1 ||
      !rustCarrierSupportsClone(fact.selectedCarrier) &&
        !requireRustCarrierRequirements(fact.selectedCarrier, ["clone"], node, context)) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.source-union-projection", "The selected union payload has no exact non-consuming projection."));
      return undefined;
    }
    const name = allocateRustSyntheticName(context.syntheticNames ??
      createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_value");
    return { kind: "match", expression: { kind: "reference", expr: expression }, arms: [
      { pattern: { kind: "tuple-variant", path: `${path}::${fact.variant}`,
        elements: [{ kind: "binding", name }] },
        expression: { kind: "method-call", receiver: { kind: "path", path: name }, method: "clone", args: [] } },
      { pattern: { kind: "wildcard" }, expression: { kind: "unreachable",
        message: "TSTS-selected source refinement excluded this union variant" } },
    ] };
  }
  if (fact.kind === "option-value") {
    if (!rustCarrierSupportsClone(fact.selectedCarrier) &&
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
    return {
      kind: "match",
      expression: {
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
          expression: isRustCopyCarrier(fact.selectedCarrier)
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
    };
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
