import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../types/model.js";
import type { RustRecordFamily } from "../program.js";
import type { RustSourceCallableSpecializationVariant } from "../callables/callable-emission.js";
import type { RustProjectMethodDispatchVariant } from "../operations/method-dispatch.js";
import type { RustSourceErrorEffectEdge } from "../errors/source-error-effects.js";
import type { RustSourceErrorRegionEmission } from "../errors/error-emission.js";

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
  /**
   * For a call whose generic arguments name type parameters of an enclosing specialized callable: the dispatch
   * variant selected for each of that callable's specializations (its type-parameter substitutions).
   */
  readonly specializedDispatch: readonly {
    readonly substitutions: ReadonlyMap<string, TargetTypeRef>;
    readonly variant: RustProjectMethodDispatchVariant;
  }[];
  readonly callable: "direct" | "generic" | "input" | "tuple" | undefined;
  readonly callableCarrier: TargetTypeRef | undefined;
  readonly eliminateInfallible: boolean;
  /** The error a callable callee physically returns, when it is a concrete callable value (not the logical carrier). */
  readonly physicalCallableError?: TargetTypeRef;
  readonly never: boolean;
  readonly errorEdge: RustSourceErrorEffectEdge | undefined;
  readonly frameError: RustSourceErrorRegionEmission | undefined;
  readonly pinnedBodies: ReadonlySet<string>;
}

export interface RustSourceCallRecords {
  readonly sourceCall: RustRecordFamily<RustSourceCallEmission>;
  readonly sourceCallSpecialization: { readonly get: (node: Node, arguments_: readonly TargetTypeRef[]) => RustSourceCallableSpecializationVariant | undefined };
}
