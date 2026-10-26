import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustLocalBindingCompletion } from "../../../target-model/records/local-bindings.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { collectVariableDeclarations } from "../statements/resource-management.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import { planRustBindingPattern } from "./binding-patterns.js";
import { planRustLocalBindingStorage } from "./local-storage.js";
import { planRustBorrowedInitializer } from "./borrowed-initializers.js";
import { nativeRustArrayType } from "../expressions/native-arrays.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustValueDestinationContext } from "../expressions/value-destinations.js";
import { planNativeModuleFunction } from "../declarations/callables/functions.js";
import { rustBindingLivenessAttributes } from "./liveness.js";

export function planVariableStatement(node: Node, context: RustPlanContext): readonly RustStmt[] {
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length === 0) failRustPlannerInvariant("An admitted variable statement requires its declaration sequence.", node);
  return declarations.flatMap(declaration => context.input.program.records.completionBindingOwner.get(declaration) === undefined
    ? planVariableDeclaration(declaration, context) : []);
}

function planVariableDeclaration(declaration: Node, context: RustPlanContext): readonly RustStmt[] {
  const binding = context.input.program.records.localBinding.get(declaration);
  if (binding === undefined) failRustPlannerInvariant("An admitted local requires its sealed native binding completion.", declaration);
  if (binding.kind === "erased") return [];
  if (binding.kind === "pattern") return planBindingVariableDeclaration(declaration, binding, context);
  if (binding.kind === "function") {
    const planned = planNativeModuleFunction(declaration, binding.initializer, binding.name, context, undefined);
    return [{ kind: "item", item: planned.item }, ...(planned.helper === undefined ? [] : [{ kind: "item" as const, item: planned.helper }])];
  }
  const initializerContext = binding.initializer === undefined ? context
    : rustValueDestinationContext(binding.initializer, binding.initializerCarrier, context);
  const initializer = binding.initializer === undefined ? undefined : planRustBorrowedInitializer(binding.initializer, initializerContext);
  if (binding.initializer !== undefined && initializer?.value === undefined)
    failRustPlannerInvariant("An admitted local requires its native initializer value plan.", binding.initializer);
  const value: RustExpr | undefined = binding.absenceInitializer ? { kind: "none" } : initializer?.value;
  if (value === undefined && binding.storage !== undefined)
    failRustPlannerInvariant("An admitted promoted local requires its native initializer plan.", declaration);
  let type: RustType | undefined = rustTypeFromCarrierInContext(binding.nativeCarrier, context);
  if (type === undefined && (binding.initializer === undefined || binding.annotated))
    failRustPlannerInvariant("An admitted local requires its native type rendering.", declaration);
  if (context.input.program.records.nativeArrayStorage.get(declaration) !== undefined) {
    type = nativeRustArrayType(declaration, context);
    if (type === undefined) failRustPlannerInvariant("An admitted native array local requires its storage type rendering.", declaration);
  }
  const storage = planRustLocalBindingStorage(declaration, binding.name, binding.carrier, type, value, binding.storage, context);
  if (storage === undefined) failRustPlannerInvariant("An admitted local requires its selected native storage plan.", declaration);
  if (storage.kind === "store") return [...initializer?.statements ?? [], storage.statement];
  if (binding.initializer !== undefined && storage.value === undefined)
    failRustPlannerInvariant("An admitted local requires its stored native initializer.", declaration);
  return [...initializer?.statements ?? [], { kind: "let", name: binding.name, mutable: binding.mutable,
    attrs: rustBindingLivenessAttributes(declaration, binding.mutable && storage.value !== undefined, context),
    ...(storage.type === undefined || binding.selfTypedInitializer ? {} : { type: storage.type }),
    ...(storage.value === undefined ? {} : { init: storage.value }) }];
}

function planBindingVariableDeclaration(
  declaration: Node, binding: Extract<RustLocalBindingCompletion, { readonly kind: "pattern" }>, context: RustPlanContext,
): readonly RustStmt[] {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted binding pattern requires its native name scope.", declaration);
  const value = planExpression(binding.initializer, context);
  if (value === undefined) failRustPlannerInvariant("An admitted binding pattern requires its native initializer plan.", binding.initializer);
  const temporary = allocateRustSyntheticName(context.syntheticNames, "binding");
  const bindings = planRustBindingPattern(binding.pattern, { kind: "path", path: temporary }, binding.carrier, context, planExpression);
  if (bindings === undefined) failRustPlannerInvariant("An admitted binding pattern requires its native destination bindings.", binding.pattern);
  return [{ kind: "let", name: temporary, mutable: false, init: value }, ...bindings];
}
