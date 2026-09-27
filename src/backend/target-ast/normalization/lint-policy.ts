import { rustListAttribute, rustWordAttribute, rustValueAttribute } from "../attributes.js";
export const rustLintAttributes = Object.freeze({
  blocksInConditions:
    rustListAttribute("expect", [rustWordAttribute("clippy::blocks_in_conditions"), rustValueAttribute("reason", { kind: "string", value: "checked evaluation region" })]),
  matchTemporaryScope:
    rustListAttribute("expect", [rustWordAttribute("clippy::blocks_in_conditions"), rustValueAttribute("reason", { kind: "string", value: "Rust 2021 match temporary scope" })]),
  collapsibleIf:
    rustListAttribute("expect", [rustWordAttribute("clippy::collapsible_if"), rustValueAttribute("reason", { kind: "string", value: "checked lexical regions" })]),
  fieldReassignWithDefault:
    rustListAttribute("expect", [rustWordAttribute("clippy::field_reassign_with_default"), rustValueAttribute("reason", { kind: "string", value: "checked source assignment order" })]),
  authoredDeadCode:
    rustListAttribute("allow", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unused authored declaration" })]),
  authoredUnreadField:
    rustListAttribute("allow", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unread authored field" })]),
  authoredUnusedVariant:
    rustListAttribute("allow", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unused authored variant" })]),
  generatedEnumDiscriminant:
    rustListAttribute("allow", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "stores an authored enum discriminant" })]),
  generatedRetainedConstructor:
    rustListAttribute("allow", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unused generated constructor" })]),
  generatedUnconstructedInstance:
    rustListAttribute("expect", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unconstructed generated instance" })]),
  generatedUnconstructedShape:
    rustListAttribute("expect", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unconstructed checked source shape" })]),
  generatedUnusedDispatch:
    rustListAttribute("expect", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains an unused generated dispatch slot" })]),
  generatedUnusedStorage:
    rustListAttribute("expect", [rustWordAttribute("dead_code"), rustValueAttribute("reason", { kind: "string", value: "retains unused generated storage" })]),
  inherentToString:
    rustListAttribute("expect", [rustWordAttribute("clippy::inherent_to_string"), rustValueAttribute("reason", { kind: "string", value: "authored toString contract" })]),
  missingSafetyDoc:
    rustListAttribute("allow", [rustWordAttribute("clippy::missing_safety_doc"), rustValueAttribute("reason", { kind: "string", value: "explicit source safety contract" })]),
  needlessLifetimes:
    rustListAttribute("allow", [rustWordAttribute("clippy::needless_lifetimes"), rustValueAttribute("reason", { kind: "string", value: "explicit lifetime contract" })]),
  neverLoop:
    rustListAttribute("expect", [rustWordAttribute("clippy::never_loop"), rustValueAttribute("reason", { kind: "string", value: "authored iterator protocol" })]),
  newReturningOtherType:
    rustListAttribute("allow", [rustWordAttribute("clippy::new_ret_no_self"), rustValueAttribute("reason", { kind: "string", value: "authored static member name" })]),
  nonCamelCaseType:
    rustListAttribute("allow", [rustWordAttribute("non_camel_case_types"), rustValueAttribute("reason", { kind: "string", value: "preserves an exact target type identity" })]),
  nonUpperCaseGlobal:
    rustListAttribute("allow", [rustWordAttribute("non_upper_case_globals"), rustValueAttribute("reason", { kind: "string", value: "preserves the authored source name" })]),
  pointerDerefOutsideUnsafeFunction:
    rustListAttribute("allow", [rustWordAttribute("clippy::not_unsafe_ptr_arg_deref"), rustValueAttribute("reason", { kind: "string", value: "explicit unsafe region" })]),
  shouldImplementTrait:
    rustListAttribute("expect", [rustWordAttribute("clippy::should_implement_trait"), rustValueAttribute("reason", { kind: "string", value: "authored method contract" })]),
  tooManyArguments:
    rustListAttribute("expect", [rustWordAttribute("clippy::too_many_arguments"), rustValueAttribute("reason", { kind: "string", value: "checked source signature" })]),
  unusedAssignments:
    rustListAttribute("expect", [rustWordAttribute("unused_assignments"), rustValueAttribute("reason", { kind: "string", value: "checked source evaluation order" })]),
  unusedAssignmentsInner:
    rustListAttribute("expect", [rustWordAttribute("unused_assignments"), rustValueAttribute("reason", { kind: "string", value: "checked source evaluation order" })]),
  unusedVariables:
    rustListAttribute("expect", [rustWordAttribute("unused_variables"), rustValueAttribute("reason", { kind: "string", value: "authored binding drop scope" })]),
  unusedTypeParameters:
    rustListAttribute("expect", [rustWordAttribute("clippy::extra_unused_type_parameters"), rustValueAttribute("reason", { kind: "string", value: "retains the checked generic callable contract" })]),
  unitArguments:
    rustListAttribute("expect", [rustWordAttribute("clippy::unit_arg"), rustValueAttribute("reason", { kind: "string", value: "preserves evaluation and borrow scopes of zero-sized source arguments" })]),
  reflexiveComparison:
    rustListAttribute("expect", [rustWordAttribute("clippy::eq_op"), rustValueAttribute("reason", { kind: "string", value: "authored reflexive comparison" })]),
  unusedUnsafe:
    rustListAttribute("allow", [rustWordAttribute("unused_unsafe"), rustValueAttribute("reason", { kind: "string", value: "explicit source unsafe region" })]),
});
