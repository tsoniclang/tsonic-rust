import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  Node_Initializer,
  Node_Name,
} from "@tsonic/target-api/source";
import {
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustSourceParameterAbiFactKey,
} from "../../../analysis/facts/keys.js";
import type { RustFunctionParam, RustStmt } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import {
  requireRustCarrierRequirements,
  requireRustLocationValueCarrier,
} from "../types/generic-requirements.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
} from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import {
  allocateRustSyntheticName,
} from "../names/synthetic.js";
import type { RustSyntheticNameState } from "../names/synthetic.js";
import { rustLocationStorageForDeclaration } from "../expressions/typed-locations.js";
import type { RustBindingExpressionPlanner } from "../bindings/patterns.js";
import { rustOptionDefaultValue } from "../option-default.js";
import { rustCarrierReferentMutationRequiresMutableBinding } from "../../../policy/types/target-types.js";

type RustParameterPrelude =
  | { readonly kind: "statement"; readonly statement: RustStmt }
  | {
      readonly kind: "default";
      readonly initializer: Node;
      readonly name: string;
      readonly mutable: boolean;
    }
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
  const { ast } = context.input.program.source;
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
    const abi = context.input.program.facts.getFact(parameter, rustSourceParameterAbiFactKey);
    const parameterCarrier = abi?.parameterCarrier;
    const parameterType = rustTypeFromCarrierInContext(parameterCarrier, context);
    const parameterName = pattern === undefined
      ? context.input.program.names.nameForDeclaration(parameter) ?? ""
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
    const sourceCarrier = context.input.program.facts.getRuntimeCarrierFact(parameter)?.carrier;
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
      (abi?.valueCarrier === undefined ||
        !rustTargetTypeRefEquals(abi.valueCarrier, locationStorage.valueCarrier))) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.typed-location-parameter-carrier",
        `Promoted parameter '${parameterName}' conflicts with its finalized parameter carrier.`,
      ));
      return undefined;
    }
    const ownedBinding = parameterCarrier !== undefined &&
      parameterCarrier.kind !== "pointer" &&
      parameterCarrier.kind !== "reference";
    const objectRepresentation = context.input.program.objectRepresentations.representationFor(
      context.input.program.projectTypes.definitionForCarrier(parameterCarrier),
    );
    const referentMutationRequiresMutableBinding =
      rustCarrierReferentMutationRequiresMutableBinding(parameterCarrier) &&
      (objectRepresentation === undefined || objectRepresentation.kind === "value");
    const mutable = pattern === undefined &&
      locationStorage === undefined &&
      (
        context.input.program.facts.getFact(
          parameter,
          rustMutatedBindingFactKey,
        ) !== undefined ||
        ownedBinding && referentMutationRequiresMutableBinding &&
          context.input.program.facts.getFact(
            parameter,
            rustMutatedReferentFactKey,
          ) !== undefined
      );
    params.push({
      name: parameterName,
      type: parameterType,
      mutable: abi?.form !== "default" && mutable,
    });
    if (abi?.form === "default") {
      const initializer = Node_Initializer(ast, parameter);
      if (initializer === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, parameter),
          "rust.backend.default-parameter-initializer",
          "Default-parameter ABI requires one exact authored initializer.",
        ));
        return undefined;
      }
      prelude.push({
        kind: "default",
        initializer,
        name: parameterName,
        mutable,
      });
    }
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
    if (entry.kind === "default") {
      const initializer = planExpression(entry.initializer, context);
      if (initializer === undefined) {
        return undefined;
      }
      statements.push({
        kind: "let",
        name: entry.name,
        mutable: entry.mutable,
        init: rustOptionDefaultValue({ kind: "path", path: entry.name }, initializer),
      });
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
