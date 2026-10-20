import type { RustItem, RustSourceFileModel } from "../syntax/nodes.js";

export function applyRustSealedTypeVisibility(model: RustSourceFileModel, required: ReadonlySet<string>): RustSourceFileModel {
  const items = (values: readonly RustItem[], prefix: string): readonly RustItem[] => values.map(item => {
    const identity = "name" in item ? `${prefix}${item.name}` : undefined;
    if (item.kind === "mod-decl" && item.body !== undefined) return { ...item,
      visibility: [...required].some(name => name.startsWith(`${identity}::`)) ? "public" : item.visibility,
      body: { ...item.body, items: items(item.body.items, `${identity}::`) } };
    if ((item.kind !== "struct" && item.kind !== "trait" && item.kind !== "enum" && item.kind !== "type-alias") ||
      identity === undefined || !required.has(identity) || item.visibility === "public") return item;
    if (item.kind === "struct") {
      const { deadCode, ...exposed } = item;
      return { ...exposed, visibility: "public",
      fields: item.fields.map(field => {
        if (field.visibility !== "public") return field;
        const { deadCode: fieldDeadCode, ...selected } = field;
        return selected;
      }) };
    }
    if (item.kind === "enum") {
      const { deadCode, ...exposed } = item;
      return { ...exposed, visibility: "public", variants: item.variants.map(({ deadCode: variantDeadCode, ...variant }) => variant) };
    }
    if (item.kind === "trait") {
      const { deadCode, ...exposed } = item;
      return { ...exposed, visibility: "public", members: item.members.map(member => {
      if (member.kind !== "function") return member;
      const { deadCode: methodDeadCode, ...selected } = member;
      return selected;
      }) };
    }
    const { deadCode, ...exposed } = item;
    return { ...exposed, visibility: "public" };
  });
  return { ...model, items: items(model.items, "") };
}
