import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable, sourceParameterIsProperty, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits, type SourceStorageBudget, type SourceStorageLimits, type SourceStorageQueries,
  type SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustCaptureReadOwnership, RustOwnershipRecords, RustReadOwnershipFact, RustNativeCaptureSource } from "../../target-model/records/ownership.js";
import type { RustAnalysisRecords } from "../program/records/model.js";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustCopyCarrier, isRustStringCarrier, rustCallableProtocol,
  rustLocationTargetType, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import { rustFinalContractSupportsRequirements } from "../declarations/generic-carrier-requirements.js";
import type { RustSourceTypeFamilyRegistry } from "../../target-model/types/type-families.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import { rustReadTransferRequirement, type RustOwnershipFlow } from "./flow.js";
import { selectRustBorrowRelationship, type RustBorrowEffects, type RustBorrowEffectsInput } from "./effects.js";
import { selectRustValueReadOwnership } from "../../policy/ownership/value-read.js";
import { rustBorrowedOperationArguments } from "../storage/provider-borrows.js";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { rustContextualRuntimeConversionContract } from "../../target-model/conversions/contextual.js";
import type { RustNativeStoragePlan, RustNativeStorageSelection } from "../callables/native-storage.js";
import type { RustLexicalFunctionQueries } from "../callables/lexical-functions.js";
import { rustRetainedCallableStorage } from "../callables/results.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetOperationIsDirectLocation } from "../operations/target-operation.js";
import type { RustReadUse } from "../../policy/ownership/read-use.js";
import type { RustFinalizedOperationAbi } from "../../target-model/records/finalized-operation.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustPhysicalEmissionOperand } from "../../target-model/records/physical-emission-contexts.js";

export interface RustCaptureReadRequirement {
  readonly owner: Node;
  readonly capture: RustClosureCaptureFact["captures"][number];
  readonly subject: SourceStorageSubject;
  readonly physical: Exclude<RustNativeStorageSelection, { readonly kind: "unresolved" }>;
  readonly source: RustNativeCaptureSource;
  readonly carrier: TargetTypeRef;
  readonly copy: boolean;
  readonly formation: "owned" | "borrowed" | "if-transferred";
  readonly mutable: boolean;
  readonly aliasesBinding: boolean;
  readonly invocationTransfers: boolean;
  readonly invocationRequiresOwned: boolean;
}

export type RustCaptureReadRequirements = ReadonlyMap<Node, readonly RustCaptureReadRequirement[]>;

