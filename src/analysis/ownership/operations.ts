import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
} from "@tsonic/target-api/source";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
  isRustFinalizedTaggedArrayInput,
} from "../facts/finalized-operation/conversions.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustSourceOwnershipOperationFactKey } from "../../source/semantics/facts.js";
import type {
  RustOwnershipOperation,
  RustPlaceRef,
  RustTraitProof,
  RustTypeRef,
} from "../../target-model/semantics/index.js";
import {
  rustCloneTrait,
  rustCopyTrait,
  rustDefaultTrait,
  rustToOwnedTrait,
} from "../../target-model/types/index.js";
import {
  rustClosureCaptureFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import {
  RustOwnershipComplexityError,
  rustOwnershipOperationCountComplexityDiagnostic,
} from "./complexity.js";
import { requireRustOwnershipSourceIdentity } from "./identity.js";
import { requireDenseRustOwnershipNodes } from "./source-shape.js";
import {
  rustDereferencedPlace,
  rustPlaceKey,
  rustTemporaryPlaceForExpression,
} from "./places.js";
import type { RustSourceFlowGraph, RustSourceFlowPoint } from "./control-flow.js";
import type { RustSourceValueInventory } from "./source-values.js";
import { exactCallableExpression } from "./capture-execution.js";

export interface RustOwnershipOperationRecord {
  readonly node: Node;
  readonly completionNode: Node;
  readonly sourceValue: Node;
  readonly carrier: RustTypeRef;
  readonly operation: RustOwnershipOperation;
  readonly origin: "source-marker" | "capture-transfer" | "selected-operation" | "resource-cleanup";
  readonly flowPointIndex?: number;
}

export interface RustOwnershipOperationInventory {
  readonly records: readonly RustOwnershipOperationRecord[];
  readonly operations: readonly RustOwnershipOperation[];
  readonly byNode: WeakMap<Node, RustOwnershipOperation>;
  recordForNode(node: Node): RustOwnershipOperationRecord | undefined;
  operationForSourceValue(node: Node): RustOwnershipOperation | undefined;
}

export function collectRustOwnershipOperations(
  flow: RustSourceFlowGraph,
  nodes: readonly Node[],
  places: WeakMap<Node, RustPlaceRef>,
  sourceValues: RustSourceValueInventory,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): RustOwnershipOperationInventory {
  const records: RustOwnershipOperationRecord[] = [];
  const byNode = new WeakMap<Node, RustOwnershipOperation>();
  const recordByNode = new WeakMap<Node, RustOwnershipOperationRecord>();
  const bySourceValue = new WeakMap<Node, RustOwnershipOperation>();
  const seen = new Set<string>();
  let loanCount = 0;
  const append = (
    node: Node,
    completionNode: Node,
    sourceValue: Node,
    carrier: RustTypeRef,
    operation: RustOwnershipOperation,
    origin: RustOwnershipOperationRecord["origin"],
    flowPointIndex?: number,
  ): void => {
    const occurrence = requireRustOwnershipSourceIdentity(input.ast, node);
    const key = `${occurrence}\0${ownershipOperationIdentity(operation)}\0${flowPointIndex ?? "source"}`;
    if (seen.has(key)) return;
    const nextLoanCount = loanCount + (operation.kind === "shared-borrow" ||
        operation.kind === "mutable-borrow" || operation.kind === "reborrow"
      ? 1
      : 0);
    const complexity = rustOwnershipOperationCountComplexityDiagnostic(
      records.length + 1,
      nextLoanCount,
    );
    if (complexity !== undefined) throw new RustOwnershipComplexityError(complexity);
    seen.add(key);
    loanCount = nextLoanCount;
    const record = Object.freeze({
      node,
      completionNode,
      sourceValue,
      carrier,
      operation,
      origin,
      ...(flowPointIndex === undefined ? {} : { flowPointIndex }),
    });
    records.push(record);
    if (origin !== "resource-cleanup") {
      if (byNode.get(node) === undefined) byNode.set(node, operation);
      if (recordByNode.get(node) === undefined) recordByNode.set(node, record);
    }
    if (origin === "source-marker") bySourceValue.set(sourceValue, operation);
  };
  for (const node of nodes) {
    const source = input.facts.get(node, rustSourceOwnershipOperationFactKey);
    if (source === undefined) continue;
    if (source.kind === "capture-move") {
      collectCaptureTransferOperations(
        node,
        source.valueExpression,
        places,
        sourceValues,
        input,
        environment,
        diagnostics,
        append,
      );
      continue;
    }
    const carrier = input.facts.getRuntimeCarrierFact(source.valueExpression)?.carrier;
    const selectedReferenceTarget = referenceTargetPlace(
      source.valueExpression,
      places,
      input,
    );
    const place = places.get(source.valueExpression) ??
      temporaryPlaceForOwnershipOperation(
        source.kind,
        source.valueExpression,
        selectedReferenceTarget,
        input,
      );
    if (place === undefined || carrier === undefined) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_PLACE_NOT_PROVEN",
        `Rust '${source.kind}' requires one exact source place and finalized carrier.`,
        node,
      ));
      continue;
    }
    const evidenceId = requireRustOwnershipSourceIdentity(input.ast, node);
    const operation = rustOwnershipOperation(
      source.kind,
      place,
      carrier,
      evidenceId,
      environment,
      selectedReferenceTarget,
    );
    if (operation === undefined) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_OWNERSHIP_TRAIT_PROOF_MISSING",
        `Rust '${source.kind}' is not supported by the finalized value carrier.`,
        node,
      ));
      continue;
    }
    append(node, node, source.valueExpression, carrier, operation, "source-marker");
  }
  for (const node of nodes) {
    collectSelectedOwnershipOperations(node, places, input, diagnostics, append);
  }
  for (const point of flow.points) {
    const cleanup = point.resourceCleanup;
    if (cleanup === undefined) continue;
    const declaration = cleanup.declaration;
    const place = places.get(declaration);
    const carrier = input.facts.getRuntimeCarrierFact(declaration)?.carrier;
    if (place === undefined || carrier === undefined) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_RESOURCE_CLEANUP_PLACE_NOT_PROVEN",
        "An exact resource cleanup requires one finalized resource place and carrier.",
        declaration,
      ));
      continue;
    }
    const loanId = `${point.id}\0resource-cleanup`;
    append(
      declaration,
      declaration,
      declaration,
      carrier,
      Object.freeze(cleanup.access === "mutable"
        ? { kind: "mutable-borrow" as const, place, loanId }
        : { kind: "shared-borrow" as const, place, loanId }),
      "resource-cleanup",
      point.index,
    );
  }
  const frozenRecords = Object.freeze(records);
  return Object.freeze<RustOwnershipOperationInventory>({
    records: frozenRecords,
    operations: Object.freeze(records.map((record) => record.operation)),
    byNode,
    recordForNode(node) {
      return recordByNode.get(node);
    },
    operationForSourceValue(node) {
      return bySourceValue.get(node);
    },
  });
}

