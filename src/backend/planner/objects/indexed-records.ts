import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustIndexedRecordStorage } from "../../../target-model/types/carriers/records.js";
import { rustRecordCarrierValue, rustRecordReadAdmitsAbsence } from "../../../target-model/types/carriers/records.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustStringCarrier } from "../../../target-model/types/index.js";
import type { Node } from "@tsonic/tsts";
import { ElementAccessExpression_ArgumentExpression, Node_Expression } from "@tsonic/target-api/source";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import { expressionCarrier, requireExpressionCarrier, selectedOperationMatches } from "../expressions/fundamentals.js";
import { effectiveMemberResultCarrier } from "../expressions/special.js";
import type { planExpression as planRustExpression } from "../expressions/entry.js";
import { planRustSharedReceiver } from "../expressions/typed-locations.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectStateType } from "./polymorphism/names.js";
import { rustProjectObjectRepresentation } from "./project-storage.js";
import { createRustProjectObject, copyRustProjectObjectIndexStorage, readRustProjectObjectIndex, writeRustProjectObjectIndex } from "./project-objects.js";

type SourceIndexFact = Extract<RustTargetOperationFact, { readonly kind: "source-index-signature" }>;
type ExpressionPlanner = typeof planRustExpression;

export function sourceIndexSelectedOperationMatches(node: Node, fact: SourceIndexFact, context: RustPlanContext): boolean {
  const property = context.input.program.source.ast.is.IsPropertyAccessExpression(node);
  return selectedOperationMatches(property
    ? context.input.program.facts.getSelectedTargetProperty(node)
    : context.input.program.facts.getSelectedTargetElementAccess(node), fact.operationId, "indexer", fact.resultCarrier);
}

export function planRustSourceIndexKey(
  node: Node, fact: SourceIndexFact, context: RustPlanContext, planExpression: ExpressionPlanner, borrowed: boolean,
): RustExpr | undefined {
  const ast = context.input.program.source.ast;
  if (ast.is.IsPropertyAccessExpression(node)) {
    const name = ast.name(node);
    if (name === undefined || !ast.is.IsIdentifier(name) || !isRustStringCarrier(fact.keyCarrier)) return undefined;
    return { kind: borrowed ? "str-literal" : "string-literal", value: ast.text(name) };
  }
  const keyNode = ElementAccessExpression_ArgumentExpression(ast, node);
  if (keyNode === undefined || !rustTargetTypeRefEquals(expressionCarrier(keyNode, context), fact.keyCarrier)) return undefined;
  return planExpression(keyNode, context, "value", borrowed ? "shared-reference" : "value");
}

export function planRustSourceIndexRead(
  node: Node, fact: SourceIndexFact, context: RustPlanContext, planExpression: ExpressionPlanner,
): RustExpr | undefined {
  const resultCarrier = effectiveMemberResultCarrier(node, fact.resultCarrier, context);
  if (resultCarrier === undefined || !requireExpressionCarrier(node, resultCarrier, context, "rust.backend.project-index-carrier") ||
    !sourceIndexSelectedOperationMatches(node, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.project-index-selected-evidence",
      "Project index access conflicts with the exact checked index-signature fact."));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, node);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const key = planRustSourceIndexKey(node, fact, context, planExpression, true);
  const storage = planRustIndexedRecordStorage(fact.receiverCarrier, fact.keyCarrier, fact.resultCarrier, fact.storage, context);
  if (receiverNode === undefined || receiver === undefined || key === undefined || storage === undefined ||
    context.syntheticNames === undefined) return undefined;
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "index_receiver");
  const keyName = allocateRustSyntheticName(context.syntheticNames, "index_key");
  return { kind: "block", bindings: [
    { name: receiverName, value: planRustSharedReceiver(receiverNode, receiver, context) },
    { name: keyName, value: key },
  ], value: storage.read({ kind: "path", path: receiverName }, { kind: "path", path: keyName }) };
}

export function planRustIndexedRecordStorage(
  carrier: TargetTypeRef,
  key: TargetTypeRef,
  value: TargetTypeRef,
  storage: RustIndexedRecordStorage,
  context: RustPlanContext,
) {
  if (storage.kind === "record") {
    const record = rustRecordCarrierValue(carrier);
    const type = rustTypeFromCarrierInContext(carrier, context);
    if (record === undefined || type === undefined ||
      !rustTargetTypeRefEquals(record.key, key) || !rustTargetTypeRefEquals(record.value, value)) return undefined;
    context.usedAliases?.add("rt");
    return {
      read(receiver: RustExpr, index: RustExpr): RustExpr {
        return { kind: "method-call", receiver,
          method: rustRecordReadAdmitsAbsence(value) ? "get_or_default" : "get",
          args: [index] };
      },
      write(receiver: RustExpr, index: RustExpr, item: RustExpr): RustExpr {
        return { kind: "method-call", receiver, method: "set", args: [index, item] };
      },
      copyEntries(receiver: RustExpr, destination: RustExpr): RustExpr {
        return { kind: "method-call", receiver, method: "copy_entries_to",
          args: [{ kind: "reference", mutable: true, expr: destination }] };
      },
      construct(entries: RustExpr): RustExpr {
        return { kind: "associated-call", owner: type, method: "from_map", args: [entries] };
      },
    };
  }
  const definition = context.input.program.projectTypes.definitionForCarrier(carrier);
  const representation = rustProjectObjectRepresentation(carrier, context);
  const wrapper = rustTypeFromCarrierInContext(carrier, context);
  const state = rustProjectStateType(carrier, context);
  if (definition?.kind !== "interface" || representation === undefined ||
    context.input.program.projectTypes.isPolymorphic(definition) || wrapper?.kind !== "named" || state?.kind !== "named") return undefined;
  return {
    read(receiver: RustExpr, index: RustExpr): RustExpr {
      return readRustProjectObjectIndex(receiver, storage.name, index, value, representation);
    },
    write(receiver: RustExpr, index: RustExpr, item: RustExpr): RustExpr | undefined {
      return writeRustProjectObjectIndex(receiver, storage.name, index, item, representation);
    },
    copyEntries(receiver: RustExpr, destination: RustExpr): RustExpr {
      context.usedAliases?.add("rt");
      return copyRustProjectObjectIndexStorage(receiver, storage.name, destination, representation);
    },
    construct(entries: RustExpr): RustExpr {
      return createRustProjectObject(wrapper.path, state.path, [{ name: storage.name, value: entries }], representation);
    },
  };
}
