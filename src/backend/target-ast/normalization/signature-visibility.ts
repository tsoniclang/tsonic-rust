import type { RustGenericArgument, RustItem, RustSourceFileModel, RustType, RustTypeBound } from "../nodes.js";

export function rustPublicSignatureTypeNames(model: RustSourceFileModel): readonly string[] {
  const items = closePublicRustTypeVisibility(model.items);
  const publicTypes = publicDeclaredRustTypeNames(items);
  return Object.freeze([...new Set(scopedSignatureTypeNames(items, publicTypes))].sort((left, right) =>
      left.localeCompare(right, "en")));
}

export function exposeRustSignatureTypes(
  model: RustSourceFileModel,
  requiredNames: ReadonlySet<string>,
): RustSourceFileModel {
  return { ...model, items: closePublicRustTypeVisibility(model.items, requiredNames) };
}

export function publicDeclaredRustTypeNames(items: readonly RustItem[]): ReadonlySet<string> {
  return declaredRustTypeNames(items, true);
}

function declaredRustTypeNames(items: readonly RustItem[], publicOnly = false): ReadonlySet<string> {
  return new Set(items.flatMap(item => item.kind === "mod-decl" && item.body !== undefined
    ? [...declaredRustTypeNames(item.body.items, publicOnly)].map(name => `${item.name}::${name}`)
    : (item.kind === "struct" || item.kind === "trait" || item.kind === "enum" ||
        item.kind === "type-alias") && (!publicOnly || item.visibility === "public") ? [item.name] : []));
}

function scopedSignatureTypeNames(
  items: readonly RustItem[],
  publicTypes: ReadonlySet<string>,
  scope = "",
  enclosingTypes: ReadonlySet<string> = declaredRustTypeNames(items),
): readonly string[] {
  const prefix = scope === "" ? "" : `${scope}::`;
  const localPublicTypes = new Set([...publicTypes].filter(name => name.startsWith(prefix))
    .map(name => name.slice(prefix.length)));
  return items.flatMap(item => item.kind === "mod-decl" && item.body !== undefined
    ? scopedSignatureTypeNames(item.body.items, publicTypes, `${prefix}${item.name}`, enclosingTypes)
    : publicSignatureTypes(item, localPublicTypes).flatMap(rustTypeNames).map(name => {
      if (enclosingTypes.has(`${prefix}${name}`)) return `${prefix}${name}`;
      return name;
    }));
}

export function closePublicRustTypeVisibility(
  items: readonly RustItem[],
  requiredNames: ReadonlySet<string> = new Set(),
): readonly RustItem[] {
  const localTypes = declaredRustTypeNames(items);
  const publicTypes = new Set([...publicDeclaredRustTypeNames(items),
    ...[...requiredNames].filter(name => localTypes.has(name))]);
  for (;;) {
    const required = new Set(scopedSignatureTypeNames(items, publicTypes)
      .filter(name => localTypes.has(name)));
    const additions = [...required].filter((name) => !publicTypes.has(name));
    if (additions.length === 0) {
      break;
    }
    for (const name of additions) {
      publicTypes.add(name);
    }
  }
  return exposeScopedRustTypes(items, publicTypes);
}

function exposeScopedRustTypes(items: readonly RustItem[], publicTypes: ReadonlySet<string>): readonly RustItem[] {
  return items.map(item => {
    if (item.kind === "mod-decl" && item.body !== undefined) {
      const prefix = `${item.name}::`;
      const names = new Set([...publicTypes].filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length)));
      return { ...item, visibility: names.size === 0 ? item.visibility : "public" as const,
        body: { ...item.body, items: exposeScopedRustTypes(item.body.items, names) } };
    }
    return (item.kind === "struct" || item.kind === "enum" || item.kind === "trait" ||
        item.kind === "type-alias") && publicTypes.has(item.name) &&
        item.visibility !== "public"
      ? { ...item, visibility: "public",
          ...(item.kind === "trait" ? {
            members: item.members.map(member => {
              if (member.kind !== "function") return member;
              const { deadCode, ...method } = member;
              return method;
            }),
          } : {}),
        }
      : item;
  });
}

