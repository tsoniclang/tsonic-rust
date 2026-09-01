import type {
  RustDeadCodeDisposition,
  RustImplConstant,
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
  RustStructField,
  RustTraitFunction,
} from "../nodes.js";
import { rustLintAttributes } from "./lint-policy.js";

interface RustDeadCodeOwner {
  readonly attrs?: readonly string[];
  readonly deadCode?: RustDeadCodeDisposition;
}

export function finalizeRustDeadCode(
  model: RustSourceFileModel,
): RustSourceFileModel {
  return {
    ...model,
    items: model.items.map(finalizeRustItemDeadCode),
  };
}

function finalizeRustItemDeadCode(item: RustItem): RustItem {
  switch (item.kind) {
    case "function":
    case "const":
    case "thread-local":
    case "type-alias":
      return finalizeRustDeadCodeOwner(item);
    case "struct": {
      const owner = finalizeRustDeadCodeOwner(item);
      return {
        ...owner,
        fields: owner.fields.map(finalizeRustStructFieldDeadCode),
      };
    }
    case "trait": {
      const owner = finalizeRustDeadCodeOwner(item);
      return {
        ...owner,
        functions: owner.functions.map(finalizeRustTraitFunctionDeadCode),
      };
    }
    case "impl":
      return {
        ...item,
        ...(item.constants === undefined
          ? {}
          : { constants: item.constants.map(finalizeRustImplConstantDeadCode) }),
        functions: item.functions.map(finalizeRustImplFunctionDeadCode),
      };
    case "enum": {
      const owner = finalizeRustDeadCodeOwner(item);
      return {
        ...owner,
        variants: owner.variants.map(finalizeRustDeadCodeOwner),
      };
    }
    case "mod-decl":
    case "extern-crate":
    case "use":
      return item;
  }
}

function finalizeRustStructFieldDeadCode(field: RustStructField): RustStructField {
  return finalizeRustDeadCodeOwner(field);
}

function finalizeRustTraitFunctionDeadCode(
  fn: RustTraitFunction,
): RustTraitFunction {
  return finalizeRustDeadCodeOwner(fn);
}

function finalizeRustImplFunctionDeadCode(
  fn: RustImplFunction,
): RustImplFunction {
  return finalizeRustDeadCodeOwner(fn);
}

function finalizeRustImplConstantDeadCode(
  constant: RustImplConstant,
): RustImplConstant {
  return finalizeRustDeadCodeOwner(constant);
}

function finalizeRustDeadCodeOwner<T extends RustDeadCodeOwner>(owner: T): T {
  const { deadCode, ...withoutDeadCode } = owner;
  if (deadCode === undefined) return withoutDeadCode as T;
  const attribute = rustDeadCodeAttribute(deadCode);
  const attrs = withoutDeadCode.attrs?.includes(attribute) === true
    ? withoutDeadCode.attrs
    : [...(withoutDeadCode.attrs ?? []), attribute];
  return { ...withoutDeadCode, attrs } as T;
}

function rustDeadCodeAttribute(disposition: RustDeadCodeDisposition): string {
  switch (disposition) {
    case "authored-declaration":
      return rustLintAttributes.authoredDeadCode;
    case "authored-unread-field":
      return rustLintAttributes.authoredUnreadField;
    case "authored-unused-variant":
      return rustLintAttributes.authoredUnusedVariant;
    case "generated-enum-discriminant":
      return rustLintAttributes.generatedEnumDiscriminant;
    case "generated-retained-constructor":
      return rustLintAttributes.generatedRetainedConstructor;
    case "generated-unconstructed-instance":
      return rustLintAttributes.generatedUnconstructedInstance;
    case "generated-unconstructed-shape":
      return rustLintAttributes.generatedUnconstructedShape;
    case "generated-unused-dispatch":
      return rustLintAttributes.generatedUnusedDispatch;
    case "generated-unused-storage":
      return rustLintAttributes.generatedUnusedStorage;
  }
}
