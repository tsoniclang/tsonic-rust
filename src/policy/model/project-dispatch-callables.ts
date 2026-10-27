import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceCallEffectsFact } from "../../target-model/records/objects/object-methods.js";

export interface RustProjectCallablePolicyInput {
  readonly typeParameters: readonly (string | undefined)[];
  readonly result: TargetTypeRef;
  readonly error: TargetTypeRef | undefined;
  readonly effects: RustSourceCallEffectsFact;
  readonly generator: boolean;
  readonly asynchronous: "native-future" | "js-promise" | undefined;
  readonly authoredAsync: boolean;
  readonly safety: Readonly<Record<"declaration" | "getter" | "setter", boolean>>;
}