function publicSignatureTypes(
  item: RustItem,
  publicTypes: ReadonlySet<string>,
): readonly RustType[] {
  switch (item.kind) {
    case "function":
      return item.visibility === "public"
        ? [...item.params.map((parameter) => parameter.type), ...optionalType(item.returnType)]
        : [];
    case "const":
    case "thread-local":
      return item.visibility === "public" ? [item.type] : [];
    case "struct":
      return publicTypes.has(item.name)
        ? item.fields.filter((field) => field.visibility === "public").map((field) => field.type)
        : [];
    case "enum":
      return publicTypes.has(item.name)
        ? item.variants.flatMap((variant) => variant.fields ?? [])
        : [];
    case "trait":
      return publicTypes.has(item.name)
        ? [
            ...(item.superTraits ?? []),
            ...item.members.flatMap(member => member.kind === "type"
              ? member.bounds.flatMap(rustTypeBoundTypes)
              : member.kind === "function" ? [
                ...member.params.map(parameter => parameter.type),
                ...optionalType(member.returnType),
              ] : []),
          ]
        : [];
    case "impl":
      return [...rustTypeNames(item.target), ...optionalType(item.trait).flatMap(rustTypeNames)]
        .some((name) => publicTypes.has(name))
        ? [
          ...item.members.flatMap(member => member.kind === "type" ? [member.type]
            : member.kind === "const" ? (member.visibility === "public" ? [member.type] : [])
            : member.kind === "function" && member.visibility === "public" ? [
              ...member.params.map(parameter => parameter.type), ...optionalType(member.returnType),
            ] : []),
        ]
        : [];
    case "type-alias":
      return publicTypes.has(item.name) ? [item.target] : [];
    case "mod-decl":
    case "extern-crate":
    case "use":
      return [];
  }
}

function optionalType(type: RustType | undefined): readonly RustType[] {
  return type === undefined ? [] : [type];
}

function rustTypeBoundTypes(bound: RustTypeBound): readonly RustType[] {
  switch (bound.kind) {
    case "trait":
      return [{ kind: "named", path: bound.path }];
    case "trait-type":
      return [bound.reference.trait];
    case "callable":
      return [...bound.parameters, bound.result];
    case "lifetime":
    case "maybe-sized":
      return [];
  }
}

function rustTypeNames(type: RustType): readonly string[] {
  switch (type.kind) {
    case "infer":
      return [];
    case "named":
      return [
        type.path,
        ...rustGenericArgumentTypeNames(type.genericArguments),
      ];
    case "qualified":
      return [
        ...rustTypeNames(type.owner),
        ...(type.trait === undefined ? [] : rustTypeNames(type.trait)),
        ...rustGenericArgumentTypeNames(type.genericArguments),
      ];
    case "trait-object":
      return [
        ...rustTypeNames(type.principal.trait),
        ...type.autoTraits.flatMap((trait) => rustTypeNames(trait.trait)),
      ];
    case "impl-trait":
      return [
        ...type.bounds.flatMap(rustTypeBoundNames),
        ...rustGenericArgumentTypeNames(type.captures ?? []),
      ];
    case "reference":
      return rustTypeNames(type.referent);
    case "raw-pointer":
      return rustTypeNames(type.pointee);
    case "fixed-array":
    case "slice":
      return rustTypeNames(type.element);
    case "function-pointer":
    case "callable-trait":
      return [...type.parameters.flatMap(rustTypeNames), ...rustTypeNames(type.result)];
    case "tuple":
      return type.elements.flatMap(rustTypeNames);
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return [];
  }
}

function rustTypeBoundNames(bound: RustTypeBound): readonly string[] {
  switch (bound.kind) {
    case "trait":
      return [bound.path];
    case "trait-type":
      return rustTypeNames(bound.reference.trait);
    case "callable":
      return [
        ...bound.parameters.flatMap(rustTypeNames),
        ...rustTypeNames(bound.result),
      ];
    case "lifetime":
    case "maybe-sized":
      return [];
  }
}

function rustGenericArgumentTypeNames(
  arguments_: readonly RustGenericArgument[] | undefined,
): readonly string[] {
  return (arguments_ ?? []).flatMap((argument) => {
    switch (argument.kind) {
      case "type":
        return rustTypeNames(argument.type);
      case "associated-equality":
        return [
          ...rustGenericArgumentTypeNames(argument.genericArguments),
          ...rustTypeNames(argument.type),
        ];
      case "associated-bounds":
        return [
          ...rustGenericArgumentTypeNames(argument.genericArguments),
          ...argument.bounds.flatMap((bound) =>
            bound.kind === "trait-type"
              ? rustTypeNames(bound.reference.trait)
              : bound.kind === "callable"
                ? [
                    ...bound.parameters.flatMap(rustTypeNames),
                    ...rustTypeNames(bound.result),
                  ]
                : []),
        ];
      case "lifetime":
      case "const":
        return [];
    }
  });
}
