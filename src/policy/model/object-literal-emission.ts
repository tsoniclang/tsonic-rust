import type { RustRecordLiteralFact } from "../../target-model/records/object-literal-emission.js";

export interface RustObjectLiteralEmissionPolicyInput {
  readonly fact: RustRecordLiteralFact;
  readonly structuralDispatch: boolean;
  readonly polymorphicProject: boolean;
}
