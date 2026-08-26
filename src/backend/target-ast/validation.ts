import type {
  RustAssociatedConstItem,
  RustAssociatedTypeItem,
  RustExternFunction,
  RustGenerics,
  RustGenericArgument,
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
  RustStructFields,
  RustTraitFunction,
  RustType,
  RustTypeBound,
} from "./nodes.js";

export function validateRustSourceFileModel(model: RustSourceFileModel): void {
  const names = new Set<string>();
  for (const item of model.items) {
    const name = itemName(item);
    if (name !== undefined) {
      const key = `${item.kind}\0${name}`;
      if (names.has(key)) throw new Error(`Rust source model declares duplicate ${item.kind} '${name}'.`);
      names.add(key);
    }
    validateItem(item);
  }
}

function validateItem(item: RustItem): void {
  switch (item.kind) {
    case "function":
      validateCallable(item, `function '${item.name}'`);
      validateGenerics(item.generics, `function '${item.name}'`);
      validateCallableTypes(item, `function '${item.name}'`);
      return;
    case "trait":
      if (item.auto && (item.generics.parameters.length !== 0 ||
        item.generics.wherePredicates.length !== 0 || item.superTraits.length !== 0 ||
        item.functions.length !== 0 || item.associatedTypes.length !== 0 ||
        item.associatedConstants.length !== 0)) {
        throw new Error(`Rust auto trait '${item.name}' cannot declare generics, supertraits, or associated items.`);
      }
      validateGenerics(item.generics, `trait '${item.name}'`);
      item.superTraits.forEach((bound) => validateTypeBound(bound, `trait '${item.name}'`));
      validateDistinctNames(item.functions, `trait '${item.name}' function`);
      validateDistinctNames(item.associatedTypes, `trait '${item.name}' associated type`);
      validateDistinctNames(item.associatedConstants, `trait '${item.name}' associated constant`);
      item.functions.forEach((fn) => validateTraitFunction(fn, item.name));
      item.associatedTypes.forEach((associated) => validateAssociatedType(associated, false, item.name));
      item.associatedConstants.forEach((constant) => validateAssociatedConstant(constant, false, item.name));
      return;
    case "impl":
      if (item.trait === undefined && (item.polarity === "negative" || item.safety === "unsafe")) {
        throw new Error("A Rust inherent implementation cannot be negative or unsafe.");
      }
      if (item.polarity === "negative" && (item.functions.length !== 0 ||
        item.associatedTypes.length !== 0 || item.associatedConstants.length !== 0)) {
        throw new Error("A Rust negative trait implementation cannot contain associated items.");
      }
      validateGenerics(item.generics, "implementation");
      validateType(item.target, "implementation target");
      if (item.trait !== undefined) validateType(item.trait, "implementation trait");
      validateDistinctNames(item.functions, "implementation function");
      validateDistinctNames(item.associatedTypes, "implementation associated type");
      validateDistinctNames(item.associatedConstants, "implementation associated constant");
      item.functions.forEach((fn) => validateImplFunction(fn, item.trait !== undefined));
      item.associatedTypes.forEach((associated) => validateAssociatedType(associated, true, "implementation"));
      item.associatedConstants.forEach((constant) => validateAssociatedConstant(constant, true, "implementation"));
      return;
    case "extern-block":
      if (item.abi === "Rust") throw new Error("A Rust extern block requires a non-Rust ABI.");
      validateDistinctNames(item.functions, `extern '${item.abi}' function`);
      validateDistinctNames(item.statics, `extern '${item.abi}' static`);
      item.functions.forEach((fn) => validateExternFunction(fn, item.abi));
      item.statics.forEach((entry) => validateType(entry.type, `extern static '${entry.name}'`));
      return;
    case "union":
      if (item.fields.length === 0) throw new Error(`Rust union '${item.name}' requires at least one field.`);
      validateGenerics(item.generics, `union '${item.name}'`);
      validateDistinctNames(item.fields, `union '${item.name}' field`);
      item.fields.forEach((field) => validateType(field.type, `union '${item.name}' field '${field.name}'`));
      return;
    case "struct":
      validateGenerics(item.generics, `struct '${item.name}'`);
      validateStructFields(item.fields, `struct '${item.name}'`, true);
      return;
    case "enum":
      validateGenerics(item.generics, `enum '${item.name}'`);
      validateDistinctNames(item.variants, `enum '${item.name}' variant`);
      item.variants.forEach((variant) => {
        validateStructFields(variant.fields, `enum variant '${item.name}::${variant.name}'`, false);
        if (variant.discriminant !== undefined) {
          validateConstExpression(variant.discriminant, `enum variant '${item.name}::${variant.name}'`);
        }
      });
      return;
    case "type-alias":
      validateGenerics(item.generics, `type alias '${item.name}'`);
      validateType(item.target, `type alias '${item.name}'`);
      return;
    case "const":
    case "static":
    case "thread-local":
      validateType(item.type, `${item.kind} '${item.name}'`);
      return;
    case "mod-decl":
    case "use":
      return;
  }
}

