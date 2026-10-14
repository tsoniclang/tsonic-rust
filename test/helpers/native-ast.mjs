import assert from "node:assert/strict";

export function nativeNodes(root, predicate) {
  const pending = [root];
  const visited = new Set();
  const matches = [];
  while (pending.length !== 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (predicate(value)) matches.push(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
  }
  return matches;
}

export function nativeSource(result, path = "src/index.rs") {
  assert.equal(result.plan !== undefined, true, "a successful native plan is required");
  const artifacts = result.plan.artifacts.filter(artifact => artifact.path === path && artifact.kind === "source");
  assert.equal(artifacts.length, 1, `one native source model: ${path}`);
  return artifacts[0].model;
}

export function nativeFunction(result, name, path = "src/index.rs") {
  const source = nativeSource(result, path);
  const topLevel = source.items.filter(node => node.kind === "function" && node.name === name);
  const functions = topLevel.length === 0
    ? nativeNodes(source, node => node.kind === "function" && node.name === name)
    : topLevel;
  assert.equal(functions.length, 1, `one native function: ${path}:${name}`);
  return functions[0];
}

export function nativeCalls(root, path) {
  return nativeNodes(root, node => node.kind === "call" && node.path === path);
}

export function nativeMethods(root, method) {
  return nativeNodes(root, node => node.kind === "method-call" && node.method === method);
}

export function nativeScopedBinding(root, invocation, name) {
  assert.equal(typeof name, "string", "a checked native binding name is required");
  const scopes = nativeMethods(root, "with").filter(scope =>
    scope.args[0]?.params[0]?.name === name &&
    nativeNodes(scope.args[0], node => node === invocation).length === 1);
  assert.equal(scopes.length, 1, `one exact native scope for ${name}`);
  return scopes[0];
}

export function nativeDispatchBinding(result, root, invocation, name, carrier) {
  const scope = nativeScopedBinding(root, invocation, name);
  const declarations = nativeSource(result, "src/program.rs").items.filter(item =>
    item.kind === "thread-local" && scope.receiver.path === `crate::program::${item.name}`);
  assert.equal(declarations.length, 1, "the exact scope resolves one published dispatch owner");
  assert.equal(declarations[0].type.path, carrier, "the native argument comes from its declared context carrier");
  assert.deepEqual(declarations[0].value, { kind: "call", path: `${carrier}::new`, args: [] });
  assert.equal(declarations[0].constInitializer, true);
  return scope;
}

export function assertNoNativeCalls(root, paths, label) {
  const forbidden = new Set(paths);
  assert.equal(nativeNodes(root, node =>
    (node.kind === "call" && forbidden.has(node.path)) ||
    (node.kind === "method-call" && forbidden.has(node.method)) ||
    (node.kind === "associated-call" && forbidden.has(`${node.owner.path}::${node.method}`))
  ).length, 0, label);
}

export function nativeType(name) {
  if (name === "String") return { kind: "string" };
  if (name === "str") return { kind: "str" };
  if (name === "()") return { kind: "unit" };
  return { kind: "primitive", name };
}

export function nativeBorrow(referent, lifetime) {
  return { kind: "reference", referent, mutable: false,
    ...(lifetime === undefined ? {} : { lifetime }),
  };
}

export function nativeCallableContract(result, name, index, parameters, output) {
  const callable = nativeFunction(result, name);
  let type = callable.params[index].type;
  if (type.kind === "named" && type.path === "Option") type = type.genericArguments[0].type;
  const implementation = type.kind === "reference" ? type.referent : type;
  const parameter = callable.generics.parameters.find(value => value.kind === "type" && value.name === implementation.path);
  assert.equal(parameter !== undefined, true, "the exact implementation has a native generic owner");
  const bounds = parameter.bounds.filter(bound => bound.kind === "trait-type");
  assert.equal(bounds.length, 1, "one selected callable protocol");
  const protocol = bounds[0].reference.trait;
  const declarationName = protocol.path.split("::").at(-1);
  const protocols = nativeSource(result).items.filter(item => item.kind === "trait" && item.name === declarationName);
  assert.equal(protocols.length, 1, "the native callable protocol is declared exactly once");
  const invoke = protocols[0].members.filter(member => member.kind === "function" && member.name === "invoke");
  assert.equal(invoke.length, 1);
  assert.deepEqual(invoke[0].params.map(value => value.type), parameters, "exact native callable input widths");
  assert.equal(invoke[0].returnType.path, "Result");
  assert.deepEqual(invoke[0].returnType.genericArguments[0].type, output, "exact native callable result");
  assert.deepEqual(callable.errorType, { kind: "qualified", owner: implementation, trait: protocol, member: "InvocationError" },
    "the invocation propagates the selected implementation's exact error channel");
  return callable;
}
