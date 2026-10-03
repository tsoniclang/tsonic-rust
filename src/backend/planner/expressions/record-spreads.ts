import { rustOptionElementCarrier } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { readRustStoredObjectField, readRustStructuralObjectMethodStorage } from "../objects/project-storage.js";
import { planRustBoundProjectMethodCallable } from "./properties.js";
import { planRustOptionBranch } from "./option-branch.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustObjectLiteralMethodImplementationPlan } from "../objects/object-literal-implementations.js";

type RecordFact = Extract<RustTargetOperationFact, { readonly kind: "record-literal" }>;
type Spread = Extract<RecordFact["contributions"][number], { readonly kind: "spread" }>;

export function planRustRecordSpread(
  contribution: Spread,
  planned: RustExpr,
  fields: Spread["fields"],
  methods: readonly RustObjectLiteralMethodImplementationPlan[],
  previous: ReadonlyMap<number, RustExpr>,
  context: RustPlanContext,
): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly fields: ReadonlyMap<number, RustExpr>;
  readonly methods: ReadonlyMap<string, RustExpr>;
} | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const presentCarrier = rustOptionElementCarrier(contribution.sourceCarrier);
  const optional = presentCarrier !== undefined;
  if (!rustTargetTypeRefEquals(presentCarrier ?? contribution.sourceCarrier, contribution.sourceValueCarrier) ||
    optional && methods.length !== 0) return undefined;
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const values = new Map<number, RustExpr>();
  const methodValues = new Map<string, RustExpr>();
  const spreadName = allocateRustSyntheticName(context.syntheticNames,
    fields.length === 0 && methods.length === 0 ? "_record_spread" : "record_spread");
  bindings.push({ name: spreadName, value: planned });
  const presentName = optional ? allocateRustSyntheticName(context.syntheticNames, "record_present") : spreadName;
  const receiver: RustExpr = { kind: "path", path: presentName };
  const selected: RustExpr[] = [];
  const absent: RustExpr[] = [];
  for (const field of fields) {
    const value = field.method === true
      ? contribution.sourceStorage === "structural-object"
        ? readRustStructuralObjectMethodStorage(contribution.sourceValueCarrier, receiver, field.sourceStorageIndex, context)
        : undefined
      : readRustStoredObjectField(contribution.sourceStorage, contribution.sourceValueCarrier,
          receiver, field.sourceStorageIndex, field.carrier, context);
    if (value === undefined) return undefined;
    if (optional) {
      const fallback = previous.get(field.targetStorageIndex);
      if (fallback === undefined && rustOptionElementCarrier(field.carrier) === undefined) return undefined;
      selected.push(value);
      absent.push(fallback ?? { kind: "none" });
    } else {
      const fieldName = allocateRustSyntheticName(context.syntheticNames, `record_${field.sourceName}`);
      bindings.push({ name: fieldName, value });
      values.set(field.targetStorageIndex, { kind: "path", path: fieldName });
    }
  }
  if (optional && fields.length > 0) {
    const tupleName = allocateRustSyntheticName(context.syntheticNames, "record_fields");
    bindings.push({ name: tupleName, value: planRustOptionBranch(
      { kind: "path", path: spreadName }, contribution.sourceCarrier, presentName,
      { kind: "tuple-literal", elements: selected }, { kind: "tuple-literal", elements: absent }, context,
    ) });
    fields.forEach((field, index) => values.set(field.targetStorageIndex,
      { kind: "field", receiver: { kind: "path", path: tupleName }, name: String(index) }));
  }
  for (const implementation of methods) {
    if (implementation.kind !== "spread") return undefined;
    const source = contribution.methods.find(method => method.contractDeclaration === implementation.contractMethod);
    if (source === undefined) return undefined;
    const receiverName = allocateRustSyntheticName(context.syntheticNames, "record_method_receiver");
    bindings.push({ name: receiverName, value: { kind: "method-call", receiver,
      method: "clone", args: [] } });
    const callable = planRustBoundProjectMethodCallable(implementation.contractMethod, contribution.sourceValueCarrier,
      { kind: "path", path: receiverName }, source.callableCarrier, context);
    if (callable === undefined) return undefined;
    const callableName = allocateRustSyntheticName(context.syntheticNames, "record_method");
    bindings.push({ name: callableName, value: callable });
    methodValues.set(implementation.fieldName, { kind: "path", path: callableName });
  }
  return { bindings, fields: values, methods: methodValues };
}
