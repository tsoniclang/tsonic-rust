import type { Node } from "@tsonic/tsts";
import type { RustModuleBindingFact } from "../../../target-model/records/operation-selections.js";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

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
  const family = createRustRecordFamily({ id: "tsonic.rust.moduleBinding", equals: (
    left: RustModuleBindingFact, right: RustModuleBindingFact,
  ) => left.declarationKind === right.declarationKind && left.storage === right.storage &&
    (left.storage === "native-callable"
      ? right.storage === "native-callable" && left.callableDeclaration === right.callableDeclaration &&
        left.name === right.name && nativeCallableValuesEqual(left.value, right.value)
      : right.storage !== "native-callable" &&
        (left.storage !== "module-cell" || right.storage === "module-cell" && left.initialization === right.initialization) &&
        rustTargetTypeRefEquals(left.valueCarrier, right.valueCarrier)) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    value(walk: RustFactWalk, declaration: Node, kind: "const" | "let" | "var", carrier: TargetTypeRef): void {
      assertOpen();
      const binding = walk.moduleBindings.classifyValue(declaration, kind, carrier);
      if (binding !== undefined) family.writer.set(declaration, binding);
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
