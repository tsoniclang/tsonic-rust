import type { RustGenericArgument, RustGenericParameter, RustImplFunction, RustItem, RustTraitFunction, RustType, RustTypeBound, RustVisibility } from "../nodes.js";
import { rustTypeEquals } from "../inspection/type-equality.js";
import { rustPascalCaseIdentifier } from "../../../target-model/names/identifiers.js";

interface ClosedTypeSummary {
  readonly weight: number;
  readonly names: ReadonlySet<string>;
}

export interface RustNamedSignatureScope {
  readonly aliases: readonly RustItem[];
  readonly items: readonly RustItem[];
}

export function nameRustSignatureTypes(
  items: readonly RustItem[],
  visitCallable: <Callable extends RustImplFunction>(
    callable: Callable, nameType: (type: RustType, role: string) => RustType,
  ) => Callable = callable => callable,
): RustNamedSignatureScope {
  const reserved = new Set(items.flatMap(item => [
    ...("name" in item ? [item.name] : []),
    ...("generics" in item ? item.generics.parameters.map(parameter => parameter.name) : []),
    ...(item.kind === "impl" || item.kind === "trait" ? item.members.flatMap(member => member.kind !== "const"
      ? member.generics.parameters.map(parameter => parameter.name) : []) : []),
    ...(item.kind === "use" ? [item.alias ?? item.path.split("::").slice(-1)[0]!] : []),
  ]));
  const aliases: Extract<RustItem, { readonly kind: "type-alias" }>[] = [];
  const createTypeNamer = (item: { readonly name: string; readonly visibility: RustVisibility },
    availableParameters: readonly RustGenericParameter[]) => {
    const nameType = (type: RustType, role: string, visibility = item.visibility,
      scope = availableParameters): RustType => {
      if (type.kind === "reference") return { ...type, referent: nameType(type.referent, role, visibility, scope) };
      if (type.kind === "slice") return { ...type, element: nameType(type.element, `${role}Element`, visibility, scope) };
      if (type.kind === "impl-trait") return { ...type,
        bounds: type.bounds.map(bound => nameBound(bound, role, visibility, scope)) };
      const summary = summarizeClosedType(type);
      if (summary === undefined || summary.weight < 160 || summary.names.has("Self")) return type;
      const selectedParameters = scope.filter(parameter => summary.names.has(parameter.name));
      const parameters = [...selectedParameters.filter(parameter => parameter.kind === "lifetime"),
        ...selectedParameters.filter(parameter => parameter.kind !== "lifetime")]
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
    const nameArgument = (argument: RustGenericArgument, role: string, visibility: RustVisibility,
      scope: readonly RustGenericParameter[]): RustGenericArgument => {
      if (argument.kind === "type") return { ...argument, type: nameType(argument.type, role, visibility, scope) };
      if (argument.kind !== "associated-equality" && argument.kind !== "associated-bounds") return argument;
      const genericArguments = argument.genericArguments.map((value, index) =>
        nameArgument(value, `${role}Arg${index}`, visibility, scope));
      return argument.kind === "associated-equality"
        ? { ...argument, genericArguments, type: nameType(argument.type, `${role}${argument.name}`, visibility, scope) }
        : { ...argument, genericArguments, bounds: argument.bounds.map(bound => nameBound(bound, role, visibility, scope)) };
    };
    const nameBound = (bound: RustTypeBound, role: string, visibility: RustVisibility,
      scope: readonly RustGenericParameter[]): RustTypeBound => {
      if (bound.kind === "callable") {
        const parameters = [...scope, ...bound.binder];
        return { ...bound,
          parameters: bound.parameters.map((parameter, index) => nameType(parameter, `${role}Arg${index}`, visibility, parameters)),
          result: nameType(bound.result, `${role}Result`, visibility, parameters) };
      }
      if (bound.kind !== "trait-type") return bound;
      const trait = bound.reference.trait;
      if (trait.kind !== "named" && trait.kind !== "qualified" || trait.genericArguments === undefined) return bound;
      const parameters = [...scope, ...bound.reference.binder ?? []];
      return { ...bound, reference: { ...bound.reference, trait: { ...trait,
        genericArguments: trait.genericArguments.map((argument, index) =>
          nameArgument(argument, `${role}Arg${index}`, visibility, parameters)) } } };
    };
    return nameType;
  };
  const nameSignature = <Callable extends RustImplFunction | RustTraitFunction>(
    item: Callable, ownerParameters: readonly RustGenericParameter[], visibility: RustVisibility,
  ) => {
    const nameType = createTypeNamer({ name: item.name, visibility }, [...ownerParameters, ...item.generics.parameters]);
    const callable: Callable = { ...item, params: item.params.map(parameter => ({ ...parameter,
      type: nameType(parameter.type, parameter.name),
    })), ...(item.returnType === undefined ? {} : { returnType: nameType(item.returnType, "Result") }),
      ...(item.errorType === undefined ? {} : { errorType: nameType(item.errorType, "Error") }),
    };
    return { callable, nameType };
  };
  const nameCallable = <Callable extends RustImplFunction>(item: Callable, ownerParameters: readonly RustGenericParameter[]): Callable => {
    const { callable, nameType } = nameSignature(item, ownerParameters, item.visibility);
    return visitCallable(callable, (type, role) => nameType(type, role, "private"));
  };
  const result = items.map(item => item.kind === "function" ? nameCallable(item, [])
    : item.kind === "impl" ? { ...item, members: item.members.map(member => member.kind === "function"
      ? nameCallable(member, item.generics.parameters) : member) }
      : item.kind === "struct" ? { ...item, fields: item.fields.map(field => ({ ...field,
        type: createTypeNamer(item, item.generics.parameters)(field.type, field.name),
      })) }
      : item.kind === "trait" ? { ...item, members: item.members.map(member => member.kind === "function"
        ? nameSignature(member, item.generics.parameters, item.visibility).callable : member) }
      : item);
  return { aliases, items: result };
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
      if (value.kind === "lifetime" && value.lifetime.kind === "static") return true;
      if (value.kind === "lifetime" && value.lifetime.kind === "named") {
        names.add(value.lifetime.name);
        return true;
      }
      return false;
    });
  const visit = (value: RustType, depth: number): boolean => {
    weight += depth * 10;
    switch (value.kind) {
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
