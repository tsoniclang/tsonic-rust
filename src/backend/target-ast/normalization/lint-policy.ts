import type { RustAttribute } from "../attributes.js";
import type { RustGenerics } from "../nodes.js";

function lint(
  level: Extract<RustAttribute, { readonly kind: "lint" }>["level"],
  name: string,
  reason: string,
): RustAttribute {
  return Object.freeze({ kind: "lint", level, lint: name, reason });
}

export const rustLintAttributes = Object.freeze({
  blocksInConditions: lint("expect", "clippy::blocks_in_conditions", "checked evaluation region"),
  collapsibleIf: lint("expect", "clippy::collapsible_if", "checked lexical regions"),
  deadCode: lint("allow", "dead_code", "preserves the checked source contract"),
  inherentToString: lint("expect", "clippy::inherent_to_string", "authored toString contract"),
  missingSafetyDoc: lint("allow", "clippy::missing_safety_doc", "explicit source safety contract"),
  needlessLifetimes: lint("allow", "clippy::needless_lifetimes", "preserves the explicit source lifetime contract"),
  neverLoop: lint("expect", "clippy::never_loop", "authored iterator protocol"),
  newReturningOtherType: lint("allow", "clippy::new_ret_no_self", "authored static member name"),
  nonCamelCaseType: lint("allow", "non_camel_case_types", "preserves an exact target type identity"),
  nonUpperCaseGlobal: lint("allow", "non_upper_case_globals", "preserves the authored module export name"),
  pointerDerefOutsideUnsafeFunction: lint("allow", "clippy::not_unsafe_ptr_arg_deref", "explicit unsafe region"),
  shouldImplementTrait: lint("expect", "clippy::should_implement_trait", "authored method contract"),
  tooManyArguments: lint("expect", "clippy::too_many_arguments", "checked source signature"),
  unusedAssignments: lint("expect", "unused_assignments", "checked source evaluation order"),
  unusedAssignmentsInner: lint("expect", "unused_assignments", "checked source evaluation order"),
  unusedVariables: lint("expect", "unused_variables", "authored binding drop scope"),
  unobservedParameterAssignment: lint("allow", "unused_assignments", "preserves an authored by-value mutation"),
  unobservedParameterVariable: lint("allow", "unused_variables", "preserves an authored by-value mutation"),
  unusedUnsafe: lint("allow", "unused_unsafe", "explicit source unsafe region"),
});

export function rustExplicitLifetimeContractAttributes(
  generics: RustGenerics,
): readonly RustAttribute[] {
  return generics.parameters.some((parameter) => parameter.kind === "lifetime")
    ? Object.freeze([rustLintAttributes.needlessLifetimes])
    : Object.freeze([]);
}