export function prepareRustCaptureReadRequirements(input: {
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly records: RustAnalysisRecords;
  readonly genericCallables: RustGenericCallablePlan;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "subjectFor">;
  readonly lexicalFunctions: Pick<RustLexicalFunctionQueries, "forDeclaration">;
  readonly capturesFor: (owner: Node) => RustClosureCaptureFact | undefined;
  readonly isOnceCallable: (owner: Node) => boolean;
  readonly limits?: Partial<SourceStorageLimits>;
}): { readonly kind: "resolved"; readonly requirements: RustCaptureReadRequirements }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const requirements = new Map<Node, readonly RustCaptureReadRequirement[]>();
  const reject = (node: Node, reason: string) => ({ kind: "rejected" as const, diagnostics: [{
    code: "RUST_CAPTURE_PHYSICAL_STORAGE_UNAVAILABLE", category: "error" as const, source: "tsonic-rust",
    sourceNode: node, message: reason, evidence: ["target.capability=rust.analysis.ownership"],
  }] });
  for (const owner of input.nativeNodes) {
    if (!budget.node() || !budget.step()) return reject(owner, budget.failure()!);
    const captures = input.capturesFor(owner)?.captures;
    if (captures === undefined) continue;
    if (captures.length === 0) { requirements.set(owner, Object.freeze([])); continue; }
    const lexical = input.lexicalFunctions.forDeclaration(owner);
    if (lexical?.kind === "unresolved") return reject(owner, lexical.reason);
    const selected: RustCaptureReadRequirement[] = [];
    for (const capture of captures) {
      if (!budget.row() || !budget.step()) return reject(capture.reference, budget.failure()!);
      const subject = input.storage.subjectFor(capture.reference);
      if (subject.kind === "unresolved") return reject(capture.reference, subject.reason);
      const physical = input.nativeStorage.subjectFor(subject.subject, capture.carrier, owner);
      if (physical.kind === "unresolved") return reject(capture.reference, physical.reason);
      const lexicalCapture = lexical?.captures.find(value => value.declaration === capture.declaration);
      if (lexical !== undefined && lexicalCapture === undefined) return reject(capture.reference,
        "A native lexical capture requires its original selected source capture correspondence.");
      const carrier = capture.storage === "location" ? rustLocationTargetType(physical.carrier) : physical.carrier;
      const copy = isRustCopyCarrier(carrier, value => input.genericCallables.definitionFor(value)?.copy === true);
      const formation = lexical === undefined || rustRetainedCallableStorage(input.records, owner) !== undefined ||
        capture.storage === "value" && lexicalCapture?.mutable === false && copy ? "owned"
        : capture.storage === "value" && lexicalCapture?.mutable === false && !lexical.valueObserved
          ? "if-transferred" : "borrowed";
      const source = Object.freeze({ subject: subject.subject, carrier: physical.carrier, alternatives: physical.sources });
      selected.push(Object.freeze({ owner, capture, subject: subject.subject, physical, source, carrier, copy, formation,
        mutable: capture.storage === "value" && (lexicalCapture?.mutable === true || capture.mutable === true),
        aliasesBinding: capture.storage !== "value",
        invocationTransfers: input.isOnceCallable(owner), invocationRequiresOwned: lexical !== undefined }));
    }
    requirements.set(owner, Object.freeze(selected));
  }
  return { kind: "resolved", requirements };
}

export function completeRustCaptureReadOwnership(input: {
  readonly requirements: RustCaptureReadRequirements;
  readonly flow: RustOwnershipFlow;
  readonly definitions: RustTypeDefinitions;
  readonly genericRequirements: RustDeclarationGenericRequirementIndex;
  readonly typeFamilies: Pick<RustSourceTypeFamilyRegistry, "implementation">;
}): { readonly kind: "resolved"; readonly captures: ReadonlyMap<Node, readonly RustCaptureReadOwnership[]> }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const captures = new Map<Node, readonly RustCaptureReadOwnership[]>();
  const reject = (node: Node, reason: string) => ({ kind: "rejected" as const, diagnostics: [{
    code: "RUST_CAPTURE_OWNERSHIP_UNAVAILABLE", category: "error" as const, source: "tsonic-rust", sourceNode: node,
    message: reason, evidence: ["target.capability=rust.analysis.ownership"],
  }] });
  for (const [owner, requirements] of input.requirements) {
    const selected: RustCaptureReadOwnership[] = [];
    for (const requirement of requirements) {
      const { capture, carrier, copy } = requirement;
      const contract = input.genericRequirements.contractFor(owner);
      const clone = contract !== undefined && rustFinalContractSupportsRequirements(contract, carrier, ["clone"],
        input.typeFamilies, input.definitions, undefined).kind === "supported";
      const { transfer, owned } = rustCaptureReadFormation(requirement, input.flow.captureTransfers);
      const read = owned ? selectRustValueReadOwnership({ copy, clone, transfer })
        : Object.freeze({ kind: "borrow" as const, mutable: requirement.mutable });
      if (read === undefined) return reject(capture.reference,
        "A retained capture requires a proven transfer, Copy or Clone contract.");
      const invocation = read.kind === "borrow" || requirement.invocationTransfers ? read :
        requirement.invocationRequiresOwned
          ? selectRustValueReadOwnership({ copy, clone, transfer: capture.storage === "cell" || capture.storage === "borrow-cell" })
          : Object.freeze({ kind: "borrow" as const, mutable: requirement.mutable });
      if (invocation === undefined) return reject(capture.reference,
        "A repeated capture invocation requires its exact Copy or Clone contract.");
      selected.push(Object.freeze({ declaration: capture.declaration, reference: capture.reference,
        carrier: requirement.physical.carrier, source: requirement.source, read, invocation,
        borrowed: selectRustValueReadOwnership({ copy, clone,
          transfer: capture.storage === "cell" || capture.storage === "borrow-cell" }) }));
    }
    captures.set(owner, Object.freeze(selected));
  }
  return { kind: "resolved", captures };
}

