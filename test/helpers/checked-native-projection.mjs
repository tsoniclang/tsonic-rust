import assert from "node:assert/strict";

export function assertCheckedNativeProjection(source) {
  assert.equal(/fn project_native\(self: alloc::rc::Rc<Self>, output: &mut dyn core::any::Any\)/u.test(source), true,
    "nominal recovery uses one borrowed stack output slot");
  assert.equal(/<dyn core::any::Any>::downcast_mut::<Option<alloc::rc::Rc<Self>>>/u.test(source), true,
    "recovery checks the exact native type before moving its existing handle");
  assert.equal(/(?:Box|Rc|Arc)\s*<\s*dyn\s+(?:core::any::)?Any\b|transmute|downcast_unchecked|downcast_ref|into_any|from_closed|reflect/u.test(source), false,
    "nominal recovery never allocates an erased object or performs unchecked reflection");
}