function validateCallable(
  fn: Pick<RustImplFunction | RustTraitFunction, "name" | "isAsync" | "abi" | "variadic">,
  label: string,
): void {
  if (fn.variadic === true && (fn.abi === undefined || fn.abi === "Rust" || fn.isAsync === true)) {
    throw new Error(`Rust ${label} is variadic without a non-Rust synchronous ABI.`);
  }
}

function validateTraitFunction(fn: RustTraitFunction, owner: string): void {
  validateCallable(fn, `trait function '${owner}::${fn.name}'`);
  validateGenerics(fn.generics, `trait function '${owner}::${fn.name}'`);
  validateCallableTypes(fn, `trait function '${owner}::${fn.name}'`);
}

function validateImplFunction(fn: RustImplFunction, traitImplementation: boolean): void {
  validateCallable(fn, `implementation function '${fn.name}'`);
  if (traitImplementation && fn.visibility !== "private") {
    throw new Error(`Rust trait implementation function '${fn.name}' cannot declare visibility.`);
  }
  validateGenerics(fn.generics, `implementation function '${fn.name}'`);
  validateCallableTypes(fn, `implementation function '${fn.name}'`);
}

function validateExternFunction(fn: RustExternFunction, abi: string): void {
  if (fn.generics.parameters.length !== 0 || fn.generics.wherePredicates.length !== 0) {
    throw new Error(`Rust extern function '${fn.name}' in ABI '${abi}' cannot declare generic parameters.`);
  }
  fn.params.forEach((parameter) => validateType(parameter.type, `extern function '${fn.name}' parameter '${parameter.name}'`));
  if (fn.returnType !== undefined) validateType(fn.returnType, `extern function '${fn.name}' result`);
}

function validateAssociatedType(
  item: RustAssociatedTypeItem,
  implementation: boolean,
  owner: string,
): void {
  if (implementation && item.value === undefined) {
    throw new Error(`Rust associated type implementation '${owner}::${item.name}' has no value.`);
  }
  validateGenerics(item.generics, `associated type '${owner}::${item.name}'`);
  item.bounds.forEach((bound) => validateTypeBound(bound, `associated type '${owner}::${item.name}'`));
  if (item.value !== undefined) validateType(item.value, `associated type '${owner}::${item.name}' value`);
}

function validateAssociatedConstant(
  item: RustAssociatedConstItem,
  implementation: boolean,
  owner: string,
): void {
  if (implementation && item.value === undefined) {
    throw new Error(`Rust associated constant implementation '${owner}::${item.name}' has no value.`);
  }
  validateType(item.type, `associated constant '${owner}::${item.name}'`);
}

function validateCallableTypes(
  fn: {
    readonly params: readonly { readonly name: string; readonly type: RustType }[];
    readonly returnType?: RustType;
    readonly errorType?: RustType;
    readonly receiver?: import("./nodes.js").RustReceiver;
  },
  label: string,
): void {
  validateDistinctNames(fn.params, `${label} parameter`);
  if (fn.receiver?.kind === "typed") validateType(fn.receiver.type, `${label} receiver`);
  fn.params.forEach((parameter) => validateType(
    parameter.type,
    `${label} parameter '${parameter.name}'`,
    "argument",
  ));
  if (fn.returnType !== undefined) validateType(fn.returnType, `${label} result`, "return");
  if (fn.errorType !== undefined) validateType(fn.errorType, `${label} error`);
}