export function rustCaptureReadFormation(requirement: RustCaptureReadRequirement,
  transfers: ReadonlyMap<Node, ReadonlySet<Node>>): {
    readonly transfer: boolean; readonly owned: boolean; readonly requiresClone: boolean;
  } {
  const transfer = requirement.capture.storage === "cell" || requirement.capture.storage === "borrow-cell" ||
    transfers.get(requirement.owner)?.has(requirement.capture.declaration) === true;
  const owned = requirement.formation === "owned" || requirement.formation === "if-transferred" && transfer;
  return { transfer, owned, requiresClone: owned && !requirement.copy &&
    (!transfer || requirement.invocationRequiresOwned && !requirement.invocationTransfers &&
      requirement.capture.storage !== "cell" && requirement.capture.storage !== "borrow-cell") };
}

export interface RustNativeResultReadRequirement {
  readonly abi: RustFinalizedOperationAbi;
  readonly carrier: TargetTypeRef;
  readonly copy: boolean;
  readonly borrowed: "shared" | "mutable" | undefined;
  readonly requiresClone: boolean;
}

export interface RustReadOwnershipRequirements {
  readonly budget: SourceStorageBudget;
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly records: RustAnalysisRecords;
  readonly storageReads: ReadonlyMap<Node, RustStorageReadRequirement>;
  readonly uses: ReadonlyMap<Node, RustReadUse>;
  readonly borrowed: ReadonlyMap<Node, "shared" | "mutable">;
  readonly borrowedAcross: ReadonlyMap<Node, ReadonlySet<Node>>;
  readonly captureBorrows: ReadonlyMap<Node, RustCaptureReadRequirement>;
  readonly nativeResults: ReadonlyMap<Node, readonly RustNativeResultReadRequirement[]>;
}

interface RustStorageReadRequirement {
  readonly storage: boolean;
  readonly binding: Node | undefined;
  readonly projection: RustReadProjectionRequirement;
}

interface RustReadProjectionRequirement {
  readonly conversionBorrows: boolean;
  readonly projectBorrows: boolean;
  readonly constructsContainer: boolean;
  readonly flowResultBorrow: boolean;
  readonly flowConversionInput: "value" | "borrow" | "borrow-unless-moving";
  readonly cloneSources: readonly TargetTypeRef[];
  readonly requiredCloneSources: readonly TargetTypeRef[];
  readonly cloneBorrowable: boolean;
}

function selectRustReadProjectionRequirement(node: Node, records: RustAnalysisRecords,
  definitions: RustTypeDefinitions): RustReadProjectionRequirement {
  const projection = records.flowReadProjection.get(node);
  const conversion = records.contextualValueConversion.get(node);
  const conversionBorrows = conversion !== undefined &&
    rustContextualRuntimeConversionContract(conversion.conversion, definitions)?.sourceMode === "ref";
  const projectBorrows = records.projectDowncast.get(node) !== undefined || records.projectUpcast.get(node) !== undefined;
  const option = records.optionProjection.get(node);
  const referenceFlow = ((projection?.kind === "source-union" || projection?.kind === "runtime-union") &&
    projection.project === undefined || projection?.kind === "option-value" &&
    rustOptionalStorageValue(projection.sourceCarrier) === undefined) &&
    rustOptionElementCarrier(projection.selectedCarrier) === undefined && !projectBorrows &&
    records.callScopedLifetimeReconciliation.get(node) === undefined &&
    option === undefined && records.objectReferenceView.get(node) === undefined;
  const flowResultBorrow = referenceFlow && conversion === undefined;
  const flowConversionInput = !referenceFlow || conversion === undefined ||
    !rustTargetTypeRefEquals(projection?.selectedCarrier, conversion.sourceCarrier) ? "value"
    : conversionBorrows ? "borrow" : conversion.conversion.kind === "project-union-map" ? "borrow-unless-moving" : "value";
  const cloneSources = projection?.kind === "union-map"
    ? projection.arms.filter(arm => arm.source[arm.source.length - 1]?.variant.kind === "payload").map(arm => arm.carrier)
    : projection?.kind === "program-error-variant" || projection?.kind === "option-value" ||
      (projection?.kind === "source-union" || projection?.kind === "runtime-union") && projection.project === undefined
      ? [projection.selectedCarrier]
      : projection?.kind === "project-downcast" ? [projection.dispatchCarrier] : [];
  const requiredCloneSources = projection?.kind === "closed-native" ? [projection.selectedCarrier] : [];
  return Object.freeze({ conversionBorrows, projectBorrows, constructsContainer: option?.kind === "some",
    flowResultBorrow, flowConversionInput, cloneSources: Object.freeze(cloneSources),
    requiredCloneSources: Object.freeze(requiredCloneSources),
    cloneBorrowable: flowResultBorrow || flowConversionInput !== "value" });
}

