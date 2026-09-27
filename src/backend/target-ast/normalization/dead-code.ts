import { type RustAttribute } from "../attributes.js";
import type {
  RustDeadCodeDisposition,
  RustItem,
  RustSourceFileModel,
  RustStructField,
} from "../nodes.js";
import { rustLintAttributes } from "./lint-policy.js";

interface RustDeadCodeOwner {
  readonly attrs?: readonly RustAttribute[];
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
        members: owner.members.map(member => member.kind === "function" ? finalizeRustDeadCodeOwner(member) : member),
      };
    }
    case "impl":
      return {
        ...item,
        members: item.members.map(member => member.kind === "function" || member.kind === "const"
          ? finalizeRustDeadCodeOwner(member) : member),
      };
    case "enum": {
      const owner = finalizeRustDeadCodeOwner(item);
      return {
        ...owner,
        variants: owner.variants.map(variant => finalizeRustDeadCodeOwner(variant)),
      };
    }
    case "mod-decl":
      return item.body === undefined ? item : { ...item, body: finalizeRustDeadCode(item.body) };
    case "extern-crate":
    case "use":
    case "macro-invocation":
      return item;
  }
}

function finalizeRustStructFieldDeadCode(field: RustStructField): RustStructField {
  return finalizeRustDeadCodeOwner(field);
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

function rustDeadCodeAttribute(disposition: RustDeadCodeDisposition): RustAttribute {
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
