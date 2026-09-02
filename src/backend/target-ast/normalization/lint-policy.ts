export const rustLintAttributes = Object.freeze({
  blocksInConditions:
    '#[expect(clippy::blocks_in_conditions, reason = "checked evaluation region")]',
  collapsibleIf:
    '#[expect(clippy::collapsible_if, reason = "checked lexical regions")]',
  authoredDeadCode:
    '#[allow(dead_code, reason = "retains an unused authored declaration")]',
  authoredUnreadField:
    '#[allow(dead_code, reason = "retains an unread authored field")]',
  authoredUnusedVariant:
    '#[allow(dead_code, reason = "retains an unused authored variant")]',
  generatedEnumDiscriminant:
    '#[allow(dead_code, reason = "stores an authored enum discriminant")]',
  generatedRetainedConstructor:
    '#[allow(dead_code, reason = "retains an unused generated constructor")]',
  generatedUnconstructedInstance:
    '#[expect(dead_code, reason = "retains an unconstructed generated instance")]',
  generatedUnconstructedShape:
    '#[expect(dead_code, reason = "retains an unconstructed checked source shape")]',
  generatedUnusedDispatch:
    '#[expect(dead_code, reason = "retains an unused generated dispatch slot")]',
  generatedUnusedStorage:
    '#[expect(dead_code, reason = "retains unused generated storage")]',
  inherentToString:
    '#[expect(clippy::inherent_to_string, reason = "authored toString contract")]',
  missingSafetyDoc:
    '#[allow(clippy::missing_safety_doc, reason = "explicit source safety contract")]',
  needlessLifetimes:
    '#[allow(clippy::needless_lifetimes, reason = "explicit lifetime contract")]',
  neverLoop:
    '#[expect(clippy::never_loop, reason = "authored iterator protocol")]',
  newReturningOtherType:
    '#[allow(clippy::new_ret_no_self, reason = "authored static member name")]',
  nonCamelCaseType:
    '#[allow(non_camel_case_types, reason = "preserves an exact target type identity")]',
  nonUpperCaseGlobal:
    '#[allow(non_upper_case_globals, reason = "preserves the authored source name")]',
  pointerDerefOutsideUnsafeFunction:
    '#[allow(clippy::not_unsafe_ptr_arg_deref, reason = "explicit unsafe region")]',
  shouldImplementTrait:
    '#[expect(clippy::should_implement_trait, reason = "authored method contract")]',
  tooManyArguments:
    '#[expect(clippy::too_many_arguments, reason = "checked source signature")]',
  unusedAssignments:
    '#[expect(unused_assignments, reason = "checked source evaluation order")]',
  unusedAssignmentsInner:
    '#![expect(unused_assignments, reason = "checked source evaluation order")]',
  unusedVariables:
    '#[expect(unused_variables, reason = "authored binding drop scope")]',
  unusedUnsafe:
    '#[allow(unused_unsafe, reason = "explicit source unsafe region")]',
});
