import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  KindArrayBindingPattern,
  KindIdentifier,
  KindObjectBindingPattern,
  Node_Name,
} from "../../common/source-ast.js";
import {
  rustMutatedBindingFactKey,
  rustSourceParameterAbiFactKey,
} from "../../source/rust-facts/keys.js";
import type { RustFunctionParam, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic } from "./diagnostics.js";
import {
  requireRustCarrierRequirements,
  requireRustLocationValueCarrier,
} from "./generic-requirements.js";
import { planRustBindingPattern } from "./binding-patterns.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustSourceName,
} from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  allocateRustSyntheticName,
} from "./synthetic-names.js";
import type { RustSyntheticNameState } from "./synthetic-names.js";
import { rustLocationStorageForDeclaration } from "./typed-locations.js";
import type { RustBindingExpressionPlanner } from "./binding-patterns.js";

type RustParameterPrelude =
  | { readonly kind: "statement"; readonly statement: RustStmt }
  | {
      readonly kind: "binding";
      readonly pattern: Node;
      readonly name: string;
      readonly sourceCarrier: TargetTypeRef;
    };

export interface RustCallableParameterPlan {
  readonly params: readonly RustFunctionParam[];
  readonly prelude: readonly RustParameterPrelude[];
}

export function planRustCallableParameters(
  callable: Node,
  context: RustPlanContext,
  syntheticNames: RustSyntheticNameState,
  options: { readonly requireStatic: boolean },
): RustCallableParameterPlan | undefined {
  const { ast } = context.input;
  const params: RustFunctionParam[] = [];
  const prelude: RustParameterPrelude[] = [];
  for (const parameter of ast.parameters(callable)) {
    if (parameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, callable),
        "rust.backend.parameter",
        "Callable contains an undefined parameter slot.",
      ));
      return undefined;
    }
    const nameNode = Node_Name(ast, parameter);
    const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
    const pattern = nameNode !== undefined &&
        (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern)
      ? nameNode
      : undefined;
    const abi = context.input.facts.getFact(parameter, rustSourceParameterAbiFactKey);
    const parameterCarrier = abi?.parameterCarrier;
    const parameterType = rustTypeFromCarrierInContext(parameterCarrier, context);
    const parameterName = pattern === undefined
      ? rustSourceName(context, nameNode !== undefined && nameKind === KindIdentifier ? ast.text(nameNode) : "")
      : allocateRustSyntheticName(syntheticNames, "binding_parameter");
    if (!isValidRustIdentifier(parameterName) || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.parameter",
        `Parameter '${parameterName}' has no supported Rust carrier fact.`,
      ));
      return undefined;
    }
    if (options.requireStatic && parameterCarrier !== undefined &&
      !requireRustCarrierRequirements(parameterCarrier, ["static"], parameter, context)) {
      return undefined;
    }
    const sourceCarrier = context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
    const locationStorage = rustLocationStorageForDeclaration(parameter, context);
    if (pattern !== undefined &&
      (abi?.mode !== "value" || sourceCarrier === undefined || parameterCarrier === undefined ||
        !rustTargetTypeRefEquals(sourceCarrier, parameterCarrier) || locationStorage !== undefined)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.binding-parameter-abi",
        "Binding-pattern parameters require one exact by-value Rust source and parameter carrier.",
      ));
      return undefined;
    }
    if (locationStorage !== undefined &&
      (parameterCarrier === undefined ||
        !rustTargetTypeRefEquals(parameterCarrier, locationStorage.valueCarrier))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.typed-location-parameter-carrier",
        `Promoted parameter '${parameterName}' conflicts with its finalized parameter carrier.`,
      ));
      return undefined;
    }
    params.push({
      name: parameterName,
      type: parameterType,
      mutable: pattern === undefined && locationStorage === undefined &&
        context.input.facts.getFact(parameter, rustMutatedBindingFactKey) !== undefined,
    });
    if (pattern !== undefined && sourceCarrier !== undefined) {
      prelude.push({ kind: "binding", pattern, name: parameterName, sourceCarrier });
      continue;
    }
    if (locationStorage === undefined) {
      continue;
    }
    if (!requireRustLocationValueCarrier(locationStorage.valueCarrier, parameter, context)) {
      return undefined;
    }
    context.usedAliases?.add("rt");
    prelude.push({
      kind: "statement",
      statement: {
        kind: "let",
        name: parameterName,
        mutable: false,
        init: {
          kind: "call",
          path: "rt::Location::allocate",
          args: [{ kind: "path", path: parameterName }],
        },
      },
    });
  }
  return { params, prelude };
}

export function planRustCallableParameterPrelude(
  plan: RustCallableParameterPlan,
  context: RustPlanContext,
  planExpression: RustBindingExpressionPlanner,
): readonly RustStmt[] | undefined {
  const statements: RustStmt[] = [];
  for (const entry of plan.prelude) {
    if (entry.kind === "statement") {
      statements.push(entry.statement);
      continue;
    }
    const binding = planRustBindingPattern(
      entry.pattern,
      { kind: "path", path: entry.name },
      entry.sourceCarrier,
      context,
      planExpression,
    );
    if (binding === undefined) {
      return undefined;
    }
    statements.push(...binding);
  }
  return statements;
}
