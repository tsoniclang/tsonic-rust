import type { Node } from "@tsonic/tsts";
import { Node_Expression, sourceEnclosingCallable, sourceParameterIsProperty, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { createSourceStorageBudget, defaultSourceStorageLimits, type SourceStorageLimits, type SourceStorageQueries } from "@tsonic/target-api/analysis";
import type { RustCaptureReadOwnership, RustOwnershipRecords, RustReadOwnershipFact, RustReadUse } from "../../target-model/records/storage/ownership.js";
import type { RustAnalysisRecords } from "../../target-model/records/analysis.js";
import type { RustClosureCaptureFact } from "../../target-model/records/operations/operation-selections.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { isRustStringCarrier, rustLocationTargetType } from "../../target-model/types/index.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import type { AnalyzeRustDeclarationGenericRequirementsResult, RustDeclarationGenericRequirementIndex } from "../declarations/generic-requirements.js";
import type { RustGenericCallablePlan } from "../callables/generics/generic-values.js";
import type { RustOwnershipFlow } from "../../target-model/records/storage/ownership-flow.js";
import { selectRustBorrowRelationship, type RustBorrowEffectsInput } from "./effects.js";
import { type RustBorrowEffects } from "../../target-model/records/storage/ownership-effects.js";
import { selectRustValueReadOwnership } from "../../policy/ownership/value-read.js";
import { rustBorrowedOperationArguments } from "../storage/provider-borrows.js";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { rustContextualRuntimeConversionContract } from "../../policy/conversions/contextual.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export type RustPreparedReadSelection =
  | { readonly kind: "selected"; readonly carrier: RustReadOwnershipFact["carrier"]; readonly value: RustReadOwnershipFact["value"] }
  | { readonly kind: "unresolved"; readonly reason: string };

export function prepareRustReadOwnership(input: {
  readonly storage: SourceStorageQueries;
  readonly nativeNodes: readonly Node[];
  readonly uses: ReadonlyMap<Node, RustReadUse>;
  readonly records: RustAnalysisRecords;
  readonly flow: RustOwnershipFlow;
  readonly borrowEffects: RustBorrowEffects;
  readonly borrowEffectsInput: RustBorrowEffectsInput;
  readonly definitions: RustTypeDefinitions;
  readonly genericCallables: RustGenericCallablePlan;
  readonly capturesFor: (owner: Node) => RustClosureCaptureFact | undefined;
  readonly invocationTransfersCapture: (owner: Node) => boolean;
  readonly limits?: Partial<SourceStorageLimits>;
}): { readonly kind: "resolved"; readonly borrowFor: (node: Node) => "shared" | "mutable" | undefined;
  readonly readFor: (node: Node, requirements: AnalyzeRustDeclarationGenericRequirementsResult) => RustPreparedReadSelection | undefined;
  readonly complete: (genericRequirements: RustDeclarationGenericRequirementIndex) =>
    { readonly kind: "resolved"; readonly ownership: RustOwnershipRecords }
    | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } }
  | { readonly kind: "rejected"; readonly diagnostics: readonly TargetDiagnostic[] } {
  const { storage, records, flow, borrowEffects, uses } = input;
  const { ast } = storage.source;
  const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...input.limits });
  const rejectedBudget = () => ({ kind: "rejected" as const, diagnostics: [{
    code: "RUST_OWNERSHIP_READ_BUDGET_EXCEEDED", category: "error" as const, source: "tsonic-rust",
    message: budget.failure() ?? "Rust ownership reads require a complete finite source-use inventory.",
    evidence: ["target.capability=rust.analysis.ownership"],
  }] });
  const storageReads = new Map<Node, boolean>();
  for (let index = input.nativeNodes.length - 1; index >= 0; index -= 1) {
    if (!budget.node() || !budget.step() || !budget.row()) return rejectedBudget();
    const node = input.nativeNodes[index]!;
    const operation = records.targetOperation.get(node);
    const receiverAlias = operation?.kind === "source-field" && operation.valueSemantics.kind === "receiver-alias" &&
      operation.dispatch === undefined && rustTargetTypeRefEquals(operation.receiverCarrier, operation.resultCarrier);
    const operand = sourceTransparentExpressionOperand(ast, node) ?? (receiverAlias ? Node_Expression(ast, node) : undefined);
    const nativeOperand = operand !== undefined && input.borrowEffectsInput.isNativeNode(operand);
    const inherited = nativeOperand ? storageReads.get(operand) : undefined;
    if (receiverAlias && !nativeOperand || nativeOperand && inherited === undefined) {
      return { kind: "rejected", diagnostics: [{
        code: "RUST_OWNERSHIP_SOURCE_INVENTORY_INVALID", category: "error", source: "tsonic-rust", sourceNode: node,
        message: "Rust ownership requires the complete parent-before-child checked source inventory.",
        evidence: ["target.capability=rust.analysis.ownership"],
      }] };
    }
    const borrowedElement = records.borrowedElement.get(node) !== undefined && uses.get(node)?.mode === "shared";
    const ownedProviderResult = operation?.kind === "provider-operation" && flow.movingReads.has(node) && !borrowedElement;
    const referenceLoad = operation?.kind === "reference-operation" && operation.operation === "load";
    storageReads.set(node, inherited ?? (ast.is.IsIdentifier(node) || ast.is.IsElementAccessExpression(node) && !ownedProviderResult ||
      ast.kindName(node) === "KindThisExpression" || ast.kindName(node) === "KindThisKeyword" ||
      referenceLoad || operation?.kind === "source-field" && operation.valueSemantics.kind === "stored"));
  }
  const borrowDemands = new Map<Node, Set<Node>>();
  const compare = (source: Node | undefined, later: Node | undefined): void => {
    if (source === undefined || later === undefined) return;
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
      const operation = records.targetOperation.get(node);
      const referenceLoad = operation?.kind === "reference-operation" && operation.operation === "load";
      if (use?.mode === "shared" && borrowEffects.pureValues.has(value) ||
        use?.stableAcrossEffects === true && borrowEffects.stableBindings.has(node) &&
        (laterPositions.get(use.later)?.get(value) ?? -1) >= use.laterStart ||
        referenceLoad && (!operation.operandCarrier.mutable && isRustStringCarrier(operation.operandCarrier.referent) ||
          borrowEffects.pureValues.has(value)) ||
        selectRustBorrowRelationship(referenceLoad ? operation.operandExpression : node, value, input.borrowEffectsInput, borrowEffects)) selected.add(value);
    }
    borrowRelationships.set(node, selected);
  }
  const borrows = new Map<Node, "shared" | "mutable">();
  for (const node of input.nativeNodes) {
    if (!budget.step()) return rejectedBudget();
    if (!storageReads.get(node)) continue;
    const use = uses.get(node);
    const borrowed = use?.mode === "mutable" ? "mutable" : use?.mode === "shared" &&
      use.later.every((later, index) => index < use.laterStart || borrowRelationships.get(node)?.has(later)) ? "shared" : undefined;
    if (borrowed !== undefined) borrows.set(node, borrowed);
  }
  const borrowFor = (node: Node) => borrows.get(node);
  const valueReadFor = (node: Node, requirements: AnalyzeRustDeclarationGenericRequirementsResult) => {
    const storageRead = storageReads.get(node);
    if (storageRead === undefined) return undefined;
    const parent = ast.parent(node);
    const implicitProperty = parent !== undefined && ast.name(parent) === node && sourceParameterIsProperty(ast, parent);
    const carrier = implicitProperty ? records.sourceParameterAbi.get(parent)?.valueCarrier : records.runtimeCarrier.get(node)?.carrier;
    if (carrier === undefined) return undefined;
    const declaration = sourceEnclosingCallable(node, ast);
    const projection = records.flowReadProjection.get(node);
    const valueCarrier = projection?.selectedCarrier ?? carrier;
    const copy = isRustCopyCarrier(valueCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
    const clone = rustCarrierSupportsClone(valueCarrier, input.definitions) || requirements.kind === "resolved" && declaration !== undefined &&
      requirements.index.supportsClone(declaration, valueCarrier);
    const use = uses.get(node);
    const value = selectRustValueReadOwnership({ copy, clone, borrowed: borrowFor(node),
      transfer: use?.mode === "move" || flow.movingReads.has(node) || !storageRead });
    return { carrier, value };
  };
  const readFor = (node: Node, requirements: AnalyzeRustDeclarationGenericRequirementsResult): RustPreparedReadSelection | undefined => {
    const selected = valueReadFor(node, requirements);
    if (selected === undefined) return undefined;
    if (selected.value === undefined) return requirements.kind === "rejected"
      ? { kind: "unresolved", reason: "A retained native read requires its actual completed ownership contract." } : undefined;
    return { kind: "selected", carrier: selected.carrier, value: selected.value };
  };
  return { kind: "resolved", borrowFor, readFor, complete(genericRequirements) {
    const requirements = { kind: "resolved" as const, index: genericRequirements };
    const reads = new Map<Node, RustReadOwnershipFact>();
    const captures = new Map<Node, readonly RustCaptureReadOwnership[]>();
    const writes = new Map<Node, import("../../target-model/records/storage/ownership.js").RustBorrowedFieldWrite>();
    for (const node of input.nativeNodes) {
      const selected = valueReadFor(node, requirements);
      if (selected !== undefined) {
        const { carrier, value } = selected;
        const declaration = sourceEnclosingCallable(node, ast);
        const projection = records.flowReadProjection.get(node);
        const storageRead = storageReads.get(node)!;
        const borrowed = borrowFor(node);
        const sourceCopy = isRustCopyCarrier(carrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
        const sourceClone = rustCarrierSupportsClone(carrier, input.definitions) || declaration !== undefined &&
          genericRequirements.supportsClone(declaration, carrier);
        const conversion = records.contextualValueConversion.get(node);
        const conversionBorrows = conversion !== undefined &&
          rustContextualRuntimeConversionContract(conversion.conversion, input.definitions)?.sourceMode === "ref";
        const projectBorrows = records.projectDowncast.get(node) !== undefined;
        const constructsContainer = records.optionProjection.get(node)?.kind === "some";
        const sourceRead = selectRustValueReadOwnership({ copy: sourceCopy, clone: sourceClone,
          transfer: flow.movingReads.has(node) || !storageRead, borrowed: conversionBorrows && borrowed !== undefined || projectBorrows || storageRead && projection !== undefined && value?.kind !== "move"
            ? "shared" : constructsContainer ? undefined : borrowed });
        const operation = records.targetOperation.get(node);
        const binding = records.sourceBinding.get(node);
        const module = binding === undefined ? undefined : records.moduleBinding.get(binding.sourceDeclaration);
        const staticStringView = sourceRead?.kind === "borrow" && !sourceRead.mutable &&
          module?.storage === "native-const" && isRustStringCarrier(module.valueCarrier);
        if ((value === undefined || sourceRead === undefined) && storageRead &&
          (records.sourceBinding.get(node) !== undefined || operation?.kind === "source-field" && operation.accessMode === "read" ||
            operation?.kind === "reference-operation" && operation.operation === "load")) {
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
          sharedReference: staticStringView || sourceRead.kind === "borrow" && operation?.kind === "reference-operation" &&
            operation.operation === "load" && !operation.operandCarrier.mutable && !sourceCopy,
          borrowedAcross: borrowRelationships.get(node) ?? new Set<Node>(),
        }));
      }
      const selectedCaptures: RustCaptureReadOwnership[] = [];
      const sourceCaptures = input.capturesFor(node);
      for (const capture of sourceCaptures?.captures ?? []) {
        const physicalCarrier = capture.storage === "location" ? rustLocationTargetType(capture.carrier) : capture.carrier;
        const copy = isRustCopyCarrier(physicalCarrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
        const clone = rustCarrierSupportsClone(physicalCarrier, input.definitions) ||
          genericRequirements.supportsClone(node, physicalCarrier);
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
      for (const receiver of sourceCaptures?.receivers ?? []) {
        if (!budget.step()) return rejectedBudget();
        const copy = isRustCopyCarrier(receiver.carrier, selected => input.genericCallables.definitionFor(selected)?.copy === true);
        const clone = rustCarrierSupportsClone(receiver.carrier, input.definitions) ||
          genericRequirements.supportsClone(node, receiver.carrier);
        const read = selectRustValueReadOwnership({ copy, clone, transfer: false });
        if (read === undefined) return { kind: "rejected", diagnostics: [{
          code: "RUST_CAPTURE_OWNERSHIP_UNAVAILABLE", category: "error", source: "tsonic-rust",
          sourceNode: receiver.reference, message: "A retained receiver requires a proven native Copy or Clone ownership contract.",
          evidence: ["target.capability=rust.analysis.ownership"],
        }] };
        selectedCaptures.push(Object.freeze({ declaration: receiver.owner, reference: receiver.reference,
          carrier: receiver.carrier, read, invocation: read, borrowed: read }));
      }
      if (selectedCaptures.length > 0) captures.set(node, Object.freeze(selectedCaptures));
      const write = borrowEffects.fieldWrites.get(node);
      if (write !== undefined) writes.set(node, write);
    }
    return { kind: "resolved", ownership: Object.freeze({ uses, reads, captures, writes }) };
  } };
}