function collectCaptureTransferOperations(
  operationNode: Node,
  callableValue: Node,
  places: WeakMap<Node, RustPlaceRef>,
  sourceValues: RustSourceValueInventory,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
  append: AppendRustOwnershipOperation,
): void {
  const callable = exactCallableExpression(callableValue, input.ast);
  if (callable === undefined) {
    diagnostics.push(rustOwnershipDiagnostic(
      "RUST_CAPTURE_TRANSFER_CALLABLE_NOT_PROVEN",
      "An explicit captureMove operation requires one exact inline callable expression.",
      operationNode,
    ));
    return;
  }
  const captureFact = input.facts.getFact(callable, rustClosureCaptureFactKey);
  if (captureFact === undefined) {
    diagnostics.push(rustOwnershipDiagnostic(
      "RUST_CAPTURE_TRANSFER_FACT_NOT_PROVEN",
      "An explicit captureMove operation requires exact finalized closure-capture evidence.",
      operationNode,
    ));
    return;
  }
  for (const capture of captureFact.captures) {
    if (capture.storage === "location") continue;
    const sourceContract = sourceValues.contracts.get(capture.declaration);
    if (sourceContract === undefined || sourceContract.kind === "ordinary-typescript") continue;
    const place = places.get(capture.reference) ?? places.get(capture.declaration);
    if (place === undefined) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_CAPTURE_TRANSFER_PLACE_NOT_PROVEN",
        "An explicit native capture transfer requires one exact source place.",
        capture.reference,
      ));
      continue;
    }
    const evidenceId = requireRustOwnershipSourceIdentity(input.ast, capture.reference);
    const operation = rustOwnershipOperation(
      "move",
      place,
      capture.carrier,
      evidenceId,
      environment,
    );
    if (operation === undefined) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_CAPTURE_TRANSFER_NOT_PROVEN",
        "An explicit native capture transfer has no exact move or Copy proof.",
        capture.reference,
      ));
      continue;
    }
    append(
      operationNode,
      operationNode,
      capture.reference,
      capture.carrier,
      operation,
      "capture-transfer",
    );
  }
}

