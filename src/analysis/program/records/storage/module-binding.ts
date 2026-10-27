import { requireRustRecord } from "../objects/required-records.js";
import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustModuleBindingFact } from "../../../../target-model/records/operations/operation-selections.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";

type RustNativeModuleCallable = Extract<RustModuleBindingFact, { readonly storage: "native-callable" }>;

export interface RustModuleBindingProducer {
  readonly records: RustRecordFamily<RustModuleBindingFact>;
  value(walk: RustFactWalk, declaration: Node, kind: "const" | "let" | "var", carrier: TargetTypeRef): void;
  function(declaration: Node, name: string, value: Exclude<RustNativeModuleCallable["value"], undefined>): void;
  callable(declaration: Node, implementation: Node, name: string, value: RustNativeModuleCallable["value"]): void;
  defaultExport(declaration: Node, carrier: TargetTypeRef): void;
}

export function createRustModuleBindingProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustModuleBindingFact>,
): RustModuleBindingProducer {
  const corresponds = (
    left: RustModuleBindingFact, right: RustModuleBindingFact,
  ) => left.declarationKind === right.declarationKind && left.storage === right.storage &&
    (left.storage === "native-callable"
      ? right.storage === "native-callable" && left.callableDeclaration === right.callableDeclaration &&
        left.name === right.name && nativeCallableValuesEqual(left.value, right.value)
      : right.storage !== "native-callable" &&
        (left.storage !== "module-cell" || right.storage === "module-cell" && left.initialization === right.initialization) &&
        (left.storage !== "module-pattern" || right.storage === "module-pattern" &&
          left.initializer === right.initializer && left.steps.length === right.steps.length &&
          left.steps.every((step, index) => {
            const other = right.steps[index];
            return other !== undefined && step.declaration === other.declaration && step.source === other.source &&
              step.kind === other.kind && step.initializer === other.initializer;
          })) &&
        rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier));
  const family = createRustRecordFamily({ id: "tsonic.rust.moduleBinding", equals: corresponds }, assertOpen, inherited);
  const completedPolicies = new WeakMap<Node, RustFactWalk["moduleBindings"]>();
  return Object.freeze({
    records: family.reader,
    value(walk: RustFactWalk, declaration: Node, kind: "const" | "let" | "var", carrier: TargetTypeRef): void {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined && existing.storage !== "native-callable" && existing.declarationKind === kind &&
        rustTargetTypeRefEquals(existing.valueCarrier, carrier) && completedPolicies.get(declaration) === walk.moduleBindings) return;
      const binding = walk.moduleBindings.classifyValue(declaration, kind, carrier);
      if (binding === undefined) return;
      const selections: { readonly declaration: Node; readonly binding: RustModuleBindingFact }[] = [];
      if (binding.storage === "module-pattern") {
        for (const step of binding.steps) {
          if (step.kind !== "binding") continue;
          const projection = walk.context.records.bindingProjection.get(step.declaration);
          if (projection === undefined || !("bindingCarrier" in projection)) return;
          selections.push({ declaration: step.declaration, binding: Object.freeze({
            declarationKind: kind, storage: "module-cell", initialization: "value", valueCarrier: projection.bindingCarrier,
          }) });
        }
      }
      selections.push({ declaration, binding });
      for (const selection of selections) {
        const previous = family.reader.get(selection.declaration);
        if (previous !== undefined && !corresponds(previous, selection.binding)) failTargetAnalysisInvariant("tsonic-rust",
          "Conflicting Rust semantic plan 'tsonic.rust.moduleBinding' for one exact source subject.");
      }
      for (const selection of selections) {
        requireRustRecord(walk.context.requiredRecords, "moduleBinding", selection.declaration, selection.binding.storage, "moduleBindings.value");
        if (family.reader.get(selection.declaration) === undefined) family.writer.set(selection.declaration, selection.binding);
      }
      completedPolicies.set(declaration, walk.moduleBindings);
    },
    function(declaration: Node, name: string, value: Exclude<RustNativeModuleCallable["value"], undefined>): void {
      family.writer.set(declaration, { declarationKind: "function", storage: "native-callable",
        callableDeclaration: declaration, name, value });
    },
    callable(declaration: Node, implementation: Node, name: string, value: RustNativeModuleCallable["value"]): void {
      family.writer.set(declaration, { declarationKind: "const", storage: "native-callable",
        callableDeclaration: implementation, name, ...(value === undefined ? {} : { value }) });
    },
    defaultExport(declaration: Node, carrier: TargetTypeRef): void {
      family.writer.set(declaration, { declarationKind: "const", storage: "module-cell",
        initialization: "value", valueCarrier: carrier });
    },
  });
}

function nativeCallableValuesEqual(
  left: RustNativeModuleCallable["value"], right: RustNativeModuleCallable["value"],
): boolean {
  return left === undefined ? right === undefined : right !== undefined &&
    rustTargetTypeRefEquals(left.carrier, right.carrier) && left.name === right.name &&
    left.parameterCarriers.length === right.parameterCarriers.length &&
    left.parameterCarriers.every((carrier, index) => rustTargetTypeRefEquals(carrier, right.parameterCarriers[index])) &&
    rustTargetTypeRefEquals(left.resultCarrier, right.resultCarrier);
}
