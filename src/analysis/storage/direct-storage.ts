import type { Node, Symbol } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustDirectStorageProducer } from "../program/records/direct-storage.js";
import type { RustDirectStorageEmission, RustDirectStorageIdentity } from "../../target-model/records/direct-storage.js";
import { rustTargetOperationIsDirectLocation } from "../operations/target-operation.js";
import { isRustFinalizedSourceInput } from "../../target-model/operations/finalized-inputs.js";
import type { RustUpdateProjectField, RustUpdateProjectionArgument, RustUpdateMember, RustLocationStorageRoot } from "../../target-model/records/direct-storage.js";

export function analyzeRustDirectStorage(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustDirectStorageProducer,
  analysisRecords: Pick<import("../program/records/model.js").RustAnalysisRecords, "typedLocationPlan">): readonly TargetDiagnostic[] {
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
    let current: Node | undefined = node;
    let memberNode: Node | undefined = node;
    const memberVisited = new Set<Node>();
    let member: RustUpdateMember | null = null;
    while (memberNode !== undefined && !memberVisited.has(memberNode)) {
      memberVisited.add(memberNode);
      const fact = program.records.targetOperation.get(memberNode);
      if (fact?.kind === "source-accessor") { member = { kind: "accessor", expression: memberNode, fact }; break; }
      if (fact?.kind === "source-static-field") { member = { kind: "static", expression: memberNode, fact }; break; }
      if (fact?.kind === "source-index-signature") { member = { kind: "index", expression: memberNode, fact }; break; }
      if (!ast.is.IsParenthesizedExpression(memberNode)) break;
      memberNode = Node_Expression(ast, memberNode);
    }
    producer.member(node, member);
    let rootNode: Node | undefined = node;
    let root: RustLocationStorageRoot | null = null;
    const rootVisited = new Set<Node>();
    while (rootNode !== undefined && !rootVisited.has(rootNode)) {
      rootVisited.add(rootNode);
      const native = program.records.nativeArrayStorage.get(rootNode);
      if (native !== undefined) {
        if (native.kind === "element") root = { expression: rootNode, declaration: native.declaration };
        break;
      }
      if (ast.is.IsIdentifier(rootNode)) {
        const binding = program.records.sourceBinding.get(rootNode);
        const module = binding === undefined ? undefined : program.records.moduleBinding.get(binding.sourceDeclaration);
        if (binding !== undefined && (program.records.bindingStorage.get(binding.sourceDeclaration) !== undefined ||
          module?.storage === "module-cell" || module?.storage === "native-callable" && module.value !== undefined))
          root = { expression: rootNode, declaration: binding.sourceDeclaration };
        break;
      }
      if (!ast.is.IsPropertyAccessExpression(rootNode) && !ast.is.IsElementAccessExpression(rootNode) && !ast.is.IsParenthesizedExpression(rootNode)) break;
      rootNode = Node_Expression(ast, rootNode);
    }
    producer.root(node, root);
    let field: RustUpdateProjectField | null = null;
    const arguments_: RustUpdateProjectionArgument[] = [];
    const visited = new Set<Node>();
    let complete = true;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const fact = program.records.targetOperation.get(current);
      if (fact?.kind === "source-field" || fact?.kind === "source-union-field") {
        if (field === null) field = { expression: current, fact };
        if (complete) producer.projection(node, current, [...arguments_].reverse());
      }
      if (!ast.is.IsPropertyAccessExpression(current) && !ast.is.IsElementAccessExpression(current) && !ast.is.IsParenthesizedExpression(current)) break;
      if (ast.is.IsElementAccessExpression(current)) {
        const argument = ElementAccessExpression_ArgumentExpression(ast, current);
        const carrier = argument === undefined ? undefined : program.records.runtimeCarrier.get(argument)?.carrier;
        const candidate = fact?.kind === "provider-operation" && fact.abi.target.form === "index" && fact.abi.targetArguments.length === 1
          ? fact.abi.targetArguments[0] : undefined;
        if (argument === undefined || carrier === undefined) complete = false;
        else arguments_.push(Object.freeze({ projection: current, receiver: Node_Expression(ast, current), argument, carrier,
          targetInput: candidate !== undefined && isRustFinalizedSourceInput(candidate) ? candidate : undefined }));
      }
      current = Node_Expression(ast, current);
    }
    producer.field(node, field);
  }
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
    const location = analysisRecords.typedLocationPlan.get(node);
    if (location?.operation === "address-of") {
      admitPlace(location.storageExpression);
      if (program.records.referenceObjectField.get(location.storageExpression) === true) {
        const field = program.records.targetOperation.get(location.storageExpression);
        const dispatch = field?.kind === "source-field" && field.declaration !== undefined
          ? program.records.projectFieldDispatch.get(field.declaration) : undefined;
        if (field?.kind !== "source-field" || field.dispatch !== undefined && (field.dispatch.write === undefined || dispatch?.write === undefined))
          refuse(location.storageExpression, "rust.backend.projected-field-address", "RUST_MISSING_TARGET_FACT",
            "A projected native field address requires its exact physical read and write operations.");
      }
    }
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
