import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustIndexedRecordStorage } from "../../target-model/records/objects/indexed-records.js";
import type { RustObjectRepresentation } from "../../target-model/records/objects/object-representation.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";

export interface RustIndexedRecordPolicyInput {
  readonly carrier: TargetTypeRef;
  readonly key: TargetTypeRef;
  readonly value: TargetTypeRef;
  readonly storage: RustIndexedRecordStorage;
  readonly definition: RustProjectTypeDefinition | undefined;
  readonly representation: RustObjectRepresentation | undefined;
  readonly polymorphic: boolean;
}
