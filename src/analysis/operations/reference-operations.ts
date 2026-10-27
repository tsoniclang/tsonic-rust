import { type Node, type ProviderDeclarationIdentity, type SourceFile, type Type } from "@tsonic/tsts";
import { type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { type RustAnalysisProgram } from "../program/model.js";
import { type RustReferenceOperationProducer } from "../program/records/operations/reference-operations.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustStringCarrier, rustUnitTargetType } from "../../target-model/types/index.js";
import { rustValueCarrierBeforeOptionProjection } from "../conversions/value-carrier-queries.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { BinaryExpression_Left, BinaryExpression_Right, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import { appendRustDiagnostic, type RustFactWalk } from "../program/walk.js";
import { setCarrierFact } from "./project-calls.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { recordBindingWrite } from "../ownership/source-writes.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import { selectRustEquivalentAssignment } from "../../policy/operations/operators/rules.js";
import { rustSourceOperationExportIds, rustSourceOperationSignatureIds } from "../../target-model/identities/source.js";
import { readRustLanguageCall } from "./native-language-call.js";
import { type TargetTypeRef } from "../../target-model/types/model.js";
import { type RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import type { RustReferenceOperationRecipe } from "../../target-model/records/operations/reference-operations.js";

export function analyzeRustReferenceOperations(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustReferenceOperationProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const call of nodes) {
    const fact = program.records.targetOperation.get(call);
    if (fact?.kind !== "reference-operation") continue;
    const argumentsList = program.source.ast.arguments(call);
    const expected = fact.operation === "store" ? [fact.operandExpression, fact.valueExpression] : [fact.operandExpression];
    if (!isDenseDataArray(argumentsList) || argumentsList.length !== expected.length || argumentsList.some((argument, index) => argument !== expected[index])) {
      refuse(call, "RUST_REFERENCE_OPERATION_ARGUMENT_CONFLICT", "Rust reference operation arguments conflict with the exact finalized source occurrence.");
      continue;
    }
    if (!rustTargetTypeRefEquals(rustValueCarrierBeforeOptionProjection(program.records, fact.operandExpression), fact.operandCarrier)) {
      refuse(call, "RUST_REFERENCE_OPERATION_OPERAND_CONFLICT", "Rust reference operation operand conflicts with its finalized target carrier.");
      continue;
    }
    if (fact.operation === "load" && (!rustTargetTypeRefEquals(fact.referenceCarrier, fact.operandCarrier) ||
      !rustTargetTypeRefEquals(fact.resultCarrier, fact.operandCarrier.referent) || !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(call)?.carrier, fact.resultCarrier))) {
      refuse(call, "RUST_REFERENCE_LOAD_VALUE_CONFLICT", "Rust reference load conflicts with its exact reference and result carrier relationship.");
      continue;
    }
    if (fact.operation === "store") {
      if (!rustTargetTypeRefEquals(program.records.runtimeCarrier.get(fact.valueExpression)?.carrier, fact.valueCarrier)) {
        refuse(call, "RUST_REFERENCE_STORE_VALUE_CONFLICT", "Rust reference store value conflicts with its finalized target carrier.");
        continue;
      }
      if (program.ownership.reads.get(fact.operandExpression) === undefined) {
        refuse(call, "RUST_REFERENCE_STORE_OWNERSHIP_MISSING", "Rust reference store requires its finalized native target ownership.");
        continue;
      }
    }
    if (fact.operation === "store") {
      const recipe = referenceStoreRecipe(program, fact);
      Object.freeze(recipe.evaluation);
      producer.publish(call, { operation: fact, recipe: Object.freeze(recipe) });
    } else if (fact.operation === "load") producer.publish(call, { operation: fact, recipe: Object.freeze({ kind: "load",
      form: program.ownership.reads.get(call)?.sharedReference === true ? "reference"
        : !fact.operandCarrier.mutable && isRustStringCarrier(fact.operandCarrier.referent) ? "owned-string" : "dereference" }) });
    else if (fact.operation === "shared-reference") producer.publish(call, { operation: fact, recipe: Object.freeze({ kind: "shared-reference" }) });
    else producer.publish(call, { operation: fact, recipe: Object.freeze({ kind: "mutable-reference" }) });
  }
  return Object.freeze(issues);
}



















type RustSourceReferenceOperationKind =
  | "shared-reference"
  | "mutable-reference"
  | "load"
  | "store";

interface RustSourceReferenceOperationBase {
  readonly call: Node;
  readonly resultType: Type;
  readonly selectedDeclaration: ProviderDeclarationIdentity;
}