function validateGenerics(generics: RustGenerics, label: string): void {
  const lifetimeNames = new Set<string>();
  const typeAndConstNames = new Set<string>();
  let valueParameterSeen = false;
  for (const parameter of generics.parameters) {
    if (parameter.kind === "lifetime") {
      if (valueParameterSeen) {
        throw new Error(`Rust ${label} declares lifetime parameter '${parameter.name}' after a type or const parameter.`);
      }
      if (lifetimeNames.has(parameter.name)) {
        throw new Error(`Rust ${label} declares duplicate lifetime parameter '${parameter.name}'.`);
      }
      lifetimeNames.add(parameter.name);
      continue;
    }
    valueParameterSeen = true;
    if (typeAndConstNames.has(parameter.name)) {
      throw new Error(`Rust ${label} declares duplicate type or const parameter '${parameter.name}'.`);
    }
    typeAndConstNames.add(parameter.name);
    if (parameter.kind === "type") {
      parameter.bounds.forEach((bound) => validateTypeBound(bound, `${label} parameter '${parameter.name}'`));
      if (parameter.defaultType !== undefined) {
        validateType(parameter.defaultType, `${label} parameter '${parameter.name}' default`);
      }
    } else {
      validateType(parameter.type, `${label} const parameter '${parameter.name}'`);
      if (parameter.defaultValue !== undefined) {
        validateConstExpression(parameter.defaultValue, `${label} const parameter '${parameter.name}' default`);
      }
    }
  }
  for (const predicate of generics.wherePredicates) {
    if (predicate.kind === "lifetime") {
      if (predicate.outlives.length === 0) {
        throw new Error(`Rust ${label} has a lifetime where predicate without an outlives bound.`);
      }
      continue;
    }
    if (predicate.bounds.length === 0) {
      throw new Error(`Rust ${label} has a type where predicate without a bound.`);
    }
    validateType(predicate.type, `${label} where predicate`);
    predicate.bounds.forEach((bound) => validateTypeBound(bound, `${label} where predicate`));
  }
}

function validateStructFields(fields: RustStructFields, label: string, visibilityAllowed: boolean): void {
  if (fields.kind === "unit") return;
  if (fields.kind === "named") validateDistinctNames(fields.fields, `${label} field`);
  fields.fields.forEach((field, index) => {
    if (!visibilityAllowed && field.visibility !== "private") {
      throw new Error(`Rust ${label} field ${index} cannot declare visibility.`);
    }
    validateType(field.type, `${label} field ${index}`);
  });
}

type RustOpaqueTypePosition = "argument" | "return" | "unavailable";

function validateType(
  type: RustType,
  label: string,
  opaquePosition: RustOpaqueTypePosition = "unavailable",
): void {
  switch (type.kind) {
    case "infer":
    case "primitive":
    case "string":
    case "str":
    case "unit":
    case "never":
      return;
    case "named":
      type.genericArguments?.forEach((argument) => validateGenericArgument(argument, label));
      return;
    case "qualified":
      validateType(type.owner, label);
      if (type.trait !== undefined) validateType(type.trait, label);
      type.genericArguments?.forEach((argument) => validateGenericArgument(argument, label));
      return;
    case "trait-object":
      if (type.bounds.length === 0) throw new Error(`Rust ${label} has an empty trait-object bound set.`);
      if (type.bounds.some((bound) => bound.kind === "precise-capture")) {
        throw new Error(`Rust ${label} places a precise-capture bound outside an opaque type.`);
      }
      type.bounds.forEach((bound) => validateTypeBound(bound, label));
      return;
    case "opaque": {
      const captureBounds = type.bounds.filter((bound) => bound.kind === "precise-capture");
      const ordinaryBounds = type.bounds.filter((bound) => bound.kind !== "precise-capture");
      if (opaquePosition === "unavailable") {
        throw new Error(`Rust ${label} places an opaque type outside a callable argument or result.`);
      }
      if (opaquePosition === "argument" && captureBounds.length !== 0) {
        throw new Error(`Rust ${label} places a precise-capture bound on an argument-position opaque type.`);
      }
      if (opaquePosition === "return" && captureBounds.length !== 1) {
        throw new Error(`Rust ${label} must have exactly one precise-capture bound.`);
      }
      if (!ordinaryBounds.some((bound) => bound.kind === "trait" || bound.kind === "callable-trait")) {
        throw new Error(`Rust ${label} opaque type has no trait bound.`);
      }
      type.bounds.forEach((bound) => validateTypeBound(
        bound,
        label,
        opaquePosition === "return",
      ));
      return;
    }
    case "reference":
      validateType(type.referent, label);
      return;
    case "raw-pointer":
      validateType(type.pointee, label);
      return;
    case "fixed-array":
      validateType(type.element, label);
      validateConstExpression(type.length, label);
      return;
    case "slice":
      validateType(type.element, label);
      return;
    case "function-pointer":
      if (type.variadic === true && (type.abi === undefined || type.abi === "Rust")) {
        throw new Error(`Rust ${label} has a variadic function pointer without a non-Rust ABI.`);
      }
      type.parameters.forEach((parameter) => validateType(parameter, label));
      validateType(type.result, label);
      return;
    case "tuple":
      if (type.elements.length === 0) {
        throw new Error(`Rust ${label} uses an empty tuple type instead of the canonical unit type.`);
      }
      type.elements.forEach((element) => validateType(element, label));
      return;
  }
}

