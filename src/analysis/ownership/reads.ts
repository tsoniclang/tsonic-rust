import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable, sourceParameterIsProperty, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits, type SourceStorageLimits, type SourceStorageQueries,
  type SourceStorageSubject } from "@tsonic/target-api/analysis";
import type { RustCaptureReadOwnership, RustOwnershipRecords, RustReadOwnershipFact, RustNativeCaptureSource } from "../../target-model/records/ownership.js";
import type { RustAnalysisRecords } from "../program/records/model.js";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustCopyCarrier, isRustStringCarrier, rustCarrierSupportsClone, rustLocationTargetType } from "../../target-model/types/index.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustOwnershipFlow } from "./flow.js";
import { selectRustBorrowRelationship, type RustBorrowEffects, type RustBorrowEffectsInput } from "./effects.js";
import { selectRustValueReadOwnership } from "../../policy/ownership/value-read.js";
import { rustBorrowedOperationArguments } from "../storage/provider-borrows.js";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRustReadUses } from "./uses.js";
import { rustContextualRuntimeConversionContract } from "../../target-model/conversions/contextual.js";
import type { RustNativeStoragePlan, RustNativeStorageSelection } from "../callables/native-storage.js";
import type { RustLexicalFunctionQueries } from "../callables/lexical-functions.js";
import { rustRetainedCallableStorage } from "../callables/results.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

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
        mutable: capture.storage === "value" && lexicalCapture?.mutable === true,
        aliasesBinding: capture.storage !== "value",
        invocationTransfers: lexical === undefined || !lexical.valueObserved && lexical.singleInvocation }));
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
      const clone = rustCarrierSupportsClone(carrier, input.definitions) || input.genericRequirements.supportsClone(owner, carrier);
      const { transfer, owned } = rustCaptureReadFormation(requirement, input.flow.captureTransfers);
      const read = owned ? selectRustValueReadOwnership({ copy, clone, transfer })
        : Object.freeze({ kind: "borrow" as const, mutable: requirement.mutable });
      if (read === undefined) return reject(capture.reference,
        "A retained capture requires a proven transfer, Copy or Clone contract.");
      const invocation = read.kind === "borrow" || requirement.invocationTransfers ? read :
        selectRustValueReadOwnership({ copy, clone, transfer: capture.storage === "cell" || capture.storage === "borrow-cell" });
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
    (!transfer || !requirement.invocationTransfers && requirement.capture.storage !== "cell" && requirement.capture.storage !== "borrow-cell") };
}

