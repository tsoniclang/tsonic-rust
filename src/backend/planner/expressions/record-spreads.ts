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
import { rustValueBlock, type RustValueBlockEntry } from "../../target-ast/value-block.js";
import { rustRecordSpreadReadIsObservable } from "../objects/record-contributions.js";

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
  readonly bindings: readonly RustValueBlockEntry[];
  readonly fields: ReadonlyMap<number, RustExpr>;
  readonly methods: ReadonlyMap<string, RustExpr>;
} | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const presentCarrier = rustOptionElementCarrier(contribution.sourceCarrier);
  const optional = presentCarrier !== undefined;
  if (!rustTargetTypeRefEquals(presentCarrier ?? contribution.sourceCarrier, contribution.sourceValueCarrier) ||
    optional && methods.length !== 0) return undefined;
  const bindings: RustValueBlockEntry[] = [];
  const values = new Map<number, RustExpr>();
  const methodValues = new Map<string, RustExpr>();
  const spreadName = allocateRustSyntheticName(context.syntheticNames,
    fields.length === 0 && methods.length === 0 ? "_record_spread" : "record_spread");
  bindings.push({ name: spreadName, value: planned });
  const presentName = optional ? allocateRustSyntheticName(context.syntheticNames, "record_present") : spreadName;
  const receiver: RustExpr = { kind: "path", path: presentName };
  const selected: RustExpr[] = [];
  const absent: RustExpr[] = [];
  const presentBindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const retained = new Set(fields.map(field => field.targetStorageIndex));
  for (const field of contribution.fields) {
    const keep = retained.has(field.targetStorageIndex);
    if (!keep && !rustRecordSpreadReadIsObservable(contribution, field, context.input.program.structuralShapes)) continue;
    const value = field.method === true
      ? contribution.sourceStorage === "structural-object"
        ? readRustStructuralObjectMethodStorage(contribution.sourceValueCarrier, receiver, field.sourceStorageIndex, context)
        : undefined
      : readRustStoredObjectField(contribution.sourceStorage, contribution.sourceValueCarrier,
          receiver, field.sourceStorageIndex, field.carrier, context);
    if (value === undefined) return undefined;
    const fieldName = allocateRustSyntheticName(context.syntheticNames, `${keep ? "record" : "_record"}_${field.sourceName}`);
    if (optional) {
      presentBindings.push({ name: fieldName, value });
      if (!keep) continue;
      const fallback = previous.get(field.targetStorageIndex);
      if (fallback === undefined && rustOptionElementCarrier(field.carrier) === undefined) return undefined;
      selected.push({ kind: "path", path: fieldName });
      absent.push(fallback ?? { kind: "none" });
    } else {
      bindings.push({ name: fieldName, value });
      if (keep) values.set(field.targetStorageIndex, { kind: "path", path: fieldName });
    }
  }
  if (optional && presentBindings.length > 0) {
    const tupleName = fields.length === 0 ? undefined : allocateRustSyntheticName(context.syntheticNames, "record_fields");
    const value = planRustOptionBranch(
      { kind: "path", path: spreadName }, contribution.sourceCarrier, presentName,
      rustValueBlock(presentBindings, { kind: "tuple-literal", elements: selected }),
      { kind: "tuple-literal", elements: absent }, context,
    );
    bindings.push(tupleName === undefined ? { value } : { name: tupleName, value });
    if (tupleName !== undefined) fields.forEach((field, index) => values.set(field.targetStorageIndex,
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
