import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable, sourceParameterIsProperty, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits, type SourceStorageLimits, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustCaptureReadOwnership, RustOwnershipRecords, RustReadOwnershipFact } from "../../target-model/records/ownership.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustClosureCaptureFact } from "../../target-model/records/operation-selections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustCopyCarrier, rustCarrierSupportsClone, rustLocationTargetType } from "../../target-model/types/index.js";
import type { RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustGenericCallablePlan } from "../callables/generic-values.js";
import type { RustOwnershipFlow } from "./flow.js";
import { selectRustBorrowRelationship, type RustBorrowEffects, type RustBorrowEffectsInput } from "./effects.js";
import { selectRustValueReadOwnership } from "../../policy/ownership/value-read.js";
import { rustBorrowedOperationArguments } from "../storage/provider-borrows.js";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRustReadUses } from "./uses.js";
import { rustContextualRuntimeConversionContract } from "../../target-model/conversions/contextual.js";

export function analyzeRustReadOwnership(input: {
  readonly storage: SourceStorageQueries;
  readonly records: RustProgramRecords;
  readonly flow: RustOwnershipFlow;
  readonly borrowEffects: RustBorrowEffects;
  readonly borrowEffectsInput: RustBorrowEffectsInput;
  readonly definitions: RustTypeDefinitions;
  readonly genericRequirements: RustDeclarationGenericRequirementIndex;
  readonly genericCallables: RustGenericCallablePlan;
  readonly capturesFor: (owner: Node) => RustClosureCaptureFact | undefined;
  readonly invocationTransfersCapture: (owner: Node) => boolean;
  readonly limits?: Partial<SourceStorageLimits>;
}): { readonly kind: "resolved"; readonly ownership: RustOwnershipRecords }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { storage, records, flow, borrowEffects } = input;
  const { ast } = storage.source;
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const rejectedBudget = () => ({ kind: "rejected" as const, diagnostics: [{
    code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error" as const, source: "tsonic-rust",
    message: budget.failure() ?? "Rust ownership reads require a complete finite source-use inventory.",
    evidence: ["target.capability=rust.analysis.ownership"],
  }] });
  const uses = analyzeRustReadUses(ast, storage.nodes, records);
  const reads = new Map<Node, RustReadOwnershipFact>();
  const captures = new Map<Node, readonly RustCaptureReadOwnership[]>();
  const writes = new Map<Node, import("../../target-model/records/ownership.js").RustBorrowedFieldWrite>();
  const borrowDemands = new Map<Node, Set<Node>>();
  const compare = (source: Node | undefined, later: Node | undefined): void => {
    if (source === undefined || later === undefined) return;
    const demand = borrowDemands.get(source) ?? new Set<Node>();
    if (demand.has(later) || !budget.row()) return;
    demand.add(later);
    borrowDemands.set(source, demand);
  };
  for (const node of storage.nodes) {
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
  for (const node of storage.nodes) {
    if (!budget.step()) return rejectedBudget();
    const parent = ast.parent(node);
    const implicitProperty = parent !== undefined && ast.name(parent) === node && sourceParameterIsProperty(ast, parent);
    const carrier = implicitProperty ? records.sourceParameterAbi.get(parent)?.valueCarrier : records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) {
      const declaration = sourceEnclosingCallable(node, ast);
      const projection = records.flowReadProjection.get(node);
      const valueCarrier = projection?.selectedCarrier ?? carrier;
      const copy = isRustCopyCarrier(valueCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const clone = rustCarrierSupportsClone(valueCarrier, input.definitions) || declaration !== undefined &&
        input.genericRequirements.supportsClone(declaration, valueCarrier);
      const use = uses.get(node);
      const borrowed = use?.mode === "mutable" ? "mutable" : use?.mode === "shared" &&
        use.later.every((later, index) => index < use.laterStart || borrowRelationships.get(node)?.has(later)) ? "shared" : undefined;
      const storageRead = readsStorage(node, storage, records);
      const value = selectRustValueReadOwnership({ copy, clone, borrowed,
        transfer: use?.mode === "move" || flow.movingReads.has(node) || !storageRead });
      const sourceCopy = isRustCopyCarrier(carrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const sourceClone = rustCarrierSupportsClone(carrier, input.definitions) || declaration !== undefined &&
        input.genericRequirements.supportsClone(declaration, carrier);
      const conversion = records.contextualValueConversion.get(node);
      const conversionBorrows = conversion !== undefined &&
        rustContextualRuntimeConversionContract(conversion.conversion, input.definitions)?.sourceMode === "ref";
      const projectBorrows = records.projectDowncast.get(node) !== undefined;
      const constructsContainer = records.optionProjection.get(node)?.kind === "some";
      const sourceRead = selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone,
        transfer: flow.movingReads.has(node) || !storageRead, borrowed: conversionBorrows || projectBorrows || projection !== undefined && value?.kind !== "move"
          ? "shared" : constructsContainer ? undefined : borrowed });
      const operation = records.targetOperation.get(node);
      if ((value === undefined || sourceRead === undefined) && storageRead &&
        (records.sourceBinding.get(node) !== undefined || operation?.kind === "source-field" && operation.accessMode === "read")) {
        return { kind: "rejected", diagnostics: [{
          code: "RUST_VALUE_READ_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust", sourceNode: node,
          message: "An owned native value read requires a proven transfer, Copy or Clone contract; a borrowed read requires its exact use-site lease.",
          evidence: ["target.capability=rust.analysis.ownership"],
        }] };
      }
      if (value !== undefined && sourceRead !== undefined) reads.set(node, Object.freeze({ carrier, value, source: sourceRead,
        snapshot: selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone, transfer: false }),
        stablePlace: borrowEffects.stableBindings.has(node),
        readsStorage: storageRead,
        pure: borrowEffects.pureValues.has(node),
        sharedReference: sourceRead.kind === "borrow" && operation?.kind === "reference-operation" &&
          operation.operation === "load" && !operation.operandCarrier.mutable,
        borrowedAcross: borrowRelationships.get(node) ?? new Set<Node>(),
      }));
    }
    const selectedCaptures: RustCaptureReadOwnership[] = [];
    for (const capture of input.capturesFor(node)?.captures ?? []) {
      const physicalCarrier = capture.storage === "location" ? rustLocationTargetType(capture.carrier) : capture.carrier;
      const copy = isRustCopyCarrier(physicalCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
      const clone = rustCarrierSupportsClone(physicalCarrier, input.definitions) ||
        input.genericRequirements.supportsClone(node, physicalCarrier);
      const read = selectRustValueReadOwnership({ copy, clone,
        transfer: capture.storage === "cell" || capture.storage === "borrow-cell" ||
          flow.captureTransfers.get(node)?.has(capture.declaration) === true });
      if (read === undefined) return { kind: "rejected", diagnostics: [{
        code: "RUST_CAPTURE_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust",
        sourceNode: capture.reference, message: "A retained capture requires a proven transfer, Copy or Clone contract.",
        evidence: ["target.capability=rust.analysis.ownership"],
      }] };
      const invocation = input.invocationTransfersCapture(node) ? read :
        selectRustValueReadOwnership({ copy, clone, transfer: capture.storage === "cell" || capture.storage === "borrow-cell" });
      if (invocation === undefined) return { kind: "rejected", diagnostics: [{
        code: "RUST_CAPTURE_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust",
        sourceNode: capture.reference, message: "A repeated capture invocation requires its exact Copy or Clone contract.",
        evidence: ["target.capability=rust.analysis.ownership"],
      }] };
      selectedCaptures.push(Object.freeze({ declaration: capture.declaration, reference: capture.reference,
        carrier: capture.carrier, read, invocation,
        borrowed: selectRustValueReadOwnership({ copy, clone, transfer: capture.storage === "cell" || capture.storage === "borrow-cell" }) }));
    }
    if (selectedCaptures.length > 0) captures.set(node, Object.freeze(selectedCaptures));
    const write = borrowEffects.fieldWrites.get(node);
    if (write !== undefined) writes.set(node, write);
  }
  return { kind: "resolved", ownership: Object.freeze({ reads, captures, writes }) };
}

function readsStorage(node: Node, storage: SourceStorageQueries, records: RustProgramRecords): boolean {
  const { ast } = storage.source;
  let source = node;
  for (;;) {
    const operand = sourceTransparentExpressionOperand(ast, source);
    if (operand === undefined) break;
    source = operand;
  }
  const operation = records.targetOperation.get(source);
  return ast.is.IsIdentifier(source) || ast.is.IsElementAccessExpression(source) ||
    ast.kindName(source) === "KindThisExpression" || ast.kindName(source) === "KindThisKeyword" ||
    operation?.kind === "source-field" && operation.valueSemantics.kind === "stored";
}