export function analyzeRustReadOwnership(input: {
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly records: RustAnalysisRecords;
  readonly movingReads: ReadonlySet<Node>;
  readonly captures: ReadonlyMap<Node, readonly RustCaptureReadOwnership[]>;
  readonly nativeStorage: Pick<RustNativeStoragePlan, "operandFor">;
  readonly borrowEffects: RustBorrowEffects;
  readonly borrowEffectsInput: RustBorrowEffectsInput;
  readonly definitions: RustTypeDefinitions;
  readonly genericRequirements: RustDeclarationGenericRequirementIndex;
  readonly genericCallables: RustGenericCallablePlan;
  readonly limits?: Partial<SourceStorageLimits>;
}): { readonly kind: "resolved"; readonly ownership: Pick<RustOwnershipRecords, "reads" | "captures" | "writes"> }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { storage, records, movingReads, captures, borrowEffects } = input;
  const { ast } = storage.source;
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const rejectedBudget = () => ({ kind: "rejected" as const, diagnostics: [{
    code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error" as const, source: "tsonic-rust",
    message: budget.failure() ?? "Rust ownership reads require a complete finite source-use inventory.",
    evidence: ["target.capability=rust.analysis.ownership"],
  }] });
  const storageReads = new Map<Node, { readonly storage: boolean; readonly binding: Node | undefined }>();
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
    const parent = ast.parent(node);
    const implicitProperty = parent !== undefined && ast.name(parent) === node && sourceParameterIsProperty(ast, parent);
    storageReads.set(node, inherited ?? Object.freeze({ storage: ast.is.IsIdentifier(node) && records.sourceBinding.get(node) !== undefined ||
      implicitProperty || ast.is.IsElementAccessExpression(node) ||
      ast.kindName(node) === "KindThisExpression" || ast.kindName(node) === "KindThisKeyword" ||
      operation?.kind === "source-field" && operation.valueSemantics.kind === "stored",
      binding: records.sourceBinding.get(node)?.sourceDeclaration }));
  }
  const uses = analyzeRustReadUses(ast, input.nativeNodes, records);
  const reads = new Map<Node, RustReadOwnershipFact>();
  const writes = new Map<Node, import("../../target-model/records/ownership.js").RustBorrowedFieldWrite>();
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
  for (const node of input.nativeNodes) {
    if (!budget.step()) return rejectedBudget();
    const parent = ast.parent(node);
    const implicitProperty = parent !== undefined && ast.name(parent) === node && sourceParameterIsProperty(ast, parent);
    const carrier = implicitProperty ? records.sourceParameterAbi.get(parent)?.valueCarrier : records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) {
      const declaration = sourceEnclosingCallable(node, ast);
      const sourceStorageRead = storageReads.get(node)!;
      const captured = declaration === undefined || sourceStorageRead.binding === undefined ? undefined
        : captures.get(declaration)?.find(capture => capture.declaration === sourceStorageRead.binding);
      const projection = records.flowReadProjection.get(node);
      const valueCarrier = projection?.selectedCarrier ?? carrier;
      const physicalValueCarrier = projection === undefined && captured !== undefined ? captured.carrier : valueCarrier;
      const copy = isRustCopyCarrier(physicalValueCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const clone = rustCarrierSupportsClone(physicalValueCarrier, input.definitions) || declaration !== undefined &&
        input.genericRequirements.supportsClone(declaration, physicalValueCarrier);
      const use = uses.get(node);
      const borrowed = use?.mode === "mutable" ? "mutable" : use?.mode === "shared" &&
        use.later.every((later, index) => index < use.laterStart || !input.borrowEffectsInput.isNativeNode(later) ||
          borrowRelationships.get(node)?.has(later)) ? "shared" : undefined;
      const storageRead = sourceStorageRead.storage;
      const borrowedCapture = captured?.read.kind === "borrow";
      const value = selectRustValueReadOwnership({ copy, clone, borrowed,
        transfer: !borrowedCapture && (use?.mode === "move" || movingReads.has(node) || !storageRead) });
      const physicalSourceCarrier = captured?.carrier ?? carrier;
      const sourceCopy = isRustCopyCarrier(physicalSourceCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const sourceClone = rustCarrierSupportsClone(physicalSourceCarrier, input.definitions) || declaration !== undefined &&
        input.genericRequirements.supportsClone(declaration, physicalSourceCarrier);
      const conversion = records.contextualValueConversion.get(node);
      const conversionBorrows = conversion !== undefined &&
        rustContextualRuntimeConversionContract(conversion.conversion, input.definitions)?.sourceMode === "ref";
      const projectBorrows = records.projectDowncast.get(node) !== undefined;
      const constructsContainer = records.optionProjection.get(node)?.kind === "some";
      const sourceRead = selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone,
        transfer: !borrowedCapture && (movingReads.has(node) || !storageRead), borrowed: conversionBorrows || projectBorrows || projection !== undefined && value?.kind !== "move"
          ? "shared" : constructsContainer ? undefined : borrowed });
      const formation = selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone,
        transfer: !borrowedCapture && (movingReads.has(node) || !storageRead),
        borrowed: storageRead ? sourceRead?.kind === "borrow" ? sourceRead.mutable ? "mutable" : "shared" : undefined : undefined });
      const operation = records.targetOperation.get(node);
      const binding = records.sourceBinding.get(node);
      const module = binding === undefined ? undefined : records.moduleBinding.get(binding.sourceDeclaration);
      const staticStringView = sourceRead?.kind === "borrow" && !sourceRead.mutable &&
        module?.storage === "native-const" && isRustStringCarrier(module.valueCarrier);
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
        reads.set(node, Object.freeze({ carrier, operandCarrier: physical.carrier, formation, value, source: sourceRead,
        snapshot: selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone, transfer: false }),
        stablePlace: borrowEffects.stableBindings.has(node),
        readsStorage: storageRead,
        pure: borrowEffects.pureValues.has(node),
        sharedReference: staticStringView || sourceRead.kind === "borrow" && operation?.kind === "reference-operation" &&
          operation.operation === "load" && !operation.operandCarrier.mutable,
        borrowedAcross: borrowRelationships.get(node) ?? new Set<Node>(),
        }));
      }
    }
    const write = borrowEffects.fieldWrites.get(node);
    if (write !== undefined) writes.set(node, write);
  }
  return { kind: "resolved", ownership: Object.freeze({ reads, captures, writes }) };
}
