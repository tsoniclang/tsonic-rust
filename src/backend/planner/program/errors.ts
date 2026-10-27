import { rustHiddenAttribute } from "../../target-ast/syntax/attributes.js";
import type { RustPlanningContext } from "../context.js";
import { rustRuntimeErrorTypeIdentity } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustTypeFromCarrier } from "../types/carrier-syntax.js";
import {
  createRustSourceFile, type RustExpr, type RustItem, type RustPattern, type RustSourceFileModel, type RustType,
  type RustGenerics, emptyRustGenerics,
} from "../../target-ast/syntax/nodes.js";
import { planRustErrorObservations, planRustSuppressedErrorConstructor } from "./error-observations.js";
import { planRustErrorTransport, planRustSourceErrorTransport, rustSuppressedErrorPattern,
  type RustErrorTransportVariant } from "./error-transport.js";
import { planRustSourceErrorObservations } from "./source-error-observations.js";
import { planRustRetainedErrorAdmission } from "./retained-errors.js";
import { planRustErrorProjectionTransport, planRustSourceErrorProjectionDelegates } from "./error-projections.js";
import { planRustClosedThrowAdmission } from "./closed-throws.js";
import { planRustNativeValueProjections } from "./native-value-projections.js";
import { planRustErrorVariants } from "./error-variants.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

const programErrorName = "TsonicError";
const programResultName = "TsonicResult";

const programErrorType: RustType = { kind: "named", path: programErrorName };
const runtimeErrorType: RustType = {
  kind: "named",
  path: "tsonic_rust_runtime::TsonicError",
  identity: rustRuntimeErrorTypeIdentity,
};
const runtimeJsErrorType: RustType = {
  kind: "named",
  path: "tsonic_rust_runtime::JsError",
};
const unitType: RustType = { kind: "unit" };
const typeParameterT: RustType = { kind: "named", path: "T" };
const typeParameterNormal: RustType = { kind: "named", path: "TNormal" };
function namedType(path: string, typeArguments?: readonly RustType[]): Extract<RustType, { readonly kind: "named" }> {
  return {
    kind: "named",
    path,
    ...(typeArguments === undefined
      ? {}
      : { genericArguments: typeArguments.map((type) => ({ kind: "type" as const, type })) }),
  };
}

const oneTypeParameterGenerics = Object.freeze({
  parameters: Object.freeze([{ kind: "type" as const, name: "T", bounds: Object.freeze([]) }]),
  wherePredicates: Object.freeze([]),
});

const completionGenerics = Object.freeze({
  parameters: Object.freeze([
    { kind: "type" as const, name: "T", bounds: Object.freeze([]) },
    { kind: "type" as const, name: "TNormal", bounds: Object.freeze([]) },
  ]),
  wherePredicates: Object.freeze([]),
});

function resultType(value: RustType): RustType {
  return namedType(programResultName, [value]);
}

function completionType(value: RustType, normal: RustType): RustType {
  return namedType("Completion", [value, normal]);
}

function binding(name: string): RustPattern {
  return { kind: "binding", name };
}

function tupleVariant(path: string, ...elements: readonly RustPattern[]): RustPattern {
  return { kind: "tuple-variant", path, elements };
}

function call(path: string, ...args: readonly RustExpr[]): RustExpr {
  return { kind: "call", path, args };
}

function path(name: string): RustExpr {
  return { kind: "path", path: name };
}

