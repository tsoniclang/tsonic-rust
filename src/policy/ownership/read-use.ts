import type { RustReadUse } from "../../target-model/records/storage/ownership.js";
import type { ArgumentPassingMode, AstReader, Node } from "@tsonic/tsts";
import { BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, Node_Expression, Node_Operand } from "@tsonic/target-api/source";
import type { RustTargetOperationFact, RustTypedLocationPlan } from "../../target-model/records/operations/operations.js";
import type { RustRawAddressPlan } from "../../target-model/records/storage/raw-addresses.js";
import type { RustFinalizedSourceInput } from "../../target-model/records/operations/finalized-operation.js";
import type { RustComputedMemberFact } from "../../target-model/records/operations/operation-selections.js";

export function selectRustOperationReadUses(ast: AstReader, node: Node, input: {
  readonly operation: RustTargetOperationFact | undefined;
  readonly computedMember: RustComputedMemberFact | undefined;
  readonly arguments: readonly (Node | undefined)[] | undefined;
  readonly nativeInputs: readonly { readonly source: RustFinalizedSourceInput["source"]; readonly mode: "ref" | "mut-ref" | undefined }[];
  readonly argumentModes: readonly (ArgumentPassingMode | undefined)[];
  readonly address: RustRawAddressPlan | undefined;
  readonly location: RustTypedLocationPlan | undefined;
  readonly guard: Node | undefined;
  readonly callableMode: RustReadUse["mode"] | undefined;
  readonly structuralReceiverMode: "value" | "shared";
}): ReadonlyMap<Node, RustReadUse> {
  const uses = new Map<Node, RustReadUse>();
  const select = (subject: Node | undefined, mode: RustReadUse["mode"], later: readonly Node[] = [],
    laterStart = 0, stableAcrossEffects = false): void => {
    if (subject !== undefined) uses.set(subject, Object.freeze({ mode, later, laterStart, stableAcrossEffects }));
  };
  const operation = input.operation;
  const source = operation?.kind === "runtime-set" ? BinaryExpression_Left(ast, node) : node;
  const callee = source === undefined ? undefined : Node_Expression(ast, source);
  const receiver = source !== undefined && ast.is.IsCallExpression(source) ? callee === undefined ? undefined : Node_Expression(ast, callee) : callee;
  const argumentsList = Object.freeze((input.arguments ?? []).filter((value): value is Node => value !== undefined));
  if (operation?.kind === "provider-operation" || operation?.kind === "runtime-set") {
    if (operation.abi.sourceReceiver.kind === "receiver" && operation.abi.sourceReceiver.disposition === "evaluation-only") {
      select(receiver, "shared");
    }
    for (const argument of operation.abi.sourceArguments) {
      if (argument.disposition === "evaluation-only") select(input.arguments?.[argument.sourceIndex], "shared");
    }
  }
  if (operation?.kind === "provider-operation") {
    const modes = new Map<number, Set<"ref" | "mut-ref" | undefined>>();
    for (const selected of input.nativeInputs) {
      const index = selected.source.kind === "argument" ? selected.source.sourceIndex
        : selected.source.kind === "receiver" ? -1 : undefined;
      if (index === undefined) continue;
      const selectedModes = modes.get(index) ?? new Set();
      selectedModes.add(selected.mode);
      modes.set(index, selectedModes);
    }
    for (const [index, selectedModes] of modes) {
      const subject = index === -1 ? receiver : input.arguments?.[index];
      if (selectedModes.size === 1 && selectedModes.has("ref")) select(subject, "shared", argumentsList, index + 1, true);
      else if (selectedModes.size === 1 && selectedModes.has("mut-ref")) select(subject, "mutable", argumentsList, index + 1);
    }
  } else if (operation?.kind === "source-call") {
    for (let index = 0; index < argumentsList.length; index += 1) {
      const mode = input.argumentModes[index];
      if (mode === "borrow-shared") select(argumentsList[index], "shared", argumentsList, index + 1, true);
      else if (mode === "borrow-mut") select(argumentsList[index], "mutable", argumentsList, index + 1);
    }
    if (operation.target.form === "method") select(receiver, operation.target.mutatesSelf ? "mutable" : "shared",
      argumentsList, 0, !operation.target.mutatesSelf);
    else if (operation.target.form === "union-method") {
      const mutable = operation.target.variants.some(variant => variant.mutatesSelf);
      select(receiver, mutable ? "mutable" : "shared", argumentsList, 0, !mutable);
    } else if (operation.target.form === "structural-method")
      select(receiver, input.structuralReceiverMode, argumentsList, 0, input.structuralReceiverMode === "shared");
    else if (operation.target.form === "callable" && input.callableMode !== undefined) {
      select(callee, input.callableMode, argumentsList, 0, input.callableMode === "shared");
    }
  } else if (operation?.kind === "reference-operation") {
    select(operation.operandExpression, operation.operation === "mutable-reference" || operation.operation === "store" ? "mutable" : "shared");
  } else if (operation?.kind === "flow-marker") {
    select(ast.arguments(node)[0], operation.state === "moved" ? "move" : operation.state === "borrowed-mut" ? "mutable" : "shared");
  } else if (operation?.kind === "project-type-test" || operation?.kind === "closed-type-test") {
    select(BinaryExpression_Left(ast, node), "shared");
  } else if (operation?.kind === "void-expression" || operation?.kind === "typeof") {
    select(Node_Expression(ast, node), "shared");
  } else if (operation?.kind === "option-check") {
    // An Option presence test (is_some / is_none / is_absent) only borrows its Option operand.
    select(operation.optionOperand === "left" ? BinaryExpression_Left(ast, node) : BinaryExpression_Right(ast, node), "shared");
  } else if (operation?.kind === "option-equality" || operation?.kind === "union-equality" ||
    operation?.kind === "string-concat") {
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    select(left, "shared", right === undefined ? [] : [right]);
    select(right, "shared");
  } else if (operation?.kind === "operator-token" || operation?.kind === "operator-call") {
    const binary = ast.is.IsBinaryExpression(node);
    const left = binary ? BinaryExpression_Left(ast, node) : Node_Operand(ast, node);
    const right = binary ? BinaryExpression_Right(ast, node) : undefined;
    select(left, operation.operandModes[0] === "ref" ? "shared"
      : operation.operandModes[0] === "mut-ref" ? "mutable" : "value", right === undefined ? [] : [right]);
    const rightMode = operation.operandModes[1];
    if (rightMode !== undefined) select(right, rightMode === "ref" ? "shared" : rightMode === "mut-ref" ? "mutable" : "value");
  } else if (operation?.kind === "source-indexed-field") {
    const key = ElementAccessExpression_ArgumentExpression(ast, node);
    select(receiver, "shared", key === undefined ? [] : [key], 0, true);
    select(key, "shared");
  } else if (operation?.kind === "source-field" || operation?.kind === "builtin-error-property") select(receiver, "shared");
  for (const argument of input.address?.arguments ?? []) {
    if (argument.input === "raw-ref" || argument.input === "raw-owner-ref") select(argument.expression, "shared");
  }
  if (input.location !== undefined && "pointerExpression" in input.location) select(input.location.pointerExpression, "shared");
  if (input.location?.operation === "equal-pointer") {
    select(input.location.leftExpression, "shared", [input.location.rightExpression]);
    select(input.location.rightExpression, "shared");
  }
  if (input.computedMember?.evaluateKey) {
    const { receiver, key } = input.computedMember;
    select(key, "shared");
    const use = uses.get(receiver);
    if (use !== undefined && !use.later.slice(use.laterStart).includes(key))
      select(receiver, use.mode, [key, ...use.later.slice(use.laterStart)], 0, use.stableAcrossEffects);
  }
  select(input.guard, "shared");
  return uses;
}
