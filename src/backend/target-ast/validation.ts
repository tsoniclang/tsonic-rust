import type {
  RustAssociatedConstItem,
  RustAssociatedTypeItem,
  RustExternFunction,
  RustImplFunction,
  RustItem,
  RustSourceFileModel,
  RustTraitFunction,
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
      return;
    case "trait":
      if (item.auto && (item.generics.parameters.length !== 0 ||
        item.generics.wherePredicates.length !== 0 || item.superTraits.length !== 0 ||
        item.functions.length !== 0 || item.associatedTypes.length !== 0 ||
        item.associatedConstants.length !== 0)) {
        throw new Error(`Rust auto trait '${item.name}' cannot declare generics, supertraits, or associated items.`);
      }
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
      item.functions.forEach((fn) => validateImplFunction(fn, item.trait !== undefined));
      item.associatedTypes.forEach((associated) => validateAssociatedType(associated, true, "implementation"));
      item.associatedConstants.forEach((constant) => validateAssociatedConstant(constant, true, "implementation"));
      return;
    case "extern-block":
      if (item.abi === "Rust") throw new Error("A Rust extern block requires a non-Rust ABI.");
      item.functions.forEach((fn) => validateExternFunction(fn, item.abi));
      return;
    case "union":
      if (item.fields.length === 0) throw new Error(`Rust union '${item.name}' requires at least one field.`);
      return;
    case "struct":
    case "enum":
    case "type-alias":
    case "const":
    case "static":
    case "thread-local":
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
}

function validateImplFunction(fn: RustImplFunction, traitImplementation: boolean): void {
  validateCallable(fn, `implementation function '${fn.name}'`);
  if (traitImplementation && fn.visibility !== "private") {
    throw new Error(`Rust trait implementation function '${fn.name}' cannot declare visibility.`);
  }
}

function validateExternFunction(fn: RustExternFunction, abi: string): void {
  if (fn.generics.parameters.length !== 0 || fn.generics.wherePredicates.length !== 0) {
    throw new Error(`Rust extern function '${fn.name}' in ABI '${abi}' cannot declare generic parameters.`);
  }
}

function validateAssociatedType(
  item: RustAssociatedTypeItem,
  implementation: boolean,
  owner: string,
): void {
  if (implementation && item.value === undefined) {
    throw new Error(`Rust associated type implementation '${owner}::${item.name}' has no value.`);
  }
}

function validateAssociatedConstant(
  item: RustAssociatedConstItem,
  implementation: boolean,
  owner: string,
): void {
  if (implementation && item.value === undefined) {
    throw new Error(`Rust associated constant implementation '${owner}::${item.name}' has no value.`);
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
