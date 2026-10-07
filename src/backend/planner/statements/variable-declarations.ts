import {
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "@tsonic/target-api/source";
import { rustBindingStorageForDeclaration } from "../expressions/typed-locations.js";
import { rustNativeArrayStorageKey } from "../../../target-model/operations/native-memory.js";
import { nativeRustArrayType } from "../expressions/native-arrays.js";
import {
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustResourceManagementFactKey,
  rustTargetOperationFactKey,
} from "../../../analysis/facts/keys.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations, resourceDisposalReceiverMode } from "./resources.js";
import { diagnosticInput, isValidRustIdentifier } from "../program/plan-context.js";
import {
  rustCarrierReferentMutationRequiresMutableBinding,
  rustOptionElementCarrier,
  rustCallableProtocol,
} from "../../../target-model/types/index.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import { planRustBindingPattern } from "../bindings/patterns.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCompileTimeSourceKey } from "../../../target-model/facts/source-declarations.js";
import { planRustLocalBindingStorage } from "../bindings/local-storage.js";
import { planRustBorrowedInitializer } from "../bindings/borrowed-initializers.js";

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
  if (context.input.program.facts.getFact(declaration, rustCompileTimeSourceKey)) return [];
  const storageOwner = context.input.program.localStorageAliases.owner(declaration);
  if (storageOwner !== undefined && storageOwner !== declaration) return [];
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
  const nativeArray = context.input.program.facts.getFact(declaration, rustNativeArrayStorageKey);
  const locationStorage = nativeArray === undefined ? rustBindingStorageForDeclaration(declaration, context) : undefined;
  const initializerPlan = initializer === undefined ? undefined : planRustBorrowedInitializer(initializer, context);
  const sourceInitializer = initializerPlan?.value;
  if (initializer !== undefined && sourceInitializer === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(context.input.program.source.ast, declaration);
  const annotatedCarrier = typeNode === undefined
    ? undefined
    : context.input.program.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  if (typeNode !== undefined && annotatedCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, typeNode),
      "rust.backend.variable",
      "Variable type annotation has no finalized Rust carrier fact.",
    ));
    return undefined;
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
  const planned: RustExpr | undefined = initializer === undefined && rustOptionElementCarrier(declarationCarrier) !== undefined
    ? { kind: "none" } : sourceInitializer;
  if (planned === undefined && locationStorage !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage",
      "Promoted Rust location storage requires a source initializer or a native absence carrier.",
    ));
    return undefined;
  }
  let rustType: RustType | undefined = rustTypeFromCarrierInContext(declarationCarrier, context);
  if (rustType === undefined && (initializer === undefined || typeNode !== undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, typeNode ?? declaration),
      "rust.backend.variable",
      "Variable declaration has no renderable finalized Rust carrier.",
    ));
    return undefined;
  }
  const ownedBinding = declarationCarrier.kind !== "pointer" && declarationCarrier.kind !== "reference";
  if (nativeArray !== undefined) {
    rustType = nativeRustArrayType(declaration, context);
    if (rustType === undefined) return undefined;
  }
  const resourceFact = context.input.program.facts.getFact(declaration, rustResourceManagementFactKey);
  const sourceUseSummary = context.input.program.sourceNavigation.declarationUseSummary(declaration);
  const objectRepresentation = context.input.program.objectRepresentations.representationFor(
    context.input.program.projectTypes.definitionForCarrier(declarationCarrier),
  );
  const referentMutationRequiresMutableBinding =
    rustCarrierReferentMutationRequiresMutableBinding(declarationCarrier, carrier => {
      const representation = context.input.program.objectRepresentations.representationFor(
        context.input.program.projectTypes.definitionForCarrier(carrier));
      return representation !== undefined && (representation.kind !== "value" || !representation.mutable);
    });
  const mutable = nativeArray !== undefined ? sourceUseSummary.bindingWritten : locationStorage?.iterationScope !== undefined || locationStorage === undefined &&
    (context.input.program.localStorageAliases.requiresMutableOwner(declaration) || sourceUseSummary.bindingWritten ||
      context.input.program.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
      (objectRepresentation?.kind === "value" && objectRepresentation.mutable && sourceUseSummary.memberWritten) ||
      (ownedBinding && referentMutationRequiresMutableBinding &&
        context.input.program.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined) ||
      resourceFact !== undefined && resourceDisposalReceiverMode(resourceFact) === "mut-ref");
  const storage = planRustLocalBindingStorage(declaration, name, declarationCarrier, rustType, planned, locationStorage, context);
  if (storage === undefined) return undefined;
  if (storage.kind === "store") return [...initializerPlan?.statements ?? [], storage.statement];
  rustType = storage.type;
  const init = storage.value;
  if (initializer !== undefined && init === undefined) {
    return undefined;
  }
  const initializerOperation = initializer === undefined ? undefined
    : context.input.program.facts.getFact(initializer, rustTargetOperationFactKey);
  const selfTypedCallable = locationStorage === undefined && initializerOperation?.kind === "closure" &&
    rustCallableProtocol(declarationCarrier) !== undefined &&
    rustTargetTypeRefEquals(initializerOperation.resultCarrier, declarationCarrier);
  return [...initializerPlan?.statements ?? [], {
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined || selfTypedCallable ? {} : { type: rustType }),
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