function validateTypeBound(
  bound: RustTypeBound,
  label: string,
  preciseCaptureAllowed = false,
): void {
  switch (bound.kind) {
    case "lifetime":
      return;
    case "trait":
      validateType(bound.trait, label);
      return;
    case "callable-trait":
      bound.parameters.forEach((parameter) => validateType(parameter, label));
      validateType(bound.result, label);
      return;
    case "precise-capture":
      if (!preciseCaptureAllowed) {
        throw new Error(`Rust ${label} places a precise-capture bound outside an opaque type.`);
      }
      validatePreciseCaptures(bound.captures, label);
      return;
  }
}

function validatePreciseCaptures(
  captures: readonly RustGenericArgument[],
  label: string,
): void {
  const names = new Set<string>();
  let reachedNonLifetime = false;
  for (const capture of captures) {
    let name: string;
    if (capture.kind === "lifetime") {
      if (reachedNonLifetime || capture.lifetime.kind === "static") {
        throw new Error(`Rust ${label} has an invalid precise lifetime capture.`);
      }
      name = capture.lifetime.kind === "named" ? `'${capture.lifetime.name}` : "'_";
    } else if (capture.kind === "type" && capture.type.kind === "named" &&
      capture.type.genericArguments === undefined && !capture.type.path.includes("::")) {
      reachedNonLifetime = true;
      name = capture.type.path;
    } else if (capture.kind === "const" && capture.expression.kind === "path" &&
      capture.expression.genericArguments === undefined && !capture.expression.path.includes("::")) {
      reachedNonLifetime = true;
      name = capture.expression.path;
    } else {
      throw new Error(`Rust ${label} has a non-parameter precise capture.`);
    }
    if (names.has(name)) throw new Error(`Rust ${label} repeats precise capture '${name}'.`);
    names.add(name);
  }
}

function validateGenericArgument(argument: RustGenericArgument, label: string): void {
  switch (argument.kind) {
    case "lifetime":
      return;
    case "type":
      validateType(argument.type, label);
      return;
    case "const":
      validateConstExpression(argument.expression, label);
      return;
    case "associated-equality":
      argument.genericArguments?.forEach((generic) => validateGenericArgument(generic, label));
      validateType(argument.type, label);
      return;
    case "associated-bounds":
      if (argument.bounds.length === 0) throw new Error(`Rust ${label} has an empty associated-type bound.`);
      argument.genericArguments?.forEach((generic) => validateGenericArgument(generic, label));
      argument.bounds.forEach((bound) => validateTypeBound(bound, label));
      return;
  }
}

function validateConstExpression(
  expression: import("./nodes.js").RustConstExpression,
  label: string,
): void {
  switch (expression.kind) {
    case "integer":
    case "boolean":
    case "character":
    case "inferred":
      return;
    case "path":
      expression.genericArguments?.forEach((argument) => validateGenericArgument(argument, label));
      return;
    case "unary":
      validateConstExpression(expression.operand, label);
      return;
    case "binary":
      validateConstExpression(expression.left, label);
      validateConstExpression(expression.right, label);
      return;
  }
}

function validateDistinctNames(
  entries: readonly { readonly name: string }[],
  label: string,
): void {
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`Rust source model declares duplicate ${label} '${entry.name}'.`);
    names.add(entry.name);
  }
}

function itemName(item: RustItem): string | undefined {
  switch (item.kind) {
    case "function":
    case "const":
    case "static":
    case "thread-local":
    case "mod-decl":
    case "struct":
    case "trait":
    case "enum":
    case "union":
    case "type-alias":
      return item.name;
    case "extern-block":
    case "impl":
    case "use":
      return undefined;
  }
}
