import type { RustBlock, RustFunctionParam, RustGenericArgument, RustGenericParameter, RustGenerics, RustItem, RustType, RustVisibility } from "../nodes.js";
import { rustTypeEquals } from "../inspection/type-equality.js";
import { rustPascalCaseIdentifier } from "../../../target-model/names/identifiers.js";

interface ClosedTypeSummary {
  readonly weight: number;
  readonly names: ReadonlySet<string>;
}

export function nameRustSignatureTypes(
  items: readonly RustItem[],
  visitBody: (body: RustBlock, nameType: (type: RustType, role: string) => RustType) => RustBlock = body => body,
): readonly RustItem[] {
  const reserved = new Set(items.flatMap(item => [
    ...("name" in item ? [item.name] : []),
    ...("generics" in item ? item.generics.parameters.map(parameter => parameter.name) : []),
    ...(item.kind === "impl" ? item.members.flatMap(member => member.kind === "function"
      ? member.generics.parameters.map(parameter => parameter.name) : []) : []),
    ...(item.kind === "use" ? [item.alias ?? item.path.split("::").slice(-1)[0]!] : []),
  ]));
  const aliases: Extract<RustItem, { readonly kind: "type-alias" }>[] = [];
  const createTypeNamer = (item: { readonly name: string; readonly visibility: RustVisibility },
    availableParameters: readonly RustGenericParameter[]) => {
    const nameType = (type: RustType, role: string, visibility = item.visibility): RustType => {
      if (type.kind === "reference") return { ...type, referent: nameType(type.referent, role, visibility) };
      if (type.kind === "slice") return { ...type, element: nameType(type.element, `${role}Element`, visibility) };
      if (type.kind === "impl-trait") return { ...type, bounds: type.bounds.map(bound =>
        bound.kind !== "callable" ? bound : { ...bound,
          parameters: bound.parameters.map((parameter, index) => nameType(parameter, `${role}Arg${index}`, visibility)),
          result: nameType(bound.result, `${role}Result`, visibility),
        }) };
      const summary = summarizeClosedType(type);
      if (summary === undefined || summary.weight < 160 || summary.names.has("Self")) return type;
      const parameters = availableParameters.filter(parameter => summary.names.has(parameter.name))
        .map((parameter): RustGenericParameter => parameter.kind === "type"
          ? { kind: "type", name: parameter.name, bounds: [] }
          : parameter.kind === "const" ? { kind: "const", name: parameter.name, type: parameter.type }
            : { ...parameter, outlives: [] });
      const arguments_: RustGenericArgument[] = parameters.map(parameter => parameter.kind === "type"
        ? { kind: "type", type: { kind: "named", path: parameter.name } }
        : parameter.kind === "const" ? { kind: "const", value: { kind: "path", path: parameter.name } }
          : { kind: "lifetime", lifetime: { kind: "named", name: parameter.name } });
      let alias = aliases.find(candidate => rustTypeEquals(candidate.target, type) &&
        candidate.generics.parameters.length === parameters.length &&
        candidate.generics.parameters.every((parameter, index) => {
          const expected = parameters[index];
          return parameter.kind === expected?.kind && parameter.name === expected.name &&
            (parameter.kind !== "const" || expected.kind === "const" && rustTypeEquals(parameter.type, expected.type));
        }));
      if (alias === undefined) {
        const base = rustPascalCaseIdentifier(`${item.name}_${role}`);
        let name = base;
        let suffix = 2;
        while (reserved.has(name)) name = `${base}${suffix++}`;
        reserved.add(name);
        alias = { kind: "type-alias", name, visibility,
          generics: { parameters, wherePredicates: [] }, target: type };
        aliases.push(alias);
      } else if (visibility === "public" && alias.visibility !== "public") {
        const index = aliases.indexOf(alias);
        alias = { ...alias, visibility: "public" };
        aliases[index] = alias;
      }
      return { kind: "named", path: alias.name, genericArguments: arguments_ };
    };
    return nameType;
  };
  const nameCallable = <Callable extends {
    readonly name: string; readonly visibility: RustVisibility;
    readonly params: readonly RustFunctionParam[]; readonly returnType?: RustType;
    readonly generics: RustGenerics;
    readonly body: RustBlock;
  }>(item: Callable, ownerParameters: readonly RustGenericParameter[]): Callable => {
    const nameType = createTypeNamer(item, [...ownerParameters, ...item.generics.parameters]);
    return { ...item, params: item.params.map(parameter => ({ ...parameter,
      type: nameType(parameter.type, parameter.name),
    })), ...(item.returnType === undefined ? {} : { returnType: nameType(item.returnType, "Result") }),
      body: visitBody(item.body, (type, role) => nameType(type, role, "private")),
    };
  };
  const result = items.map(item => item.kind === "function" ? nameCallable(item, [])
    : item.kind === "impl" ? { ...item, members: item.members.map(member => member.kind === "function"
      ? nameCallable(member, item.generics.parameters) : member) }
      : item.kind === "struct" ? { ...item, fields: item.fields.map(field => ({ ...field,
        type: createTypeNamer(item, item.generics.parameters)(field.type, field.name),
      })) }
      : item);
  return [...aliases, ...result];
}

function summarizeClosedType(type: RustType): ClosedTypeSummary | undefined {
  const names = new Set<string>();
  let weight = 0;
  const arguments_ = (values: readonly RustGenericArgument[] | undefined, depth: number): boolean =>
    (values ?? []).every(value => {
      if (value.kind === "type") return visit(value.type, depth);
      if (value.kind === "const") {
        if (value.value.kind === "path") names.add(value.value.path);
        return true;
      }
      return false;
    });
  const visit = (value: RustType, depth: number): boolean => {
    weight += depth * 10;
    switch (value.kind) {
      case "macro-invocation":
        return false;
      case "named":
        names.add(value.path);
        return arguments_(value.genericArguments, depth + 1);
      case "qualified":
        return visit(value.owner, depth + 1) && (value.trait === undefined || visit(value.trait, depth + 1)) &&
          arguments_(value.genericArguments, depth + 1);
      case "tuple":
        return value.elements.every(element => visit(element, depth + 1));
      case "fixed-array":
        if (value.length.kind === "path") names.add(value.length.path);
        return visit(value.element, depth + 1);
      case "primitive":
      case "string":
      case "str":
      case "unit":
      case "never":
        return true;
      case "infer":
      case "impl-trait":
      case "trait-object":
      case "reference":
      case "raw-pointer":
      case "slice":
      case "function-pointer":
      case "callable-trait":
        return false;
    }
  };
  return visit(type, 1) ? { weight, names } : undefined;
}