function ownershipOperationIdentity(operation: RustOwnershipOperation): string {
  const place = rustPlaceKey(operation.place);
  switch (operation.kind) {
    case "shared-borrow":
    case "mutable-borrow":
      return `${operation.kind}\0${place}\0${operation.loanId}`;
    case "reborrow":
      return `${operation.kind}\0${place}\0${operation.loanId}\0${operation.sourceLoanId}\0${operation.mutable}`;
    default:
      return `${operation.kind}\0${place}`;
  }
}

type AppendRustOwnershipOperation = (
  node: Node,
  completionNode: Node,
  sourceValue: Node,
  carrier: RustTypeRef,
  operation: RustOwnershipOperation,
  origin: RustOwnershipOperationRecord["origin"],
  flowPointIndex?: number,
) => void;

export function rustOwnershipOperationFlowPoints(
  record: RustOwnershipOperationRecord,
  flow: RustSourceFlowGraph,
): readonly RustSourceFlowPoint[] {
  if (record.flowPointIndex === undefined) return flow.pointsFor(record.node);
  const point = flow.points[record.flowPointIndex];
  return point === undefined ? Object.freeze([]) : Object.freeze([point]);
}

export function rustOwnershipOperationCompletionFlowPoints(
  record: RustOwnershipOperationRecord,
  flow: RustSourceFlowGraph,
): readonly RustSourceFlowPoint[] {
  if (record.flowPointIndex === undefined) return flow.pointsFor(record.completionNode);
  const point = flow.points[record.flowPointIndex];
  return point === undefined ? Object.freeze([]) : Object.freeze([point]);
}

function collectSelectedOwnershipOperations(
  node: Node,
  places: WeakMap<Node, RustPlaceRef>,
  input: RustOwnershipAnalysisInput,
  diagnostics: TargetDiagnostic[],
  append: AppendRustOwnershipOperation,
): void {
  const fact = input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined) return;
  const occurrence = requireRustOwnershipSourceIdentity(input.ast, node);
  const nodeKind = input.ast.kindName(node);
  const args = nodeKind === "KindCallExpression" || nodeKind === "KindNewExpression"
    ? requireDenseRustOwnershipNodes(
        input.ast.arguments(node),
        "Selected operation contains an undefined source argument slot.",
        node,
      )
    : [];
  const expression = Node_Expression(input.ast, node);
  const expressionKind = expression === undefined ? undefined : input.ast.kindName(expression);
  const receiver = nodeKind === "KindCallExpression" || nodeKind === "KindNewExpression"
    ? expressionKind === "KindPropertyAccessExpression" || expressionKind === "KindElementAccessExpression"
      ? Node_Expression(input.ast, expression)
      : undefined
    : nodeKind === "KindPropertyAccessExpression" || nodeKind === "KindElementAccessExpression"
      ? expression
      : undefined;
  const add = (
    sourceValue: Node | undefined,
    mode: import("../../target-model/operations/model.js").RustArgumentMode,
    carrier: RustTypeRef | undefined,
    role: string,
  ): void => {
    if (sourceValue === undefined || carrier === undefined || mode === "value") return;
    const place = places.get(sourceValue);
    if (place === undefined) return;
    const mutable = mode === "mut-ref";
    if (mutable && carrier.kind === "reference" && !carrier.mutable) {
      diagnostics.push(rustOwnershipDiagnostic(
        "RUST_MUTABLE_REBORROW_REQUIRES_MUTABLE_REFERENCE",
        "A selected mutable Rust reborrow requires an exact mutable-reference source carrier.",
        sourceValue,
      ));
      return;
    }
    const targetPlace = carrier.kind === "reference"
      ? referenceTargetPlace(sourceValue, places, input) ?? rustDereferencedPlace(place)
      : place;
    const loanId = `${occurrence}\0${role}\0${mutable ? "mutable" : "shared"}`;
    append(
      sourceValue,
      node,
      sourceValue,
      carrier,
      Object.freeze(carrier.kind === "reference"
        ? {
            kind: "reborrow" as const,
            place: targetPlace,
            mutable,
            sourceLoanId: `reference\0${rustPlaceKey(place)}`,
            loanId,
          }
        : mutable
          ? { kind: "mutable-borrow" as const, place: targetPlace, loanId }
          : { kind: "shared-borrow" as const, place: targetPlace, loanId }),
      "selected-operation",
    );
  };
  if (fact.kind === "source-call") {
    if (fact.target.form === "method" || fact.target.form === "structural-method") {
      const receiverCarrier = input.facts.getRuntimeCarrierFact(receiver)?.carrier;
      add(
        receiver,
        fact.target.form === "method" && fact.target.mutatesSelf ? "mut-ref" : "ref",
        receiverCarrier,
        "receiver",
      );
    }
    for (const parameter of fact.parameters) {
      for (const selected of parameter.inputs) {
        add(
          args[selected.sourceArgumentIndex],
          parameter.mode,
          selected.carrier,
          `argument:${selected.sourceArgumentIndex}`,
        );
      }
    }
    return;
  }
  if (fact.kind === "provider-operation" || fact.kind === "runtime-set") {
    const sourceNode = (
      source: { readonly kind: "receiver" } | { readonly kind: "argument"; readonly sourceIndex: number },
    ): Node | undefined => source.kind === "receiver" ? receiver : args[source.sourceIndex];
    const collectInput = (
      selected: import("../facts/finalized-operation-abi.js").RustFinalizedOperationAbi["targetArguments"][number],
      role: string,
    ): void => {
      if (isRustFinalizedSourceInput(selected)) {
        add(sourceNode(selected.source), selected.mode, selected.sourceCarrier, role);
        return;
      }
      if (isRustFinalizedSliceInput(selected) || isRustFinalizedArrayInput(selected)) {
        selected.elements.forEach((element, index) =>
          add(sourceNode(element.source), element.mode, element.sourceCarrier, `${role}:${index}`));
        return;
      }
      if (isRustFinalizedTaggedArrayInput(selected)) {
        selected.elements.forEach((element, index) =>
          add(
            sourceNode(element.input.source),
            element.input.mode,
            element.input.sourceCarrier,
            `${role}:${index}`,
          ));
      }
    };
    if (fact.abi.targetReceiver.kind === "input") {
      collectInput(fact.abi.targetReceiver.input, "receiver");
    }
    fact.abi.targetArguments.forEach((selected, index) =>
      collectInput(selected, `argument:${index}`));
    return;
  }
  if (fact.kind === "operator-call") {
    const left = BinaryExpression_Left(input.ast, node);
    const right = BinaryExpression_Right(input.ast, node);
    add(left, fact.operandModes[0], input.facts.getRuntimeCarrierFact(left)?.carrier, "left");
    add(right, fact.operandModes[1], input.facts.getRuntimeCarrierFact(right)?.carrier, "right");
    return;
  }
  if (fact.kind === "iteration" && fact.lowering.kind === "borrowed") {
    add(receiver, "ref", input.facts.getRuntimeCarrierFact(receiver)?.carrier, "iterable");
  }
}