type RustSourceReferenceOperation =
  | RustSourceReferenceOperationBase & {
      readonly kind: "shared-reference";
      readonly valueExpression: Node;
      readonly valueType: Type;
      readonly lifetimeTypeNode?: Node;
    }
  | RustSourceReferenceOperationBase & {
      readonly kind: "mutable-reference";
      readonly valueExpression: Node;
      readonly valueType: Type;
      readonly lifetimeTypeNode?: Node;
    }
  | RustSourceReferenceOperationBase & {
      readonly kind: "load";
      readonly referenceExpression: Node;
      readonly referenceType: Type;
    }
  | RustSourceReferenceOperationBase & {
      readonly kind: "store";
      readonly referenceExpression: Node;
      readonly referenceType: Type;
      readonly valueExpression: Node;
      readonly valueType: Type;
    };

const referenceOperationBySignature = new Map<string, {
  readonly exportId: string;
  readonly kind: RustSourceReferenceOperationKind;
}>([
  [rustSourceOperationSignatureIds.sharedReference, {
    exportId: rustSourceOperationExportIds.sharedReference,
    kind: "shared-reference",
  }],
  [rustSourceOperationSignatureIds.mutableReference, {
    exportId: rustSourceOperationExportIds.mutableReference,
    kind: "mutable-reference",
  }],
  [rustSourceOperationSignatureIds.loadShared, {
    exportId: rustSourceOperationExportIds.load,
    kind: "load",
  }],
  [rustSourceOperationSignatureIds.loadMutable, {
    exportId: rustSourceOperationExportIds.load,
    kind: "load",
  }],
  [rustSourceOperationSignatureIds.store, {
    exportId: rustSourceOperationExportIds.store,
    kind: "store",
  }],
]);

export function readRustReferenceOperation(
  walk: RustFactWalk,
  expression: Node,
): RustSourceReferenceOperation | undefined {
  const selected = readRustLanguageCall(walk, expression);
  if (selected === undefined) return undefined;
  const { selection, declaration } = selected;
  const operation = declaration.signatureId !== undefined
    ? referenceOperationBySignature.get(declaration.signatureId)
    : undefined;
  const reference = selection.sourceArguments[0];
  const value = selection.sourceArguments[1];
  if (declaration === undefined || operation === undefined ||
    declaration.exportId !== operation.exportId || reference === undefined ||
    (operation.kind === "store" && value === undefined)) {
    return undefined;
  }
  const base = {
    call: expression,
    resultType: selection.sourceResultType,
    selectedDeclaration: declaration,
  };
  if (operation.kind === "shared-reference" || operation.kind === "mutable-reference") {
    const typeArguments = walk.context.ast.typeArguments(expression);
    const lifetimeTypeNode = typeArguments.length === 2 ? typeArguments[1] : undefined;
    return {
      ...base,
      kind: operation.kind,
      valueExpression: reference.expression,
      valueType: reference.type,
      ...(lifetimeTypeNode === undefined ? {} : { lifetimeTypeNode }),
    };
  }
  if (operation.kind === "load") {
    return {
      ...base,
      kind: operation.kind,
      referenceExpression: reference.expression,
      referenceType: reference.type,
    };
  }
  return {
    ...base,
    kind: operation.kind,
    referenceExpression: reference.expression,
    referenceType: reference.type,
    valueExpression: value!.expression,
    valueType: value!.type,
  };
}

export function resolvedRustReferenceOperationCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  source: RustSourceReferenceOperation,
  expected: TargetTypeRef | undefined,
): { readonly carrier?: TargetTypeRef } {
  if (source.call !== expression || source.selectedDeclaration.signatureId === undefined) {
    return rejectRustReferenceOperation(
      walk,
      expression,
      "RUST_REFERENCE_OPERATION_IDENTITY_CONFLICT",
      "Rust reference operation has no exact selected call and signature identity.",
    );
  }
  if (source.kind === "shared-reference") {
    return resolvedRustReferenceConstruction(
      walk,
      expression,
      sourceFile,
      source,
      expected,
      false,
    );
  }
  if (source.kind === "mutable-reference") {
    return resolvedRustReferenceConstruction(
      walk,
      expression,
      sourceFile,
      source,
      expected,
      true,
    );
  }

  const operandCarrier = resolveExpressionCarrier(
    walk,
    source.referenceExpression,
    sourceFile,
    undefined,
  );
  if (operandCarrier?.kind !== "reference") {
    return rejectRustReferenceOperation(
      walk,
      expression,
      "RUST_REFERENCE_OPERATION_INPUT_CONFLICT",
      `Rust '${source.kind}' requires one exact native reference operand.`,
    );
  }
  if (source.kind === "load") {
    const fact: Extract<
      RustTargetOperationFact,
      { readonly kind: "reference-operation"; readonly operation: "load" }
    > = {
      kind: "reference-operation",
      operationId: "tsonic.rust.reference.load",
      operation: source.kind,
      operandExpression: source.referenceExpression,
      operandCarrier,
      referenceCarrier: operandCarrier,
      resultCarrier: operandCarrier.referent,
    };
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/operations/reference-operations.ts");
    walk.context.records.targetOperations.source(expression, fact);
    return { carrier: setCarrierFact(walk, expression, fact.resultCarrier) };
  }
  if (!operandCarrier.mutable) {
    return rejectRustReferenceOperation(
      walk,
      expression,
      "RUST_REFERENCE_STORE_REQUIRES_MUTABLE",
      "Rust reference store requires an exact mutable reference operand.",
    );
  }
  const valueCarrier = resolveExpressionCarrier(
    walk,
    source.valueExpression,
    sourceFile,
    operandCarrier.referent,
  );
  if (valueCarrier === undefined ||
    !rustTargetTypeRefEquals(valueCarrier, operandCarrier.referent)) {
    return rejectRustReferenceOperation(
      walk,
      expression,
      "RUST_REFERENCE_STORE_VALUE_CONFLICT",
      "Rust reference store value does not have the exact referenced target carrier.",
    );
  }
  const resultCarrier = rustUnitTargetType();
  const fact: Extract<
    RustTargetOperationFact,
    { readonly kind: "reference-operation"; readonly operation: "store" }
  > = {
    kind: "reference-operation",
    operationId: "tsonic.rust.reference.store",
    operation: source.kind,
    operandExpression: source.referenceExpression,
    operandCarrier,
    referenceCarrier: operandCarrier,
    valueExpression: source.valueExpression,
    valueCarrier,
    resultCarrier,
  };
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/operations/reference-operations.ts");
  walk.context.records.targetOperations.source(expression, fact);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

function referenceStoreRecipe(program: Omit<RustAnalysisProgram, "reachability">,
  fact: Extract<RustTargetOperationFact, { readonly kind: "reference-operation"; readonly operation: "store" }>):
  Extract<RustReferenceOperationRecipe, { readonly kind: "store" }> {
  const { ast } = program.source;
  const target = referenceOperand(program, fact.operandExpression);
  const binding = program.records.sourceBinding.get(target);
  const summary = binding?.scope === "lexical" ? program.sourceNavigation.declarationUseSummary(binding.sourceDeclaration) : undefined;
  const stableTarget = ast.is.IsIdentifier(target) && summary !== undefined && !summary.bindingWritten &&
    !summary.captured && !summary.exported && !summary.uses.some(use => {
      let reference = use.reference;
      for (let parent = ast.parent(reference); parent !== undefined && sourceTransparentExpressionOperand(ast, parent) === reference;
        parent = ast.parent(reference)) reference = parent;
      const parent = ast.parent(reference);
      const operation = parent === undefined ? undefined : program.records.targetOperation.get(parent);
      return operation?.kind === "reference-operation" && operation.operation === "mutable-reference" && operation.operandExpression === reference;
    }) && rustTargetTypeRefEquals(rustValueCarrierBeforeOptionProjection(program.records, target), fact.operandCarrier);
  if (!stableTarget) {
    const read = program.ownership.reads.get(fact.operandExpression);
    return { kind: "store", valueExpression: fact.valueExpression, evaluation: {
      kind: "target-first", target: read?.readsStorage === false && read.source.kind === "move" ? "value" : "mutable-reborrow" } };
  }
  const valueExpression = referenceOperand(program, fact.valueExpression);
  if (!ast.is.IsBinaryExpression(valueExpression)) return { kind: "store", valueExpression: fact.valueExpression,
    evaluation: { kind: "direct" } };
  const readExpression = BinaryExpression_Left(ast, valueExpression);
  const rightExpression = BinaryExpression_Right(ast, valueExpression);
  if (readExpression === undefined || rightExpression === undefined) {
    return { kind: "store", valueExpression: fact.valueExpression, evaluation: { kind: "direct" } };
  }
  const readFact = program.records.targetOperation.get(referenceOperand(program, readExpression));
  const valueFact = program.records.targetOperation.get(valueExpression);
  if (readFact?.kind !== "reference-operation" || readFact.operation !== "load" ||
    valueFact?.kind !== "operator-token" || valueFact.leftConversion !== undefined ||
    valueFact.rightConversion !== undefined ||
    !rustTargetTypeRefEquals(readFact.operandCarrier, fact.operandCarrier) ||
    !rustTargetTypeRefEquals(readFact.resultCarrier, fact.operandCarrier.referent)) {
    return { kind: "store", valueExpression: fact.valueExpression, evaluation: { kind: "direct" } };
  }
  const targetReference = program.sourceNavigation.sourceReferenceFor(target);
  const readReference = program.sourceNavigation.sourceReferenceFor(referenceOperand(program, readFact.operandExpression));
  if (targetReference?.symbol === undefined || readReference?.symbol === undefined ||
    targetReference.symbol !== readReference.symbol ||
    targetReference.declaration !== readReference.declaration) {
    return { kind: "store", valueExpression: fact.valueExpression, evaluation: { kind: "direct" } };
  }
  const operator = selectRustEquivalentAssignment(
    valueFact.operator,
    fact.operandCarrier.referent,
    valueFact.resultCarrier,
  );
  if (operator === undefined || operator === "=") return { kind: "store", valueExpression: fact.valueExpression,
    evaluation: { kind: "direct" } };
  const effects = program.sourceNavigation.expressionEffects(rightExpression);
  const right = program.ownership.reads.get(rightExpression);
  return right?.pure === true && !effects.invokes && !effects.mutates && !effects.suspends && !effects.mayThrow
    ? { kind: "store", valueExpression: rightExpression, evaluation: { kind: "compound", operator } }
    : { kind: "store", valueExpression: fact.valueExpression, evaluation: { kind: "value-first" } };
}

function referenceOperand(program: Omit<RustAnalysisProgram, "reachability">, node: Node): Node {
  for (;;) {
    const operand = sourceTransparentExpressionOperand(program.source.ast, node);
    if (operand === undefined) return node;
    node = operand;
  }
}

function resolvedRustReferenceConstruction(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  source: Extract<
    RustSourceReferenceOperation,
    { readonly kind: "shared-reference" | "mutable-reference" }
  >,
  expected: TargetTypeRef | undefined,
  mutable: boolean,
): { readonly carrier?: TargetTypeRef } {
  const operandCarrier = resolveExpressionCarrier(
    walk,
    source.valueExpression,
    sourceFile,
    undefined,
  );
  const explicitLifetime = source.lifetimeTypeNode === undefined
    ? undefined
    : walk.context.sourceLifetimes.resolve(source.lifetimeTypeNode);
  if (operandCarrier === undefined ||
    (source.lifetimeTypeNode !== undefined && explicitLifetime === undefined)) {
    return rejectRustReferenceOperation(
      walk,
      expression,
      "RUST_REFERENCE_OPERATION_CARRIER_MISSING",
      "Rust reference construction has no exact operand carrier or authored lifetime identity.",
    );
  }
  const expectedReference = expected?.kind === "reference" ? expected : undefined;
  if (expectedReference !== undefined &&
    (expectedReference.mutable !== mutable ||
      !rustTargetTypeRefEquals(expectedReference.referent, operandCarrier) ||
      explicitLifetime !== undefined &&
        !rustLifetimesEqual(expectedReference.lifetime, explicitLifetime))) {
    return rejectRustReferenceOperation(
      walk,
      expression,
      "RUST_REFERENCE_OPERATION_EXPECTATION_CONFLICT",
      "Rust reference construction conflicts with its exact contextual reference contract.",
    );
  }
  const lifetime = explicitLifetime ?? expectedReference?.lifetime;
  const referenceCarrier: Extract<TargetTypeRef, { readonly kind: "reference" }> = {
    kind: "reference",
    referent: operandCarrier,
    mutable,
    ...(lifetime === undefined ? {} : { lifetime }),
  };
  if (mutable) {
    recordBindingWrite(walk, source.valueExpression);
  }
  const fact: Extract<
    RustTargetOperationFact,
    { readonly kind: "reference-operation"; readonly operation: "shared-reference" | "mutable-reference" }
  > = {
    kind: "reference-operation",
    operationId: `tsonic.rust.reference.${source.kind}`,
    operation: source.kind,
    operandExpression: source.valueExpression,
    operandCarrier,
    referenceCarrier,
    resultCarrier: referenceCarrier,
  };
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/operations/reference-operations.ts");
  walk.context.records.targetOperations.source(expression, fact);
  return { carrier: setCarrierFact(walk, expression, referenceCarrier) };
}

function rejectRustReferenceOperation(
  walk: RustFactWalk,
  expression: Node,
  code: string,
  message: string,
): { readonly carrier?: TargetTypeRef } {
  appendRustDiagnostic(
    walk,
    code,
    message,
    expression,
    ["target.capability=rust.lifetimes.explicit-reference-operations"],
  );
  return {};
}
