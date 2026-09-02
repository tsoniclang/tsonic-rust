import {
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "@tsonic/target-api/source";
import { rustLocationStorageForDeclaration } from "../expressions/typed-locations.js";
import {
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustResourceManagementFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, resourceDisposalReceiverMode } from "./resources.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import {
  rustCarrierReferentMutationRequiresMutableBinding,
  rustLocationTargetType,
  rustOptionElementCarrier,
} from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planVariableStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length === 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.variable",
      "Variable statement has no exact variable declaration.",
    ));
    return undefined;
  }
  const statements: RustStmt[] = [];
  for (const declaration of declarations) {
    const planned = planVariableDeclaration(declaration, context);
    if (planned === undefined) {
      return undefined;
    }
    statements.push(...planned);
  }
  return statements;
}
function planVariableDeclaration(
  declaration: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input.program.source;
  const nameNode = Node_Name(context.input.program.source.ast, declaration);
  const nameKind = nameNode === undefined ? "" : ast.kindName(nameNode);
  if (nameNode !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern)) {
    return planBindingVariableDeclaration(declaration, nameNode, context);
  }
  const name = context.input.program.names.nameForDeclaration(declaration) ?? "";
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require a plain identifier that is valid in Rust.",
    ));
    return undefined;
  }
  const initializer = Node_Initializer(context.input.program.source.ast, declaration);
  const locationStorage = rustLocationStorageForDeclaration(declaration, context);
  if (initializer === undefined && locationStorage !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage",
      "Promoted Rust location storage requires an initialized source binding.",
    ));
    return undefined;
  }
  const planned = initializer === undefined ? undefined : planExpression(initializer, context);
  if (initializer !== undefined && planned === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(context.input.program.source.ast, declaration);
  const annotatedCarrier = typeNode === undefined
    ? undefined
    : context.input.program.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  let rustType;
  if (typeNode !== undefined) {
    const renderedCarrier = locationStorage === undefined
      ? annotatedCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
    if (rustType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, typeNode),
        "rust.backend.variable",
        "Variable type annotation has no supported Rust carrier fact.",
      ));
      return undefined;
    }
  }
  const declarationCarrier = context.input.program.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (declarationCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable-carrier",
      "Variable declaration has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  if (rustType === undefined) {
    const renderedCarrier = locationStorage === undefined
      ? declarationCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
    if (rustType === undefined && initializer === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.variable",
        "Uninitialized variable declaration has no renderable finalized Rust carrier.",
      ));
      return undefined;
    }
  }
  if (locationStorage !== undefined &&
    (!rustTargetTypeRefEquals(declarationCarrier, locationStorage.valueCarrier) ||
      (annotatedCarrier !== undefined &&
        !rustTargetTypeRefEquals(annotatedCarrier, locationStorage.valueCarrier)))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage-carrier",
      "Promoted Rust storage conflicts with its finalized declaration carrier.",
    ));
    return undefined;
  }
  const ownedBinding = declarationCarrier.kind !== "pointer" && declarationCarrier.kind !== "reference";
  const resourceFact = context.input.program.facts.getFact(declaration, rustResourceManagementFactKey);
  const sourceUseSummary = context.input.program.sourceNavigation.declarationUseSummary(declaration);
  const objectRepresentation = context.input.program.objectRepresentations.representationFor(
    context.input.program.projectTypes.definitionForCarrier(declarationCarrier),
  );
  const referentMutationRequiresMutableBinding =
    rustCarrierReferentMutationRequiresMutableBinding(declarationCarrier) &&
    (objectRepresentation === undefined || objectRepresentation.kind === "value");
  const mutable = locationStorage === undefined &&
    (sourceUseSummary.bindingWritten ||
      context.input.program.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
      (objectRepresentation?.kind === "value" && sourceUseSummary.memberWritten) ||
      (ownedBinding && referentMutationRequiresMutableBinding &&
        context.input.program.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined) ||
      resourceFact !== undefined && resourceDisposalReceiverMode(resourceFact) === "mut-ref");
  let init: RustExpr | undefined;
  if (initializer !== undefined) {
    if (planned === undefined) {
      return undefined;
    }
    if (locationStorage === undefined) {
      init = planned;
    } else {
      if (!requireRustLocationValueCarrier(
        locationStorage.valueCarrier,
        declaration,
        context,
      )) {
        return undefined;
      }
      context.usedAliases?.add("rt");
      init = { kind: "call", path: "rt::Location::allocate", args: [planned] };
    }
  } else if (rustOptionElementCarrier(declarationCarrier) !== undefined && rustType !== undefined) {
    init = { kind: "none" };
  }
  if (initializer !== undefined && init === undefined) {
    return undefined;
  }
  return [{
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined ? {} : { type: rustType }),
    ...(init === undefined ? {} : { init }),
  }];
}

function planBindingVariableDeclaration(
  declaration: Node,
  pattern: Node,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const initializer = Node_Initializer(context.input.program.source.ast, declaration);
  const sourceCarrier = context.input.program.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (initializer === undefined || sourceCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.binding-declaration",
      "Binding-pattern declaration requires an initializer and one finalized source carrier.",
    ));
    return undefined;
  }
  if (context.syntheticNames === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, pattern),
      "rust.backend.binding-temporary",
      "Binding-pattern declaration requires a finalized hygienic-name scope.",
    ));
    return undefined;
  }
  const value = planExpression(initializer, context);
  if (value === undefined) {
    return undefined;
  }
  const temporary = allocateRustSyntheticName(context.syntheticNames, "binding");
  const bindings = planRustBindingPattern(
    pattern,
    { kind: "path", path: temporary },
    sourceCarrier,
    context,
    planExpression,
  );
  return bindings === undefined
    ? undefined
    : [{ kind: "let", name: temporary, mutable: false, init: value }, ...bindings];
}