export function rustOwnershipTraitProof(
  trait: import("../../target-model/semantics/index.js").RustTraitRef,
  type: RustTypeRef,
  evidenceId: string,
): RustTraitProof {
  return Object.freeze({ trait: trait.identity, type, evidenceId });
}

function rustOwnershipOperation(
  kind: import("../../source/semantics/model.js").RustSourceOwnershipOperationKind,
  place: RustPlaceRef,
  carrier: RustTypeRef,
  evidenceId: string,
  environment: RustOwnershipEnvironment,
  selectedReferenceTarget?: RustPlaceRef,
): RustOwnershipOperation | undefined {
  const referencedPlace = carrier.kind === "reference"
    ? selectedReferenceTarget ?? rustDereferencedPlace(place)
    : place;
  switch (kind) {
    case "shared-borrow":
      return carrier.kind === "reference"
        ? Object.freeze({
            kind: "reborrow",
            place: referencedPlace,
            mutable: false,
            sourceLoanId: `reference\0${rustPlaceKey(place)}`,
            loanId: `${evidenceId}\0shared-reborrow`,
          })
        : Object.freeze({ kind, place, loanId: `${evidenceId}\0shared` });
    case "mutable-borrow":
      if (carrier.kind === "reference") {
        return carrier.mutable
          ? Object.freeze({
              kind: "reborrow",
              place: referencedPlace,
              mutable: true,
              sourceLoanId: `reference\0${rustPlaceKey(place)}`,
              loanId: `${evidenceId}\0mutable-reborrow`,
            })
          : undefined;
      }
      return Object.freeze({ kind, place, loanId: `${evidenceId}\0mutable` });
    case "move":
      return environment.supportsTrait(carrier, rustCopyTrait)
        ? Object.freeze({
            kind: "copy" as const,
            place,
            proof: rustOwnershipTraitProof(rustCopyTrait, carrier, evidenceId),
          })
        : Object.freeze({ kind, place });
    case "clone":
      return environment.supportsTrait(carrier, rustCloneTrait)
        ? Object.freeze({
            kind,
            place,
            proof: rustOwnershipTraitProof(rustCloneTrait, carrier, evidenceId),
          })
        : undefined;
    case "own":
      return carrier.kind === "reference" &&
          environment.supportsTrait(carrier.target, rustToOwnedTrait)
        ? Object.freeze({
            kind: "to-owned",
            place: referencedPlace,
            proof: rustOwnershipTraitProof(rustToOwnedTrait, carrier.target, evidenceId),
          })
        : undefined;
    case "load":
      return carrier.kind === "reference" &&
          environment.supportsTrait(carrier.target, rustCopyTrait)
        ? Object.freeze({
            kind,
            place: referencedPlace,
            proof: rustOwnershipTraitProof(rustCopyTrait, carrier.target, evidenceId),
          })
        : undefined;
    case "store":
      return carrier.kind === "reference" && carrier.mutable
        ? Object.freeze({ kind, place: referencedPlace })
        : undefined;
    case "replace":
      return carrier.kind === "reference" && carrier.mutable
        ? Object.freeze({ kind, place: referencedPlace })
        : undefined;
    case "take":
      return carrier.kind === "reference" && carrier.mutable &&
          environment.supportsTrait(carrier.target, rustDefaultTrait)
        ? Object.freeze({
            kind,
            place: referencedPlace,
            proof: rustOwnershipTraitProof(rustDefaultTrait, carrier.target, evidenceId),
          })
        : undefined;
    case "capture-move":
      return undefined;
  }
}