export function planRustProgramErrorModule(
  input: RustPlanningContext,
  domain: import("../../../target-model/records/errors/source-package-errors.js").RustSourcePackageErrorDomainPlan,
): RustSourceFileModel | undefined {
  if (domain.forwardModulePath !== undefined) {
    return createRustSourceFile([{
      kind: "use", visibility: "public", path: `${domain.forwardModulePath}::*`,
    }]);
  }
  if (domain.errorDomain !== "project") return undefined;
  const emission = input.program.records.programErrorModule.get(domain.componentId);
  if (emission === undefined) failRustPlannerInvariant("An admitted program error domain requires its complete sealed native module payload.");
  const exactProjectVariants = emission.projects.map(project => Object.freeze({
    definition: project.definition, variant: project.name, type: namedType(project.typePath),
    representation: project.representation, delegate: project.delegate,
  }));
  const externalVariants = domain.externalErrors.map(external => Object.freeze({
    ...external, type: namedType(external.typePath),
  }));
  const providerErrorTypes = emission.providerErrors.map(carrier => {
    const type = rustTypeFromCarrier(carrier);
    if (type === undefined) failRustPlannerInvariant("An admitted provider error carrier requires its finalized standalone native syntax.");
    return type;
  });
  const selectedVariants = planRustErrorVariants(input.program, domain);
  if (selectedVariants === undefined) failRustPlannerInvariant("An admitted program error transport requires its sealed native variant inventory.");
  const nativeProjectVariants = exactProjectVariants.map(project => ({
    name: project.variant, type: project.type, representation: project.representation,
  }));
  const closedVariants: RustErrorTransportVariant[] = [];
  const projectVariantByDefinition = new Map(exactProjectVariants.map(variant => [variant.definition, variant] as const));
  const transportVariants: RustErrorTransportVariant[] = [];
  for (const selected of selectedVariants) {
    if (selected.kind === "project") {
      const variant = projectVariantByDefinition.get(selected.definition);
      if (variant === undefined) failRustPlannerInvariant("An admitted project error variant requires its selected native payload.", selected.definition.declaration);
      transportVariants.push({ name: selected.name, type: variant.type,
        source: selected.sourceError ? "error" : "thrown" });
    } else if (selected.kind === "external") {
      transportVariants.push({ name: selected.name, type: namedType(selected.external.typePath), source: "external", transport: "package",
        sourceErrorType: namedType(`${selected.external.typePath.slice(0, -programErrorName.length)}SourceError`),
        writableSourceErrorType: namedType(`${selected.external.typePath.slice(0, -programErrorName.length)}WritableSourceError`) });
    } else if (selected.kind === "closed") {
      const path = emission.closedPayloadPaths.get(selected.name);
      if (path === undefined) failRustPlannerInvariant("An admitted closed error variant requires its exact native payload path.");
      const variant = { name: selected.name, source: "thrown" as const, type: namedType(path) };
      closedVariants.push(variant);
      transportVariants.push(variant);
    } else {
      transportVariants.push({ name: selected.name, type: namedType("tsonic_rust_runtime::RetainedError"), source: "external", transport: "retained",
        sourceErrorType: namedType("tsonic_rust_runtime::RetainedError"),
        writableSourceErrorType: namedType("tsonic_rust_runtime::WritableRetainedError") });
    }
  }
  const transport = planRustErrorTransport(transportVariants);
  if (transport === undefined) failRustPlannerInvariant("An admitted error transport requires its exact native syntax declaration.");
  const items: RustItem[] = [
    {
      kind: "use",
      visibility: "public",
      path: "tsonic_rust_runtime::*",
    },
    transport.declaration,
    ...transport.aliases,
    {
      kind: "type-alias",
      name: programResultName,
      visibility: "public",
      generics: oneTypeParameterGenerics,
      target: namedType("Result", [typeParameterT, programErrorType]),
    },
    fromImplementation(runtimeErrorType, "Runtime", false),
    { kind: "impl", generics: emptyRustGenerics,
      trait: namedType("core::convert::From", [namedType("core::convert::Infallible")]), target: programErrorType,
      members: [{ kind: "function", name: "from", visibility: "private", generics: emptyRustGenerics,
        params: [{ name: "value", type: namedType("core::convert::Infallible") }], returnType: programErrorType,
        body: { statements: [{ kind: "tail", expr: { kind: "match", expression: path("value"), arms: [] } }] } }],
    },
    fromImplementation(runtimeJsErrorType, "Runtime", true),
    fromImplementation(namedType("tsonic_rust_runtime::MutableJsError"), "SourceCreated", false),
    ...providerErrorTypes.map((type) => fromImplementation(type, "Runtime", true)),
    ...exactProjectVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    ...externalVariants.map(({ variant, type }) =>
      fromImplementation(type, variant, false)),
    ...transport.variants.filter(variant => variant.name === "Retained").map(variant =>
      fromImplementation(variant.type, variant.name, false)),
    ...planRustClosedThrowAdmission(closedVariants),
    planRustNativeValueProjections([...closedVariants.map(variant => variant.name),
      ...externalVariants.map(variant => variant.variant)], nativeProjectVariants.map(variant => ({
      name: variant.name, type: variant.type, representation: variant.representation!,
    }))),
    displayImplementation(programErrorType, emptyRustGenerics, [
      ...exactProjectVariants.map(({ variant, delegate }) => ({ variant, delegate })),
      ...externalVariants.map(({ variant }) => ({ variant, delegate: true })),
      ...transport.variants.filter(variant => variant.name === "Retained").map(({ name }) => ({ variant: name, delegate: true })),
      ...closedVariants.map(({ name }) => ({ variant: name, delegate: false })),
    ]),
    debugImplementation(programErrorType, emptyRustGenerics),
    {
      kind: "impl",
      generics: emptyRustGenerics,
      trait: namedType("core::error::Error"),
      target: programErrorType,
      members: [],
    },
    sourceStringImplementation(programErrorType, emptyRustGenerics),
    planRustSuppressedErrorConstructor(),
    planRustErrorObservations(transport),
    ...planRustSourceErrorTransport(transport),
    ...planRustSourceErrorTransport(transport, true),
    ...planRustSourceErrorObservations(transport),
    ...planRustSourceErrorObservations(transport, true),
    ...planRustRetainedErrorAdmission(transport),
    ...planRustErrorProjectionTransport(transport),
    ...planRustSourceErrorProjectionDelegates(),
    finishResourceFunction(),
  ];
  return createRustSourceFile(items);
}