export function prepareRustReadOwnership(input: {
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly records: RustAnalysisRecords;
  readonly flow: RustOwnershipFlow;
  readonly borrowEffects: RustBorrowEffects;
  readonly borrowEffectsInput: RustBorrowEffectsInput;
  readonly definitions: RustTypeDefinitions;
  readonly genericCallables: RustGenericCallablePlan;
  readonly limits?: Partial<SourceStorageLimits>;
}): { readonly kind: "resolved"; readonly requirements: RustReadOwnershipRequirements }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { storage, records, borrowEffects } = input;
  const { ast } = storage.source;
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const rejectedBudget = () => ({ kind: "rejected" as const, diagnostics: [{
    code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error" as const, source: "tsonic-rust",
    message: budget.failure() ?? "Rust ownership reads require a complete finite source-use inventory.",
    evidence: ["target.capability=rust.analysis.ownership"],
  }] });
  const storageReads = new Map<Node, RustStorageReadRequirement>();
  for (let index = input.nativeNodes.length - 1; index >= 0; index -= 1) {
    if (!budget.node() || !budget.step() || !budget.row()) return rejectedBudget();
    const node = input.nativeNodes[index]!;
    const operand = sourceTransparentExpressionOperand(ast, node);
    const nativeOperand = operand !== undefined && input.borrowEffectsInput.isNativeNode(operand);
    const inherited = nativeOperand ? storageReads.get(operand) : undefined;
    if (operand !== undefined && (!nativeOperand || inherited === undefined)) {
      return { kind: "rejected", diagnostics: [{
        code: "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID", category: "error", source: "tsonic-rust", sourceNode: node,
        message: "Rust ownership requires the complete parent-before-child checked source inventory.",
        evidence: ["target.capability=rust.analysis.ownership"],
      }] };
    }
    const operation = records.targetOperation.get(node);
    const convertedNativeStorage = operation?.kind === "provider-operation" && operation.abi.result.kind === "sync" &&
      operation.abi.result.conversion.kind !== "identity";
    const parent = ast.parent(node);
    const implicitProperty = parent !== undefined && ast.name(parent) === node && sourceParameterIsProperty(ast, parent);
    storageReads.set(node, Object.freeze({ storage: inherited?.storage ?? (!convertedNativeStorage &&
      (ast.is.IsIdentifier(node) && records.sourceBinding.get(node) !== undefined ||
      implicitProperty || rustTargetOperationIsDirectLocation(operation) ||
      operation?.kind === "source-static-field" || records.nativeArrayStorage.get(node)?.kind === "element" ||
      ast.kindName(node) === "KindThisExpression" || ast.kindName(node) === "KindThisKeyword" ||
      operation?.kind === "source-field" && operation.valueSemantics.kind === "stored")),
      binding: inherited === undefined ? records.sourceBinding.get(node)?.sourceDeclaration : inherited.binding,
      projection: selectRustReadProjectionRequirement(node, records, input.definitions) }));
  }
  const uses = input.borrowEffectsInput.readUses;
  const borrowDemands = new Map<Node, Set<Node>>();
  const compare = (source: Node | undefined, later: Node | undefined): void => {
    if (source === undefined || later === undefined || !input.borrowEffectsInput.isNativeNode(source) ||
      !input.borrowEffectsInput.isNativeNode(later)) return;
    const demand = borrowDemands.get(source) ?? new Set<Node>();
    if (demand.has(later) || !budget.row()) return;
    demand.add(later);
    borrowDemands.set(source, demand);
  };
  for (const node of input.nativeNodes) {
    if (!budget.step()) return rejectedBudget();
    if (ast.is.IsBinaryExpression(node)) {
      const left = BinaryExpression_Left(ast, node);
      const right = BinaryExpression_Right(ast, node);
      compare(left, right);
      compare(right, right);
    }
    const argumentsList = rustBorrowedOperationArguments(node, ast);
    if (argumentsList !== undefined) {
      const callee = Node_Expression(ast, node);
      const receiver = ast.is.IsCallExpression(node) ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee;
      const slots = [receiver, ...argumentsList].filter((value): value is Node => value !== undefined);
      for (let index = 0; index < slots.length; index += 1) {
        for (let later = index + 1; later < slots.length; later += 1) {
          compare(slots[index], slots[later]);
          if (budget.failure() !== undefined) return rejectedBudget();
        }
      }
    }
  }
  const laterPositions = new Map<readonly Node[], ReadonlyMap<Node, number>>();
  for (const [node, use] of uses) {
    if (!laterPositions.has(use.later)) laterPositions.set(use.later, new Map(use.later.map((value, index) => [value, index])));
    for (let index = use.laterStart; index < use.later.length; index += 1) {
      compare(node, use.later[index]);
      if (budget.failure() !== undefined) return rejectedBudget();
    }
  }
  const borrowRelationships = new Map<Node, ReadonlySet<Node>>();
  for (const [node, later] of borrowDemands) {
    const selected = new Set<Node>();
    for (const value of later) {
      if (!budget.step()) return rejectedBudget();
      const use = uses.get(node);
      if (use?.stableAcrossEffects === true && borrowEffects.stableBindings.has(node) &&
        (laterPositions.get(use.later)?.get(value) ?? -1) >= use.laterStart ||
        selectRustBorrowRelationship(node, value, input.borrowEffectsInput, borrowEffects)) selected.add(value);
    }
    borrowRelationships.set(node, selected);
  }
  const borrowed = new Map<Node, "shared" | "mutable">();
  const captureBorrows = new Map<Node, RustCaptureReadRequirement>();
  const nativeResults = new Map<Node, readonly RustNativeResultReadRequirement[]>();
  for (const node of input.nativeNodes) {
    if (!budget.step()) return rejectedBudget();
    const use = uses.get(node);
    const owner = sourceEnclosingCallable(node, ast);
    const ownerCarrier = owner === undefined ? undefined : records.runtimeCarrier.get(owner)?.carrier;
    const binding = storageReads.get(node)?.binding;
    const capture = owner === undefined || binding === undefined ? undefined
      : input.flow.captureRequirements.get(owner)?.find(value => value.capture.declaration === binding);
    const immutableInvocation = ownerCarrier?.kind === "closure" ? (ownerCarrier.callTrait ?? "Fn") === "Fn"
      : rustFrameCallableValue(ownerCarrier) === undefined && rustCallableProtocol(ownerCarrier) !== undefined;
    const captureBorrow = use?.mode === "shared" && use.stableAcrossEffects && immutableInvocation &&
      capture?.capture.storage === "value" && !capture.aliasesBinding && !capture.mutable && capture.formation === "owned";
    if (captureBorrow) {
      if (!budget.row()) return rejectedBudget();
      captureBorrows.set(node, capture);
    }
    const mode = use?.mode === "mutable" ? "mutable" :
      (use?.mode === "shared" || use?.mode === "projection" && rustReadTransferRequirement(input.flow, node) !== "transfer") &&
      (captureBorrow || use.later.every((later, index) => index < use.laterStart || !input.borrowEffectsInput.isNativeNode(later) ||
        borrowRelationships.get(node)?.has(later))) ? "shared" : undefined;
    if (mode !== undefined) borrowed.set(node, mode);
    const operation = records.targetOperation.get(node);
    const providers = operation?.kind === "provider-operation" ? [operation]
      : operation?.kind === "union-property" ? operation.variants.flatMap(variant =>
        variant.operation === undefined ? [] : [variant.operation]) : [];
    if (providers.length === 0) continue;
    const access = ast.is.IsPropertyAccessExpression(node) ? storage.source.semantics.forNode(node).operations.propertyAccess(node)
      : ast.is.IsElementAccessExpression(node) ? storage.source.semantics.forNode(node).operations.elementAccess(node) : undefined;
    if (access?.accessMode === "write" || access?.accessMode === "delete") continue;
    const results: RustNativeResultReadRequirement[] = [];
    for (const { abi } of providers) {
      if (abi.result.kind !== "sync" || abi.target.form !== "field" && abi.target.form !== "index" ||
        results.some(result => result.abi === abi)) continue;
      if (!budget.row() || !budget.step()) return rejectedBudget();
      const conversion = abi.result.conversion.kind === "sequence" ? abi.result.conversion.steps[0]! : abi.result.conversion;
      const contract = conversion.kind === "semantic" ? rustValueConversionContract(conversion.conversion, input.definitions) : undefined;
      if (conversion.kind === "semantic" && contract === undefined) return { kind: "rejected", diagnostics: [{
        code: "RUST_PROVIDER_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: node,
        message: "A provider storage read requires its complete finalized raw-result conversion contract.",
        evidence: ["target.capability=rust.analysis.ownership"],
      }] };
      const selectedBorrow = contract?.sourceMode === "ref" ? "shared"
        : abi.result.conversion.kind === "identity" ? mode : undefined;
      const copy = isRustCopyCarrier(abi.result.rawCarrier, value => input.genericCallables.definitionFor(value)?.copy === true);
      results.push(Object.freeze({ abi, carrier: abi.result.rawCarrier, copy, borrowed: selectedBorrow,
        requiresClone: selectedBorrow === undefined && !copy }));
    }
    if (results.length > 0) nativeResults.set(node, Object.freeze(results));
  }
  return { kind: "resolved", requirements: Object.freeze({ budget, storage, nativeNodes: input.nativeNodes, records,
    storageReads, uses, borrowed, borrowedAcross: borrowRelationships, captureBorrows, nativeResults }) };
}