function referenceTargetPlace(
  node: Node,
  places: WeakMap<Node, RustPlaceRef>,
  input: RustOwnershipAnalysisInput,
  seen: ReadonlySet<Node> = new Set<Node>(),
): RustPlaceRef | undefined {
  const directOperation = input.facts.get(node, rustSourceOwnershipOperationFactKey);
  if (directOperation?.kind === "shared-borrow" ||
    directOperation?.kind === "mutable-borrow") {
    const target = directOperation.valueExpression;
    const targetPlace = places.get(target) ?? rustTemporaryPlaceForExpression(target, input.ast);
    if (targetPlace === undefined) return undefined;
    const targetCarrier = input.facts.getRuntimeCarrierFact(target)?.carrier;
    return targetCarrier?.kind === "reference"
      ? referenceTargetPlace(target, places, input, seen) ?? rustDereferencedPlace(targetPlace)
      : targetPlace;
  }
  const declaration = input.navigation.sourceReferenceFor(node)?.declaration ??
    (isValueDeclaration(input.ast.kindName(node)) ? node : undefined);
  if (declaration === undefined || seen.has(declaration)) return undefined;
  const initializer = Node_Initializer(input.ast, declaration);
  if (initializer === undefined) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(declaration);
  const operation = input.facts.get(initializer, rustSourceOwnershipOperationFactKey);
  if (operation?.kind === "shared-borrow" || operation?.kind === "mutable-borrow") {
    const target = operation.valueExpression;
    const targetPlace = places.get(target);
    const targetCarrier = input.facts.getRuntimeCarrierFact(target)?.carrier;
    if (targetPlace === undefined) return undefined;
    return targetCarrier?.kind === "reference"
      ? referenceTargetPlace(target, places, input, nextSeen) ?? rustDereferencedPlace(targetPlace)
      : targetPlace;
  }
  const initializerCarrier = input.facts.getRuntimeCarrierFact(initializer)?.carrier;
  if (initializerCarrier?.kind !== "reference") return undefined;
  const initializerPlace = places.get(initializer);
  return referenceTargetPlace(initializer, places, input, nextSeen) ??
    (initializerPlace === undefined ? undefined : rustDereferencedPlace(initializerPlace));
}

function temporaryPlaceForOwnershipOperation(
  kind: import("../../source/semantics/model.js").RustSourceOwnershipOperationKind,
  expression: Node,
  selectedReferenceTarget: RustPlaceRef | undefined,
  input: RustOwnershipAnalysisInput,
): RustPlaceRef | undefined {
  if (kind === "shared-borrow" || kind === "mutable-borrow" ||
    kind === "move" || kind === "clone" || selectedReferenceTarget !== undefined) {
    return rustTemporaryPlaceForExpression(expression, input.ast);
  }
  return undefined;
}

function isValueDeclaration(kind: string): boolean {
  return kind === "KindVariableDeclaration" || kind === "KindBindingElement" ||
    kind === "KindParameter" || kind === "KindPropertyDeclaration";
}
