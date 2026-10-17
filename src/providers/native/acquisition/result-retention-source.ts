import type {
  RustCompilerAssociatedConstraint, RustCompilerConstArgument, RustCompilerGenericArgument,
  RustCompilerLifetime, RustCompilerNativeRetentionQuestion,
  RustCompilerNativeRetentionQuestionSpan, RustCompilerTraitDispatch, RustCompilerType,
  RustCompilerTypeRequirement,
} from "../model/model.js";
import { rustCompilerLifetimeSemanticKey } from "../model/rustdoc-types.js";

export interface RustNativeRetentionSource {
  readonly sourceText: string;
  readonly originalQuestionSpans: readonly RustCompilerNativeRetentionQuestionSpan[];
}

export function renderRustNativeResultRetentionSource(input: {
  readonly questions: readonly RustCompilerNativeRetentionQuestion[];
  readonly phase: "challenge" | "certify-permitted";
  readonly permitted?: ReadonlySet<string>;
}): RustNativeRetentionSource {
  const lines = ["#![allow(dead_code, unused_variables, unused_mut)]", "extern crate alloc;"];
  const spans: RustCompilerNativeRetentionQuestionSpan[] = [];
  const identities = new Set<string>();
  for (const [index, question] of input.questions.entries()) {
    if (!question.id || identities.has(question.id)) throw new Error("Native retention questions require unique original identities.");
    identities.add(question.id);
    const renderer = createNativeTypeRenderer(question);
    const generics = renderer.parameters(question.parameters, undefined);
    const selected = rustCompilerLifetimeSemanticKey(question.origin.lifetime);
    const outer = question.parameters.filter(parameter => parameter.kind !== "lifetime" ||
      rustCompilerLifetimeSemanticKey(parameter.lifetime) !== selected);
    const outerGenerics = renderer.parameters(outer, selected);
    const requirements = renderer.requirements(question.requirements);
    const outerRequirements = renderer.requirements(question.requirements, selected);
    const arguments_ = question.parameters.flatMap(parameter => parameter.kind === "lifetime" ? [] :
      [parameter.kind === "type" ? renderer.type({ kind: "generic", identity: parameter.identity, name: parameter.name })
        : renderer.constant({ kind: "parameter", identity: parameter.identity, name: parameter.name })]);
    const application = arguments_.length === 0 ? "" : `::<${arguments_.join(", ")}>`;
    const originType = renderer.type(question.origin.referent);
    if (renderer.containsLifetime(question.origin.referent, selected)) {
      throw new Error(`Native retention question '${question.id}' requires an independent original referent, not a self-referential artificial owner.`);
    }
    const borrow = question.origin.mutable ? "&mut" : "&";
    const lifetime = renderer.lifetime(question.origin.lifetime);
    const invocation = question.invocation;
    const selectedInputs = invocation.inputs.filter(row => sameInput(row.input, invocation.selectedInput));
    if (selectedInputs.length !== 1) throw new Error(`Native retention question '${question.id}' lost its original selected native formal.`);
    for (const [position, row] of invocation.inputs.entries()) {
      if (sameInput(row.input, invocation.selectedInput) && invocation.selectedKind === "borrow") continue;
      lines.push(`fn __input_${index}_${position}${generics}(__anchor: &${lifetime} ()) -> ${renderer.type(row.type)}${requirements} { loop {} }`);
    }
    const call = (owner: string): string => {
      const arguments_ = invocation.inputs.map((row, position) => sameInput(row.input, invocation.selectedInput)
        ? invocation.selectedKind === "borrow" ? `${borrow} *${owner}` : `__input_${index}_${position}${application}(&*${owner})`
        : `__input_${index}_${position}${application}(&())`);
      const methodArguments = invocation.genericArguments.map(renderer.argument);
      const suffix = methodArguments.length === 0 ? "" : `::<${methodArguments.join(", ")}>`;
      const ownerArguments = invocation.ownerArguments.map(renderer.argument);
      const ownerType = `${renderer.path(invocation.path)}${ownerArguments.length === 0 ? "" : `<${ownerArguments.join(", ")}>`}`;
      const target = invocation.method === undefined ? renderer.path(invocation.path)
        : invocation.trait === undefined ? `<${ownerType}>::${renderer.path([invocation.method])}`
          : `<${ownerType} as ${renderer.trait(invocation.trait)}>::${renderer.path([invocation.method])}`;
      let result = `${target}${suffix}(${arguments_.join(", ")})`;
      if (invocation.unsafe) result = `unsafe { ${result} }`;
      if (question.phase === "completion") result = `(${result}).await`;
      if (invocation.fallible && question.phase !== "pending")
        result = `match ${result} { ::core::result::Result::Ok(value) => value, ::core::result::Result::Err(_) => return }`;
      return result;
    };
    for (const phase of ["use", "cleanup"] as const) {
      const key = `${question.id}:${phase}`;
      if (input.phase === "certify-permitted" && input.permitted?.has(key) !== true) continue;
      const startLine = lines.length + 1;
      lines.push(`${question.phase === "completion" ? "async " : ""}fn __${phase}_${index}${outerGenerics}(mut __owner: ::alloc::boxed::Box<${originType}>)${outerRequirements} {`);
      if (phase === "cleanup") {
        lines.push("    let __held;", "    {", "        let mut __local = __owner;",
          `        __held = ${call("__local")};`, "    }");
      } else {
        lines.push(`    let __held = ${call("__owner")};`,
          "    ::core::hint::black_box(&mut __owner);", "    ::core::hint::black_box(&__held);");
      }
      lines.push("}");
      spans.push(Object.freeze({ questionId: question.id, phase, startLine, endLine: lines.length }));
    }
  }
  return Object.freeze({ sourceText: `${lines.join("\n")}\n`, originalQuestionSpans: Object.freeze(spans) });
}

