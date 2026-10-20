import { type Node, type ProviderDeclarationIdentity, type SourceFile, type Type } from "@tsonic/tsts";
import { type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { type RustAnalysisProgram } from "../program/model.js";
import { type RustReferenceOperationProducer } from "../program/records/reference-operations.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustStringCarrier, rustUnitTargetType } from "../../target-model/types/index.js";
import { rustValueCarrierBeforeOptionProjection } from "../conversions/value-carrier-queries.js";
import { requireRustRecord } from "../program/records/required-records.js";
import { BinaryExpression_Left, BinaryExpression_Right, KindBinaryExpression, KindIdentifier } from "@tsonic/target-api/source";
import { appendRustDiagnostic, type RustFactWalk } from "../program/walk.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { resolveExpressionCarrier } from "./carriers.js";
import { recordBindingWrite } from "../ownership/source-writes.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";
import { selectRustEquivalentAssignment } from "../../policy/operations/operators/rules.js";
import { rustSourceOperationExportIds, rustSourceOperationSignatureIds } from "../../target-model/identities/source.js";
import { readRustLanguageCall } from "./native-language-call.js";
import { type TargetTypeRef } from "../../target-model/types/model.js";
import { type RustTargetOperationFact } from "../../target-model/records/operations.js";

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
      if (fact.writeStrategy !== undefined) {
        const read = program.records.targetOperation.get(fact.writeStrategy.readExpression);
        const value = program.records.targetOperation.get(fact.valueExpression);
        if (read?.kind !== "reference-operation" || read.operation !== "load" || value?.kind !== "operator-token" ||
          !rustTargetTypeRefEquals(read.operandCarrier, fact.operandCarrier) || !rustTargetTypeRefEquals(read.resultCarrier, fact.operandCarrier.referent) ||
          !rustTargetTypeRefEquals(value.resultCarrier, fact.valueCarrier)) {
          refuse(call, "RUST_REFERENCE_STORE_STRATEGY_CONFLICT", "Rust reference store strategy conflicts with its finalized read and operator facts.");
          continue;
        }
      }
    }
    producer.publish(call, { operation: fact, load: fact.operation !== "load" || program.ownership.reads.get(call)?.sharedReference === true ? "reference"
      : !fact.operandCarrier.mutable && isRustStringCarrier(fact.operandCarrier.referent) ? "owned-string" : "dereference" });
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
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/expressions/reference-operations.ts");
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
    ...referenceStoreWriteStrategy(
      walk,
      source.referenceExpression,
      source.valueExpression,
      operandCarrier,
    ),
    resultCarrier,
  };
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/expressions/reference-operations.ts");
  walk.context.records.targetOperations.source(expression, fact);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

function referenceStoreWriteStrategy(
  walk: RustFactWalk,
  targetReferenceExpression: Node,
  valueExpression: Node,
  targetCarrier: Extract<TargetTypeRef, { readonly kind: "reference" }>,
): Pick<
  Extract<RustTargetOperationFact, { readonly kind: "reference-operation"; readonly operation: "store" }>,
  "writeStrategy"
> {
  const { ast } = walk.context;
  if (ast.kindName(targetReferenceExpression) !== KindIdentifier ||
    ast.kindName(valueExpression) !== KindBinaryExpression) {
    return {};
  }
  const readExpression = BinaryExpression_Left(ast, valueExpression);
  const rightExpression = BinaryExpression_Right(ast, valueExpression);
  if (readExpression === undefined || rightExpression === undefined) {
    return {};
  }
  const readFact = walk.context.records.targetOperation.get(readExpression);
  const valueFact = walk.context.records.targetOperation.get(valueExpression);
  if (readFact?.kind !== "reference-operation" || readFact.operation !== "load" ||
    ast.kindName(readFact.operandExpression) !== KindIdentifier ||
    valueFact?.kind !== "operator-token" || valueFact.leftConversion !== undefined ||
    valueFact.rightConversion !== undefined ||
    !rustTargetTypeRefEquals(readFact.operandCarrier, targetCarrier) ||
    !rustTargetTypeRefEquals(readFact.resultCarrier, targetCarrier.referent)) {
    return {};
  }
  const targetReference = walk.context.source.navigation.sourceReferenceFor(
    targetReferenceExpression,
  );
  const readReference = walk.context.source.navigation.sourceReferenceFor(
    readFact.operandExpression,
  );
  if (targetReference?.symbol === undefined || readReference?.symbol === undefined ||
    targetReference.symbol !== readReference.symbol ||
    targetReference.declaration !== readReference.declaration) {
    return {};
  }
  const operator = selectRustEquivalentAssignment(
    valueFact.operator,
    targetCarrier.referent,
    valueFact.resultCarrier,
  );
  return operator === undefined || operator === "="
    ? {}
    : {
        writeStrategy: {
          kind: "compound-assignment",
          operator,
          readExpression,
          rightExpression,
        },
      };
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
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, fact.kind, "analysis/expressions/reference-operations.ts");
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
