import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../types/model.js";
import type { RustRecordFamily } from "./program.js";
import type { RustSourceCallableSpecializationVariant } from "./callable-emission.js";
import type { RustProjectMethodDispatchVariant } from "./method-dispatch.js";
import type { RustSourceErrorEffectEdge } from "./source-error-effects.js";

export interface RustSourceCallEmission {
  readonly declaration: Node | undefined;
  readonly lexical: boolean;
  readonly lexicalParameters: readonly Extract<TargetTypeRef, { readonly kind: "type-parameter" }>[];
  readonly optionalStorage: boolean;
  readonly witnesses: readonly (TargetTypeRef | undefined)[];
  readonly specialized: boolean;
  readonly constructor: { readonly name: string } | undefined;
  readonly constructorOwner: Node | undefined;
  readonly dispatch: RustProjectMethodDispatchVariant | undefined;
  readonly callable: "direct" | "generic" | "input" | "tuple" | undefined;
  readonly callableCarrier: TargetTypeRef | undefined;
  readonly eliminateInfallible: boolean;
  readonly never: boolean;
  readonly errorEdge: RustSourceErrorEffectEdge | undefined;
  readonly pinnedBodies: ReadonlySet<string>;
}

export interface RustSourceCallRecords {
  readonly sourceCall: RustRecordFamily<RustSourceCallEmission>;
  readonly sourceCallSpecialization: { readonly get: (node: Node, arguments_: readonly TargetTypeRef[]) => RustSourceCallableSpecializationVariant | undefined };
}