function createNativeTypeRenderer(question: RustCompilerNativeRetentionQuestion) {
  const selected = rustCompilerLifetimeSemanticKey(question.origin.lifetime);
  const names = new Map<string, string>([[selected, "'__loan"]]);
  for (const [index, parameter] of question.parameters.entries()) {
    if (parameter.kind === "lifetime") {
      const identity = rustCompilerLifetimeSemanticKey(parameter.lifetime);
      if (!names.has(identity)) names.set(identity, `'__region_${index}`);
    } else names.set(parameter.identity.itemId, `${parameter.kind === "type" ? "Type" : "CONST"}_${index}`);
  }
  function lifetime(value: RustCompilerLifetime): string {
    if (value.kind === "static") return "'static";
    const known = names.get(rustCompilerLifetimeSemanticKey(value));
    if (known === undefined) throw new Error(`Native retention question '${question.id}' has an unbound native lifetime identity.`);
    return known;
  }
  function constant(value: RustCompilerConstArgument): string {
    if (value.kind === "integer") {
      if (!/^-?[0-9]+$/u.test(value.value)) throw new Error("Native retention requires an exact normalized integer const.");
      return value.value;
    }
    if (value.kind === "boolean") return String(value.value);
    if (value.kind === "char") {
      const scalar = [...value.value];
      if (scalar.length !== 1) throw new Error("Native retention requires one normalized character scalar.");
      return `'\\u{${scalar[0]!.codePointAt(0)!.toString(16)}}'`;
    }
    if (value.kind === "parameter") {
      const known = names.get(value.identity.itemId);
      if (known !== undefined) return known;
    }
    throw new Error(`Native retention question '${question.id}' has an unresolved const application.`);
  }
  function argument(value: RustCompilerGenericArgument): string {
    return value.kind === "type" ? type(value.type) : value.kind === "lifetime" ? lifetime(value.lifetime) : constant(value.value);
  }
  function path(parts: readonly string[]): string {
    if (parts.length === 0) throw new Error("Native retention requires an exact public native type path.");
    return parts.map((part, index) => {
      if (!/^[\p{ID_Start}_][\p{ID_Continue}]*$/u.test(part)) throw new Error("Native retention requires normalized Rust path identifiers.");
      if (index === 0 && part === question.dependency.crateName) return question.dependency.targetCrateName;
      return ["self", "Self", "super", "crate"].includes(part) ? part : `r#${part}`;
    }).join("::");
  }
  function constraints(values: readonly RustCompilerAssociatedConstraint[]): string[] {
    return values.map(value => {
      const generic = value.genericArguments.length === 0 ? "" : `<${value.genericArguments.map(argument).join(", ")}>`;
      const name = `${path([value.name])}${generic}`;
      return value.kind === "equality" ? `${name} = ${type(value.type)}` :
        `${name}: ${[...value.traits.map(trait), ...value.outlives.map(lifetime)].join(" + ")}`;
    });
  }
  function trait(value: RustCompilerTraitDispatch): string {
    const arguments_ = [...value.genericArguments.map(argument), ...constraints(value.associatedConstraints)];
    if (value.lifetimeBinder !== undefined) {
      throw new Error(`Native retention question '${question.id}' requires its higher-ranked native binder application.`);
    }
    return `${path(value.path.split("::"))}${arguments_.length === 0 ? "" : `<${arguments_.join(", ")}>`}`;
  }
  function requirement(value: RustCompilerTypeRequirement): string {
    return value === "copy" ? "::core::marker::Copy" : value === "clone" ? "::core::clone::Clone" : trait(value.trait);
  }
  function type(value: RustCompilerType): string {
    switch (value.kind) {
      case "unit": return "()";
      case "primitive": return value.name;
      case "generic": {
        const name = names.get(value.identity.itemId);
        if (name === undefined) throw new Error(`Native retention question '${question.id}' has an unresolved native type parameter.`);
        return name;
      }
      case "tuple": return `(${value.elements.map(type).join(", ")}${value.elements.length === 1 ? "," : ""})`;
      case "array": return `[${type(value.element)}; ${constant(value.length)}]`;
      case "slice": return `[${type(value.element)}]`;
      case "reference": return `&${lifetime(value.lifetime)} ${value.mutable ? "mut " : ""}${type(value.target)}`;
      case "raw-pointer": return `*${value.mutable ? "mut" : "const"} ${type(value.target)}`;
      case "path": return `${path([value.crateName, ...value.modulePath, value.name])}${value.genericArguments.length === 0 ? "" :
        `<${value.genericArguments.map(argument).join(", ")}>`}`;
      case "associated-type": return `<${type(value.owner)} as ${trait(value.trait)}>::${path([value.name])}${value.genericArguments.length === 0 ? "" :
        `<${value.genericArguments.map(argument).join(", ")}>`}`;
      case "trait-object": return `dyn ${[trait(value.principal), ...value.autoTraits.map(trait), lifetime(value.lifetime)].join(" + ")}`;
      case "function-pointer": {
        if (value.lifetimeBinder !== undefined) throw new Error(`Native retention question '${question.id}' has an unapplied higher-ranked function binder.`);
        return `${value.unsafe ? "unsafe " : ""}${value.abi === "Rust" ? "" : `extern ${JSON.stringify(value.abi)} `}fn(${value.parameters.map(type).join(", ")}) -> ${type(value.result)}`;
      }
      case "self": throw new Error(`Native retention question '${question.id}' has an unapplied original Self identity.`);
      case "opaque": throw new Error(`Native retention question '${question.id}' requires the original native opaque-result constructor application.`);
    }
  }
  function containsLifetime(value: RustCompilerType, identity: string): boolean {
    switch (value.kind) {
      case "reference": return rustCompilerLifetimeSemanticKey(value.lifetime) === identity || containsLifetime(value.target, identity);
      case "trait-object": return rustCompilerLifetimeSemanticKey(value.lifetime) === identity ||
        [value.principal, ...value.autoTraits].some(value => value.genericArguments.some(argumentContains));
      case "path": return value.genericArguments.some(argumentContains);
      case "opaque": return value.outlives.some(value => rustCompilerLifetimeSemanticKey(value) === identity) || value.captures.some(argumentContains);
      case "tuple": return value.elements.some(value => containsLifetime(value, identity));
      case "array": case "slice": return containsLifetime(value.element, identity);
      case "raw-pointer": return containsLifetime(value.target, identity);
      case "function-pointer": return [...value.parameters, value.result].some(value => containsLifetime(value, identity));
      case "associated-type": return containsLifetime(value.owner, identity) || value.genericArguments.some(argumentContains);
      default: return false;
    }
    function argumentContains(argument: RustCompilerGenericArgument): boolean {
      return argument.kind === "lifetime" ? rustCompilerLifetimeSemanticKey(argument.lifetime) === identity :
        argument.kind === "type" && containsLifetime(argument.type, identity);
    }
  }
  function parameters(values: RustCompilerNativeRetentionQuestion["parameters"], excluded: string | undefined): string {
    const retainedOutlives = (values: readonly RustCompilerLifetime[]) => values.filter(value =>
      rustCompilerLifetimeSemanticKey(value) !== excluded).map(lifetime);
    const ordered = [...values.filter(value => value.kind === "lifetime"), ...values.filter(value => value.kind !== "lifetime")];
    const entries = ordered.map(value => {
      if (value.kind === "lifetime") {
        const bounds = retainedOutlives(value.outlives);
        return `${lifetime(value.lifetime)}${bounds.length === 0 ? "" : `: ${bounds.join(" + ")}`}`;
      }
      const name = names.get(value.identity.itemId)!;
      if (value.kind === "const") return `const ${name}: ${type(value.type)}`;
      const bounds = [...value.requirements.map(requirement), ...retainedOutlives(value.outlives), ...(value.maybeSized ? ["?Sized"] : [])];
      return `${name}${bounds.length === 0 ? "" : `: ${bounds.join(" + ")}`}`;
    });
    if (rustCompilerLifetimeSemanticKey(question.origin.lifetime) === selected && values === question.parameters &&
      !values.some(value => value.kind === "lifetime" && rustCompilerLifetimeSemanticKey(value.lifetime) === selected)) entries.unshift("'__loan");
    return entries.length === 0 ? "" : `<${entries.join(", ")}>`;
  }
  function requirements(values: readonly import("../model/model.js").RustCompilerTypeParameter[], excluded?: string): string {
    const entries = values.map(value => {
      const bounds = [...value.requirements.map(requirement), ...value.outlives.filter(value =>
        rustCompilerLifetimeSemanticKey(value) !== excluded).map(lifetime), ...(value.maybeSized ? ["?Sized"] : [])];
      return bounds.length === 0 ? undefined : `${type({ kind: "generic", identity: value.identity, name: value.name })}: ${bounds.join(" + ")}`;
    }).filter((entry): entry is string => entry !== undefined);
    return entries.length === 0 ? "" : ` where ${entries.join(", ")}`;
  }
  return { type, lifetime, constant, argument, path, trait, parameters, requirements, containsLifetime };
}

function sameInput(left: RustCompilerNativeRetentionQuestion["invocation"]["selectedInput"],
  right: RustCompilerNativeRetentionQuestion["invocation"]["selectedInput"]): boolean {
  return left.kind === "receiver" ? right.kind === "receiver" : right.kind === "argument" && left.sourceIndex === right.sourceIndex;
}