export function analyzeRustReadOwnership(input: {
  readonly requirements: RustReadOwnershipRequirements;
  readonly operands: readonly {
    readonly node: RustPhysicalEmissionOperand["node"];
    readonly origin: Pick<RustPhysicalEmissionOperand["origin"], "kind">;
  }[];
  readonly movingReads: ReadonlySet<Node>;
  readonly captures: ReadonlyMap<Node, readonly RustCaptureReadOwnership[]>;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "operandFor">;
  readonly borrowEffects: RustBorrowEffects;
  readonly definitions: RustTypeDefinitions;
  readonly genericRequirements: RustDeclarationGenericRequirementIndex;
  readonly typeFamilies: Pick<RustSourceTypeFamilyRegistry, "implementation">;
  readonly genericCallables: RustGenericCallablePlan;
}): { readonly kind: "resolved"; readonly ownership: Pick<RustOwnershipRecords, "reads" | "captures" | "writes"> }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { requirements, movingReads, captures, borrowEffects } = input;
  const { storage, records, storageReads, uses, borrowedAcross } = requirements;
  const { ast } = storage.source;
  const reads = new Map<Node, RustReadOwnershipFact>();
  const writes = new Map<Node, import("../../target-model/records/ownership.js").RustBorrowedFieldWrite>();
  const { budget } = requirements;
  const emittedReads = new Set<Node>();
  for (const operand of input.operands) {
    if (!budget.step() || !budget.row()) return { kind: "rejected", diagnostics: [{
      code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error", source: "tsonic-rust",
      message: budget.failure()!, evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    if (!storageReads.has(operand.node)) return { kind: "rejected", diagnostics: [{
      code: "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: operand.node,
      message: "A native operand read requires its original admitted source storage occurrence.",
      evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    if (operand.origin.kind !== "value") emittedReads.add(operand.node);
  }
  for (const node of requirements.nativeNodes) {
    if (!budget.step()) return { kind: "rejected", diagnostics: [{
      code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error", source: "tsonic-rust",
      message: budget.failure()!, evidence: ["target.capability=rust.analysis.ownership"],
    }] };
    const parent = ast.parent(node);
    const implicitProperty = parent !== undefined && ast.name(parent) === node && sourceParameterIsProperty(ast, parent);
    const carrier = implicitProperty ? records.sourceParameterAbi.get(parent)?.valueCarrier : records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined && emittedReads.has(node)) {
      const declaration = sourceEnclosingCallable(node, ast) ?? ast.getSourceFile(node);
      const sourceStorageRead = storageReads.get(node)!;
      const captured = declaration === undefined || sourceStorageRead.binding === undefined ? undefined
        : captures.get(declaration)?.find(capture => capture.declaration === sourceStorageRead.binding);
      const captureBorrow = requirements.captureBorrows.get(node);
      if (captureBorrow !== undefined && (captured === undefined || captured.source !== captureBorrow.source ||
        captured.carrier !== captureBorrow.physical.carrier || captured.read.kind === "borrow")) return { kind: "rejected", diagnostics: [{
          code: "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "An immutable invocation borrow requires its original admitted independent native capture and exact physical carrier.",
          evidence: ["target.capability=rust.analysis.ownership"],
        }] };
      const projection = records.flowReadProjection.get(node);
      const valueCarrier = projection?.selectedCarrier ?? carrier;
      const physicalValueCarrier = projection === undefined && captured !== undefined ? captured.carrier : valueCarrier;
      const copy = isRustCopyCarrier(physicalValueCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const contract = declaration === undefined ? undefined : input.genericRequirements.contractFor(declaration);
      const clone = contract !== undefined && rustFinalContractSupportsRequirements(contract, physicalValueCarrier, ["clone"],
        input.typeFamilies, input.definitions, undefined).kind === "supported";
      const use = uses.get(node);
      const borrowed = requirements.borrowed.get(node);
      const storageRead = sourceStorageRead.storage;
      const borrowedCapture = captured?.read.kind === "borrow";
      const value = selectRustValueReadOwnership({ copy, clone, borrowed,
        transfer: !borrowedCapture && (use?.mode === "move" || movingReads.has(node) || !storageRead) });
      const physicalSourceCarrier = captured?.carrier ?? carrier;
      const sourceCopy = isRustCopyCarrier(physicalSourceCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const sourceClone = contract !== undefined && rustFinalContractSupportsRequirements(contract, physicalSourceCarrier, ["clone"],
        input.typeFamilies, input.definitions, undefined).kind === "supported";
      const { conversionBorrows, projectBorrows, constructsContainer, flowResultBorrow, flowConversionInput } = sourceStorageRead.projection;
      const flowConversionInputBorrow = flowConversionInput === "borrow" ||
        flowConversionInput === "borrow-unless-moving" && value?.kind !== "move";
      const sourceRead = selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone,
        transfer: !borrowedCapture && (movingReads.has(node) || !storageRead), borrowed: conversionBorrows || projectBorrows || projection !== undefined && value?.kind !== "move"
          ? "shared" : constructsContainer ? undefined : borrowed });
      const formation = selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone,
        transfer: !borrowedCapture && (movingReads.has(node) || !storageRead) }) ??
        (sourceRead?.kind === "borrow" ? sourceRead : undefined);
      const operation = records.targetOperation.get(node);
      const binding = records.sourceBinding.get(node);
      const module = binding === undefined ? undefined : records.moduleBinding.get(binding.sourceDeclaration);
      const staticStringView = sourceRead?.kind === "borrow" && !sourceRead.mutable &&
        module?.storage === "native-const" && isRustStringCarrier(module.valueCarrier);
      const nativeResults: RustReadOwnershipFact["nativeResults"][number][] = [];
      for (const selected of requirements.nativeResults.get(node) ?? []) {
        const read = selectRustValueReadOwnership({ copy: selected.copy, transfer: false,
          borrowed: selected.borrowed, clone: contract !== undefined &&
            rustFinalContractSupportsRequirements(contract, selected.carrier, ["clone"],
              input.typeFamilies, input.definitions, undefined).kind === "supported" });
        if (read === undefined) return { kind: "rejected", diagnostics: [{
          code: "RUST_PROVIDER_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "A provider storage read requires an exact raw-carrier Copy, owned transfer, Clone or native borrow contract.",
          evidence: ["target.capability=rust.analysis.ownership"],
        }] };
        if (!budget.row()) return { kind: "rejected", diagnostics: [{
          code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error", source: "tsonic-rust", sourceNode: node,
          message: budget.failure()!, evidence: ["target.capability=rust.analysis.ownership"],
        }] };
        nativeResults.push(Object.freeze({ abi: selected.abi, carrier: selected.carrier, read }));
      }
      if ((value === undefined || sourceRead === undefined) && storageRead &&
        (records.sourceBinding.get(node) !== undefined || operation?.kind === "source-field" && operation.accessMode === "read")) {
        return { kind: "rejected", diagnostics: [{
          code: "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "An owned native value read requires a proven transfer, Copy or Clone contract; a borrowed read requires its exact use-site lease.",
          evidence: ["target.capability=rust.analysis.ownership"],
        }] };
      }
      if (value !== undefined && sourceRead !== undefined && formation !== undefined) {
        const physical = input.nativeStorage.operandFor(node);
        if (physical.kind === "unresolved") return { kind: "rejected", diagnostics: [{
          code: "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: node,
          message: physical.reason, evidence: ["target.capability=rust.analysis.ownership"],
        }] };
        if (captureBorrow !== undefined && !rustTargetTypeRefEquals(physical.carrier, captured!.carrier))
          return { kind: "rejected", diagnostics: [{ code: "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", category: "error",
            source: "tsonic-rust", sourceNode: node,
            message: "An immutable capture borrow requires the same actual physical operand carrier as its admitted capture.",
            evidence: ["target.capability=rust.analysis.ownership"],
          }] };
        let across: ReadonlySet<Node> = borrowedAcross.get(node) ?? new Set<Node>();
        if (captureBorrow !== undefined && use !== undefined) {
          const selected = new Set<Node>();
          for (const later of across) {
            if (!budget.step() || !budget.row()) return { kind: "rejected", diagnostics: [{
              code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error", source: "tsonic-rust", sourceNode: node,
              message: budget.failure()!, evidence: ["target.capability=rust.analysis.ownership"],
            }] };
            selected.add(later);
          }
          for (let index = use.laterStart; index < use.later.length; index += 1) {
            if (!budget.step() || !budget.row()) return { kind: "rejected", diagnostics: [{
              code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error", source: "tsonic-rust", sourceNode: node,
              message: budget.failure()!, evidence: ["target.capability=rust.analysis.ownership"],
            }] };
            selected.add(use.later[index]!);
          }
          across = selected;
        }
        reads.set(node, Object.freeze({ carrier, operandCarrier: physical.carrier, formation, value, source: sourceRead,
        snapshot: selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone, transfer: false }),
        stablePlace: borrowEffects.stableBindings.has(node) || captureBorrow !== undefined,
        readsStorage: storageRead,
        pure: borrowEffects.pureValues.has(node),
        sharedReference: staticStringView || flowResultBorrow && value.kind === "borrow" ||
          sourceRead.kind === "borrow" && operation?.kind === "reference-operation" &&
          operation.operation === "load" && !operation.operandCarrier.mutable,
        flowResultBorrow, flowConversionInputBorrow,
        borrowedAcross: across, nativeResults: Object.freeze(nativeResults),
        }));
      }
    }
    const write = borrowEffects.fieldWrites.get(node);
    if (write !== undefined) writes.set(node, write);
  }
  return { kind: "resolved", ownership: Object.freeze({ reads, captures, writes }) };
}
