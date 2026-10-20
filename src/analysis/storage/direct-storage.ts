import type { Node, Symbol } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustDirectStorageProducer } from "../program/records/direct-storage.js";
import type { RustDirectStorageEmission, RustDirectStorageIdentity } from "../../target-model/records/direct-storage.js";
import { rustTargetOperationIsDirectLocation } from "../operations/target-operation.js";

export function analyzeRustDirectStorage(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustDirectStorageProducer): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const places = new Map<Node, RustDirectStorageEmission>();
  const identities = new Map<Node, RustDirectStorageIdentity>();
  const roots = new Map<Symbol, ReadonlySet<Node>>();
  const effects = new Map<Node, boolean>();
  const issues: TargetDiagnostic[] = [];
  const reported = new Map<Node, Set<string>>();
  const effect = (node: Node): boolean => {
    const previous = effects.get(node);
    if (previous !== undefined) return previous;
    const selected = program.sourceNavigation.expressionEffects(node);
    const value = selected.invokes || selected.mutates || selected.suspends || selected.mayThrow;
    effects.set(node, value);
    producer.effect(node, value);
    return value;
  };
  const identity = (node: Node): RustDirectStorageIdentity => {
    const previous = identities.get(node);
    if (previous !== undefined) return previous;
    let current: Node | undefined = node;
    let symbol: Symbol | undefined;
    const visited = new Set<Node>();
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const reference = program.sourceNavigation.sourceReferenceFor(current);
      if (reference !== undefined) { symbol = reference.symbol; break; }
      if (!ast.is.IsPropertyAccessExpression(current) && !ast.is.IsElementAccessExpression(current) && !ast.is.IsParenthesizedExpression(current)) break;
      current = Node_Expression(ast, current);
    }
    let invalidatedRoots = symbol === undefined ? undefined : roots.get(symbol);
    if (symbol !== undefined && invalidatedRoots === undefined) {
      const selected = new Set<Node>();
      for (const file of program.sourceFiles) for (const write of program.sourceNavigation.bindingWritesWithin(symbol, file)) {
        let ancestor: Node | undefined = write.reference;
        while (ancestor !== undefined && !selected.has(ancestor)) {
          selected.add(ancestor);
          ancestor = ast.parent(ancestor);
        }
      }
      invalidatedRoots = selected;
      roots.set(symbol, selected);
    }
    const selected = Object.freeze({ resolved: symbol !== undefined, invalidatedRoots: invalidatedRoots ?? new Set<Node>() });
    identities.set(node, selected);
    producer.identity(node, selected);
    return selected;
  };
  const active = new Set<Node>();
  const select = (node: Node): RustDirectStorageEmission => {
    const previous = places.get(node);
    if (previous !== undefined) return previous;
    if (active.has(node)) return { kind: "unavailable" };
    active.add(node);
    let value: RustDirectStorageEmission = { kind: "unavailable" };
    if (ast.is.IsIdentifier(node)) {
      const binding = program.records.sourceBinding.get(node);
      const module = binding === undefined ? undefined : program.records.moduleBinding.get(binding.sourceDeclaration);
      if (binding !== undefined && program.records.bindingStorage.get(binding.sourceDeclaration) === undefined &&
        module?.storage !== "module-cell" && !(module?.storage === "native-callable" && module.value !== undefined)) value = { kind: "identifier" };
    } else if (ast.kindName(node) === "KindThisExpression" || ast.kindName(node) === "KindThisKeyword") value = { kind: "this" };
    else if (ast.is.IsParenthesizedExpression(node)) {
      const inner = Node_Expression(ast, node);
      if (inner !== undefined) { select(inner); value = { kind: "parenthesized", inner }; }
    } else {
      const fact = program.records.targetOperation.get(node);
      const receiver = Node_Expression(ast, node);
      const index = ElementAccessExpression_ArgumentExpression(ast, node);
      if (receiver !== undefined) select(receiver);
      if (fact?.kind === "source-field" && fact.valueSemantics.kind === "stored" && fact.storage === "project-object" && fact.dispatch === undefined) {
        const representation = program.objectRepresentations.representationFor(program.projectTypes.definitionForCarrier(fact.receiverCarrier));
        const path = program.records.storedField.get("project-object", fact.receiverCarrier, fact.storageIndex)?.path;
        if (representation?.kind === "value" && path !== undefined && receiver !== undefined) value = { kind: "field", receiver, path };
      } else if (rustTargetOperationIsDirectLocation(fact)) {
        if (fact?.kind === "provider-operation" && fact.abi.result.kind === "sync" && fact.abi.result.conversion.kind === "identity" &&
          fact.abi.effects.invocation === "infallible" && (fact.abi.target.form === "field" || fact.abi.target.form === "index")) {
          const receiverInput = fact.abi.targetReceiver.kind === "input" && fact.abi.targetReceiver.input.source.kind === "receiver"
            ? fact.abi.targetReceiver.input : undefined;
          if (receiverInput === undefined || receiverInput.conversion.kind === "identity" && receiver !== undefined)
            value = { kind: "provider", operation: fact, receiver, index, receiverInput };
        } else if ((fact?.kind === "tuple-index" || fact?.kind === "fixed-index") && receiver !== undefined && index !== undefined)
          value = { kind: fact.kind === "tuple-index" ? "tuple" : "fixed", receiver, index, position: fact.index,
            evaluateIndex: !ast.is.IsNumericLiteral(index) };
      }
    }
    active.delete(node);
    places.set(node, value);
    producer.place(node, value);
    identity(node);
    effect(node);
    return value;
  };
  const refuse = (receiver: Node, capability: string, code: string, message: string): void => {
    const seen = reported.get(receiver) ?? new Set<string>();
    if (seen.has(capability)) return;
    seen.add(capability);
    reported.set(receiver, seen);
    issues.push({ code, category: "error", source: "tsonic-rust", sourceNode: receiver,
      message: `${message} Node kind: ${ast.kindName(receiver)}.`, evidence: [`target.capability=${capability}`] });
  };
  const admit = (receiver: Node, later: readonly Node[]): void => {
    const effectful = later.filter(effect);
    if (effectful.length === 0) return;
    const selected = identity(receiver);
    if (!selected.resolved) refuse(receiver, "rust.backend.direct-storage-identity", "RUST_MISSING_TARGET_FACT",
      "Effectful writable projection requires one exact source storage identity.");
    else if (effectful.some(node => selected.invalidatedRoots.has(node))) refuse(receiver,
      "rust.backend.direct-storage-rebinding", "RUST_UNSUPPORTED_AST",
      "Writable projection cannot preserve source evaluation order when a later expression rebinds its selected storage.");
  };
  const admitted = new Set<Node>();
  const admitPlace = (node: Node): void => {
    if (admitted.has(node)) return;
    admitted.add(node);
    const selected = select(node);
    if (selected.kind === "parenthesized") admitPlace(selected.inner);
    else if (selected.kind === "field") admitPlace(selected.receiver);
    else if (selected.kind === "provider" && selected.receiverInput !== undefined && selected.receiver !== undefined) {
      admit(selected.receiver, selected.index === undefined ? [] : [selected.index]);
      admitPlace(selected.receiver);
    } else if (selected.kind === "tuple" || selected.kind === "fixed") {
      if (selected.evaluateIndex) admit(selected.receiver, [selected.index]);
      admitPlace(selected.receiver);
    }
  };
  for (const node of nodes) { select(node); effect(node); }
  for (const node of nodes) {
    const computed = program.records.computedMember.get(node);
    const accessor = program.records.accessorReceiver.get(node);
    if (computed?.evaluateKey && computed.evaluateReceiver && accessor?.value) {
      admit(accessor.receiver, [computed.key]);
      admitPlace(accessor.receiver);
    }
    if (program.records.fieldValueReceiver.get(node) === true) {
      const receiver = Node_Expression(ast, node);
      if (receiver !== undefined) admitPlace(receiver);
    }
    const location = program.records.typedLocationPlan.get(node);
    if (location?.operation === "address-of") admitPlace(location.storageExpression);
    const assignment = program.records.assignmentCompletion.get(node);
    const operator = program.records.targetOperation.get(node);
    const left = ast.is.IsBinaryExpression(node) ? BinaryExpression_Left(ast, node) : undefined;
    const right = ast.is.IsBinaryExpression(node) ? BinaryExpression_Right(ast, node) : undefined;
    if (left !== undefined && right !== undefined && (assignment !== undefined || operator?.kind === "nullish-assignment")) {
      admitPlace(left);
      const selected = program.records.accessorReceiver.get(left);
      if (selected?.value) admit(selected.receiver, [right]);
      const target = program.records.targetOperation.get(left);
      const receiver = Node_Expression(ast, left);
      if (receiver !== undefined && rustTargetOperationIsDirectLocation(target) && select(receiver).kind === "identifier") {
        const index = ElementAccessExpression_ArgumentExpression(ast, left);
        admit(receiver, [...(index === undefined ? [] : [index]), right]);
      }
    }
  }
  return Object.freeze(issues);
}
