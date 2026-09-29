import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustIndexedRecordStorage } from "../../../target-model/types/carriers/records.js";
import { rustRecordCarrierValue } from "../../../target-model/types/carriers/records.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { isRustJsValueCarrier, rustOptionElementCarrier } from "../../../target-model/types/index.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustProjectStateType } from "./polymorphism/names.js";
import { rustProjectObjectRepresentation } from "./project-storage.js";
import { createRustProjectObject, copyRustProjectObjectIndexStorage, readRustProjectObjectIndex, writeRustProjectObjectIndex } from "./project-objects.js";

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
          method: rustOptionElementCarrier(value) !== undefined || isRustJsValueCarrier(value) ? "get_or_default" : "get",
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
