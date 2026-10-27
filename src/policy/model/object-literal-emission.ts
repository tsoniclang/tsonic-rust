import type { RustRecordLiteralFact } from "../../target-model/records/objects/object-literal-emission.js";

export interface RustObjectLiteralEmissionPolicyInput {
  readonly fact: RustRecordLiteralFact;
  readonly structuralImplementation: boolean;
  readonly polymorphicProject: boolean;
}
