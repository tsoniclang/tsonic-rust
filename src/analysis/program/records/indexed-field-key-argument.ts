import type { Node } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustSelectedTargetSignature, TargetTypeRef } from "../../../target-model/types/model.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { createRustRecordFamily } from "./family.js";
import { requireRustRecord, type RustRequiredRecord } from "./required-records.js";

type RustIndexedFieldKeyArgument = Exclude<ReturnType<RustProgramRecords["indexedFieldKeyArgument"]["get"]>, undefined>;

export interface RustIndexedFieldKeyArgumentProducer {
  readonly records: RustProgramRecords["indexedFieldKeyArgument"];
  bind(requiredRecords: RustRequiredRecord[], selected: RustSelectedTargetSignature, arguments_: readonly Node[], keys: ReadonlyMap<string, TargetTypeRef>,
    evaluate: (argument: Node) => boolean): boolean;
}

export function createRustIndexedFieldKeyArgumentProducer(
  assertOpen: () => void,
  inherited?: RustProgramRecords["indexedFieldKeyArgument"],
): RustIndexedFieldKeyArgumentProducer {
  const family = createRustRecordFamily<RustIndexedFieldKeyArgument>({
    id: "tsonic.rust.indexedFieldKeyArgument", equals: closedMetadataEquals,
  }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    bind(requiredRecords: RustRequiredRecord[], selected: RustSelectedTargetSignature, arguments_: readonly Node[], keys: ReadonlyMap<string, TargetTypeRef>,
      evaluate: (argument: Node) => boolean): boolean {
      assertOpen();
      for (const binding of selected.sourceArgumentBindings ?? []) {
        const parameter = selected.member.parameters[binding.sourceParameterIndex];
        const argument = arguments_[binding.sourceArgumentIndex];
        const type = parameter?.type;
        const carrier = type?.kind === "type-parameter" ? keys.get(type.identity) : undefined;
        if (carrier === undefined || carrier.kind === "type-parameter") continue;
        if (argument === undefined || binding.sourceForm !== "value") return false;
        requireRustRecord(requiredRecords, "indexedFieldKeyArgument", argument, "concrete indexed key", "indexedFieldKeys.bind");
        family.writer.set(argument, { carrier, evaluate: evaluate(argument) });
      }
      return true;
    },
  });
}