function fromImplementation(
  source: RustType,
  variant: string,
  wrapRuntime: boolean,
): RustItem {
  const value = path("value");
  const payload = wrapRuntime
    ? call("tsonic_rust_runtime::TsonicError::from", value)
    : value;
  return {
    kind: "impl",
    generics: emptyRustGenerics,
    trait: namedType("core::convert::From", [source]),
    target: programErrorType,
    members: [{ kind: "function",
      name: "from",
      visibility: "private",
      generics: emptyRustGenerics,
      params: [{ name: "value", type: source }],
      returnType: namedType("Self"),
      body: {
        statements: [{
          kind: "tail",
          expr: call(`Self::${variant}`, payload),
        }],
      },
    }],
  };
}

function displayImplementation(target: RustType, generics: RustGenerics, projectVariants: readonly {
  readonly variant: string;
  readonly delegate: boolean;
}[]): RustItem {
  const formatterType: RustType = {
    kind: "reference",
    mutable: true,
    referent: {
      kind: "named",
      path: "core::fmt::Formatter",
      genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
    },
  };
  return {
    kind: "impl",
    generics,
    trait: namedType("core::fmt::Display"),
    target,
    members: [{ kind: "function",
      name: "fmt",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [{ name: "formatter", type: formatterType }],
      returnType: namedType("core::fmt::Result"),
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "match",
            expression: path("self"),
            arms: [
              displayDelegateArm("Self::Runtime"),
              displayDelegateArm("Self::SourceCreated"),
              ...projectVariants.map(({ variant, delegate }) => delegate
                ? displayDelegateArm(`Self::${variant}`)
                : {
                    pattern: tupleVariant(`Self::${variant}`, { kind: "wildcard" }),
                    expression: {
                      kind: "method-call" as const,
                      receiver: path("formatter"),
                      method: "write_str",
                      args: [{ kind: "str-literal" as const, value: "[object Object]" }],
                    },
                  }),
              {
                pattern: rustSuppressedErrorPattern(
                  false,
                  binding("error"),
                  binding("suppressed"),
                  { kind: "wildcard" },
                ),
                expression: {
                  kind: "format-write",
                  writer: path("formatter"),
                  format: "SuppressedError: {}; suppressed: {}",
                  args: [path("error"), path("suppressed")],
                },
              },
            ],
          },
        }],
      },
    }],
  };
}

function displayDelegateArm(variant: string): {
  readonly pattern: RustPattern;
  readonly expression: RustExpr;
} {
  return {
    pattern: tupleVariant(variant, binding("value")),
    expression: call("core::fmt::Display::fmt", path("value"), path("formatter")),
  };
}

function debugImplementation(target: RustType, generics: RustGenerics): RustItem {
  return {
    kind: "impl",
    generics,
    trait: namedType("core::fmt::Debug"),
    target,
    members: [{ kind: "function",
      name: "fmt",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [{
        name: "formatter",
        type: {
          kind: "reference",
          mutable: true,
          referent: {
            kind: "named",
            path: "core::fmt::Formatter",
            genericArguments: [{ kind: "lifetime", lifetime: { kind: "placeholder" } }],
          },
        },
      }],
      returnType: namedType("core::fmt::Result"),
      body: {
        statements: [{
          kind: "tail",
          expr: call("core::fmt::Display::fmt", path("self"), path("formatter")),
        }],
      },
    }],
  };
}

function sourceStringImplementation(target: RustType, generics: RustGenerics): RustItem {
  return {
    kind: "impl",
    generics,
    trait: namedType("tsonic_rust_runtime::ToSourceString"),
    target,
    members: [{ kind: "function",
      name: "to_source_string",
      visibility: "private",
      generics: emptyRustGenerics,
      selfParam: { kind: "reference", mutable: false },
      params: [],
      returnType: { kind: "string" },
      body: {
        statements: [{
          kind: "tail",
          expr: {
            kind: "method-call",
            receiver: path("self"),
            method: "to_string",
            args: [],
          },
        }],
      },
    }],
  };
}

function finishResourceFunction(): RustItem {
  const completion = completionType(typeParameterT, typeParameterNormal);
  return {
    kind: "function",
    name: "finish_resource",
    visibility: "public",
    attrs: [rustHiddenAttribute],
    generics: completionGenerics,
    params: [
      { name: "body", type: resultType(completion) },
      { name: "cleanup", type: resultType(unitType) },
    ],
    returnType: resultType(completion),
    body: {
      statements: [{
        kind: "tail",
        expr: {
          kind: "match",
          expression: { kind: "tuple-literal", elements: [path("body"), path("cleanup")] },
          arms: [
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Ok", binding("completion")),
                  tupleVariant("Ok", { kind: "path", path: "()" }),
                ],
              },
              expression: call("Ok", path("completion")),
            },
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Ok", { kind: "wildcard" }),
                  tupleVariant("Err", binding("error")),
                ],
              },
              expression: call("Err", path("error")),
            },
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Err", binding("error")),
                  tupleVariant("Ok", { kind: "path", path: "()" }),
                ],
              },
              expression: call("Err", path("error")),
            },
            {
              pattern: {
                kind: "tuple",
                elements: [
                  tupleVariant("Err", binding("suppressed")),
                  tupleVariant("Err", binding("error")),
                ],
              },
              expression: call(
                "Err",
                call(
                  "TsonicError::suppressed",
                  path("error"),
                  path("suppressed"),
                ),
              ),
            },
          ],
        },
      }],
    },
  };
}
