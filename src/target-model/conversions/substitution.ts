import type { RustTargetConstArgument, TargetTypeRef } from "../types/model.js";
import type { RustLifetimeRef } from "../lifetimes/index.js";
import type { RustValueConversion } from "../operations/model.js";
import { substituteRustTargetGenerics } from "../types/carriers/substitution.js";

export function substituteRustValueConversion(
  value: RustValueConversion,
  substitutions: ReadonlyMap<string, TargetTypeRef>,
  lifetimeSubstitutions: ReadonlyMap<string, RustLifetimeRef> = new Map(),
  constSubstitutions: ReadonlyMap<string, RustTargetConstArgument> = new Map(),
): RustValueConversion {
  switch (value.kind) {
    case "rest-sequence":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(value.source, substitutions, lifetimeSubstitutions, constSubstitutions),
        elementTarget: substituteRustTargetGenerics(value.elementTarget, substitutions, lifetimeSubstitutions, constSubstitutions),
        elementConversions: value.elementConversions.map(conversion => conversion === null ? null :
          substituteRustValueConversion(conversion, substitutions, lifetimeSubstitutions, constSubstitutions)) as typeof value.elementConversions,
      });
    case "copy-from-reference":
      return Object.freeze({
        ...value,
        target: substituteRustTargetGenerics(
          value.target,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "raw-pointer-mut-to-const":
      return Object.freeze({
        ...value,
        pointee: substituteRustTargetGenerics(
          value.pointee,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "union-map":
      return Object.freeze({ ...value,
        source: substituteRustTargetGenerics(value.source, substitutions, lifetimeSubstitutions, constSubstitutions),
        target: substituteRustTargetGenerics(value.target, substitutions, lifetimeSubstitutions, constSubstitutions),
        arms: Object.freeze(value.arms.map(arm => Object.freeze({ ...arm,
          carrier: substituteRustTargetGenerics(arm.carrier, substitutions, lifetimeSubstitutions, constSubstitutions),
          source: Object.freeze(arm.source.map(step => Object.freeze({ ...step,
            union: substituteRustTargetGenerics(step.union, substitutions, lifetimeSubstitutions, constSubstitutions) }))),
          target: Object.freeze(arm.target.map(step => Object.freeze({ ...step,
            union: substituteRustTargetGenerics(step.union, substitutions, lifetimeSubstitutions, constSubstitutions) }))),
        }))),
      });
    case "source-union-variant":
    case "union-project":
    case "exact-integer":
    case "native-representation":
    case "native-upcast":
    case "bottom-coercion":
    case "js-argument-vector-callback":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        target: substituteRustTargetGenerics(
          value.target,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "js-array-backing":
      return Object.freeze({ ...value,
        source: substituteRustTargetGenerics(value.source, substitutions, lifetimeSubstitutions, constSubstitutions),
        element: substituteRustTargetGenerics(value.element, substitutions, lifetimeSubstitutions, constSubstitutions),
      });
    case "closed-value-from-option":
    case "js-value-from-array":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        element: substituteRustTargetGenerics(
          value.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        elementConversion: substituteRustValueConversion(
          value.elementConversion,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ) as typeof value.elementConversion,
      });
    case "js-value-from-closed-carrier":
    case "ts-value-from-closed-carrier":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "union-fold":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        target: substituteRustTargetGenerics(value.target, substitutions, lifetimeSubstitutions, constSubstitutions),
        arms: Object.freeze(value.arms.map((arm) => Object.freeze({
          ...arm,
          carrier: substituteRustTargetGenerics(
            arm.carrier,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ),
          path: Object.freeze(arm.path.map(step => Object.freeze({ ...step,
            union: substituteRustTargetGenerics(step.union, substitutions, lifetimeSubstitutions, constSubstitutions),
          }))),
          conversion: substituteRustValueConversion(
            arm.conversion,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ) as typeof arm.conversion,
        }))),
      });
    case "js-value-from-structural-to-json":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        resultCarrier: substituteRustTargetGenerics(
          value.resultCarrier,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        resultConversion: substituteRustValueConversion(
          value.resultConversion,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ) as typeof value.resultConversion,
      });
    case "js-value-from-structural-object":
      return Object.freeze({
        ...value,
        source: substituteRustTargetGenerics(
          value.source,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
        fields: Object.freeze(value.fields.map((field) => Object.freeze({
          ...field,
          sourceCarrier: substituteRustTargetGenerics(
            field.sourceCarrier,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ),
          conversion: substituteRustValueConversion(
            field.conversion,
            substitutions,
            lifetimeSubstitutions,
            constSubstitutions,
          ) as typeof field.conversion,
        }))),
      });
    case "option-some":
      return Object.freeze({ ...value,
        source: substituteRustTargetGenerics(value.source, substitutions, lifetimeSubstitutions, constSubstitutions),
        element: substituteRustTargetGenerics(value.element, substitutions, lifetimeSubstitutions, constSubstitutions),
      });
    case "source-optional":
      return Object.freeze({
        ...value,
        element: substituteRustTargetGenerics(
          value.element,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ),
      });
    case "option-map":
      return Object.freeze({
        ...value,
        elementConversion: substituteRustValueConversion(
          value.elementConversion,
          substitutions,
          lifetimeSubstitutions,
          constSubstitutions,
        ) as typeof value.elementConversion,
      });
    case "semantic-conversion":
    case "numeric-promotion":
    case "integer-refinement":
      return value;
  }
}
