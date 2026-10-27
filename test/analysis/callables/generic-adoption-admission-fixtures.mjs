import assert from "node:assert/strict";

import { compileRust } from "../../helpers/rust-session.mjs";

import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";

import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

import { sourceNodeIdentity } from "@tsonic/target-api/source";


function diagnosticSummary(result, source) {
  const ast = source.ast;
  return JSON.stringify(result.diagnostics.map(({ code, message, sourceNode, evidence }) => {
    const file = sourceNode === undefined ? undefined : ast.getSourceFile(sourceNode);
    return { code, message, evidence: evidence?.map(value => value.slice(0, 2048)), node: sourceNodeIdentity(ast, sourceNode),
      text: file === undefined ? undefined : Buffer.from(ast.getSourceText(file))
        .subarray(ast.pos(sourceNode), ast.end(sourceNode)).toString("utf8").trim().slice(0, 160) };
  }));
}


const code = "TSONIC_GENERIC_ASYNC_ADOPTION_UNSUPPORTED";

const identity = "async function identity<Value>(value: Value) { return value; }";


const nativeEntryCases = [
  [
    "sync-forEach-capture",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    [0].forEach(() => { resolve(value); });\n  });\n}"
  ],
  [
    "deferred-then-capture",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    void Promise.resolve(0).then(() => { resolve(value); });\n  });\n}"
  ],
  [
    "deferred-catch-capture",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    void Promise.reject<void>(new Error(\"seed\")).catch(() => { resolve(value); });\n  });\n}"
  ],
  [
    "deferred-finally-capture",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    void Promise.resolve(0).finally(() => { resolve(value); });\n  });\n}"
  ],
  [
    "deferred-PromiseLike-capture",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    const pending: PromiseLike<number> = Promise.resolve(0);\n    void pending.then(() => { resolve(value); });\n  });\n}"
  ],
  [
    "native-direct-resolver",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => { [value].forEach(resolve); });\n}"
  ],
  [
    "native-callback-parameter",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => { [value].forEach(actual => { resolve(actual); }); });\n}"
  ],
  [
    "aliased-callback-and-resolver",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    const done = resolve;\n    const callback = (): void => { done(value); };\n    const alias = callback;\n    [0].forEach(alias);\n  });\n}"
  ],
  [
    "finite-returned-callback",
    "function delivery<Part>(done: (value: Part) => void, value: Part): () => void {\n  return () => { done(value); };\n}\nfunction wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => { [0].forEach(delivery(resolve, value)); });\n}"
  ],
  [
    "source-helper-to-native-entry",
    "function invoke(callback: () => void): void { [0].forEach(callback); }\nfunction wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => { invoke(() => { resolve(value); }); });\n}"
  ],
  [
    "two-native-levels",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    [0].forEach(() => { void Promise.resolve(0).then(() => { resolve(value); }); });\n  });\n}"
  ],
  [
    "native-source-recursive-SCC",
    "function deliver<Part>(done: (value: Part) => void, value: Part, depth: number): void {\n  if (depth === 0) { done(value); return; }\n  [0].forEach(() => { deliver(done, value, depth - 1); });\n}\nfunction wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => { deliver(resolve, value, 2); });\n}"
  ],
  [
    "finite-callback-alternatives",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    const first = (): void => { resolve(value); };\n    const second = (): void => { resolve(value); };\n    const callback = value === value ? first : second;\n    [0].forEach(callback);\n  });\n}"
  ],
  [
    "both-native-then-ports",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    const callback = (): void => { resolve(value); };\n    void Promise.resolve(0).then(callback, callback);\n  });\n}"
  ]
];


nativeEntryCases.push(...[
  [
    "map-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].map(actual => { resolve(actual); return 0; }); }); }"
  ],
  [
    "filter-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].filter(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "some-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].some(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "every-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].every(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "find-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].find(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "findLast-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].findLast(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "findIndex-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].findIndex(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "findLastIndex-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].findLastIndex(actual => { resolve(actual); return true; }); }); }"
  ],
  [
    "reduce-element-not-accumulator",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value].reduce((accumulator, actual) => { resolve(actual); return accumulator; }, 0); }); }"
  ],
  [
    "sort-two-element-inputs",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [value, value].sort((left, right) => { resolve(left); resolve(right); return 0; }); }); }"
  ],
  [
    "Array-from-actual-input0-mapper1",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { Array.from([value], actual => { resolve(actual); return 0; }); }); }"
  ],
  [
    "readonly-array-element",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values: ReadonlyArray<Value> = [value]; values.forEach(actual => { resolve(actual); }); }); }"
  ],
  [
    "Map-native-input-type-bound",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values = new Map<number, Value>([[0, value]]); values.forEach(actual => { resolve(actual); }); }); }"
  ],
  [
    "ReadonlyMap-native-input-type-bound",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values: ReadonlyMap<number, Value> = new Map<number, Value>([[0, value]]); values.forEach(actual => { resolve(actual); }); }); }"
  ],
  [
    "Set-native-input-type-bound",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values = new Set<Value>([value]); values.forEach(actual => { resolve(actual); }); }); }"
  ],
  [
    "ReadonlySet-native-input-type-bound",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values: ReadonlySet<Value> = new Set<Value>([value]); values.forEach(actual => { resolve(actual); }); }); }"
  ],
  [
    "TypedArray-captured-generic-resolver",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { new Int32Array([0, 1]).sort((left, right) => { void left; void right; resolve(value); return 0; }); }); }"
  ],
  [
    "optional-absent-fulfilled",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { void Promise.reject<number>(new Error(\"seed\")).then(undefined, () => { resolve(value); }); }); }"
  ]
]);


nativeEntryCases.push(...[
  [
    "deferred-captured-payload-location",
    "function wrap<Value>(value: Value): Promise<Value | number> {\n  return new Promise<Value | number>(resolve => {\n    let selected: Value | number = 7;\n    void Promise.resolve(0).then(() => { resolve(selected); });\n    selected = value;\n  });\n}"
  ],
  [
    "deferred-captured-resolver-location",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    let done: (actual: Value) => void = actual => { void actual; };\n    void Promise.resolve(0).then(() => { done(value); });\n    done = resolve;\n  });\n}"
  ],
  [
    "native-callback-actual-default",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    const values: (Value | undefined)[] = [undefined];\n    values.forEach((actual = value) => { resolve(actual); });\n  });\n}"
  ],
  [
    "stored-pending-native-entry",
    "function wrap<Value>(value: Value): Promise<Value> {\n  const pending = new Promise<Value>(resolve => {\n    const saved = (): void => { resolve(value); };\n    void Promise.resolve(0).then(saved);\n  });\n  return pending;\n}"
  ]
]);


nativeEntryCases.push(...[
  [
    "generic-native-callback-checked-input-bound",
    "function wrap<Value>(value: Value): Promise<Value> {\n  return new Promise<Value>(resolve => {\n    function deliver<Actual extends Value>(actual: Actual): void { resolve(actual); }\n    [value].forEach(deliver);\n  });\n}"
  ]
]);


nativeEntryCases.push(...[
  [
    "authored-this-native-input",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { function deliver(this: void, actual: Value): void { resolve(actual); } [value].forEach(deliver); }); }"
  ],
  [
    "tuple-rest-native-input",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { function deliver(...items: [actual: Value, index: number]): void { resolve(items[0]); } [value].forEach(deliver); }); }"
  ],
  [
    "destructured-tuple-native-component",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const rows: [Value][] = [[value]]; rows.forEach(([actual]) => { resolve(actual); }); }); }"
  ],
  [
    "authored-this-source-helper",
    "function deliver<Part>(this: void, done: (value: Part) => void, value: Part): void { done(value); }\nfunction wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { deliver(resolve, value); }); }"
  ],
  [
    "tuple-rest-source-helper",
    "function deliver<Part>(...items: [done: (value: Part) => void, value: Part]): void { items[0](items[1]); }\nfunction wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { deliver(resolve, value); }); }"
  ],
  [
    "native-element-source-invocation",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [() => { resolve(value); }].forEach(callback => { callback(); }); }); }"
  ],
  [
    "native-element-forwarded-native-callback",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { [() => { resolve(value); }].forEach(callback => { [0].forEach(callback); }); }); }"
  ],
  [
    "aliased-finite-native-element-candidates",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const first = (): void => { resolve(value); }; const second = (): void => { resolve(value); }; const original = [first, second]; const copied = original; copied.forEach(callback => { callback(); }); }); }"
  ],
  [
    "native-default-actual-undefined",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { void Promise.resolve(undefined).then((actual: Value | undefined = value) => { if (actual !== undefined) resolve(actual); else resolve(value); }); }); }"
  ],
  [
    "official-nested-constructor-executor",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(outer => { const nested = new Promise<void>(inner => { outer(value); inner(undefined); }); void nested; }); }"
  ],
  [
    "authored-this-constructor-executor",
    "function wrap<Value>(value: Value): Promise<Value> { function execute(this: void, done: (actual: Value | PromiseLike<Value>) => void): void { done(value); } return new Promise<Value>(execute); }"
  ],
  [
    "tuple-rest-constructor-executor",
    "function wrap<Value>(value: Value): Promise<Value> { function execute(...inputs: [done: (actual: Value | PromiseLike<Value>) => void]): void { inputs[0](value); } return new Promise<Value>(execute); }"
  ]
]);

nativeEntryCases.push(...[
  ["native-object-field-callable", "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const item = { callback: (): void => { resolve(value); } }; [item].forEach(actual => { actual.callback(); }); }); }"],
  ["native-class-field-callable", "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { class Holder { callback = (): void => { resolve(value); }; } [new Holder()].forEach(actual => { actual.callback(); }); }); }"],
  ["native-returned-element-callable", "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { function make(): () => void { return () => { resolve(value); }; } [make()].forEach(actual => { actual(); }); }); }"]
]);


const nativeEntryInverses = [
  [
    "non-resolving-native-observer",
    "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    [0].forEach(() => { void value; });\n    resolve(7);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "non-resolving-deferred-observer",
    "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    void Promise.resolve(0).then(() => { void value; });\n    resolve(7);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "same-helper-ordinary-and-resolver-correlated",
    "function deliver<Part>(callback: (value: Part) => void, value: Part): void {\n  [0].forEach(() => { callback(value); });\n}\nfunction wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    const observe = (actual: Value): void => { void actual; };\n    deliver(observe, value);\n    deliver(resolve, 7);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "same-helper-ordinary-and-resolver-correlated-reversed",
    "function deliver<Part>(callback: (value: Part) => void, value: Part): void {\n  [0].forEach(() => { callback(value); });\n}\nfunction wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    const observe = (actual: Value): void => { void actual; };\n    deliver(resolve, 7);\n    deliver(observe, value);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "same-source-two-created-callbacks",
    "function make<Part>(callback: (value: Part) => void, value: Part): () => void {\n  return () => { callback(value); };\n}\nfunction wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    const first = make((actual: Value): void => { void actual; }, value);\n    const second = make(resolve, 7);\n    [0].forEach(first);\n    [0].forEach(second);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "callback-signature-alone-does-not-prove-resolver",
    "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => {\n    const observer = (actual: Value): void => { void actual; };\n    [value].forEach(observer);\n    resolve(7);\n  });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ]
];

nativeEntryInverses.push(...[
  [
    "reduce-accumulator-remains-number",
    "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => { [value].reduce((accumulator, actual) => { void actual; resolve(accumulator); return accumulator; }, 7); });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "sort-callback-never-resolves-captured-Value",
    "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => { [1, 2].sort((left, right) => { void value; resolve(left + right + 4); return 0; }); });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "Array-from-mapper-is-not-iterable-Value",
    "function wrap<Value>(value: Value): Promise<number> {\n  return new Promise<number>(resolve => { Array.from([0], actual => { void value; resolve(actual + 7); return 0; }); });\n}\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ]
]);

nativeEntryInverses.push(...[
  [
    "authored-this-index-not-element",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { function deliver(this: void, actual: Value, index: number): void { void actual; resolve(index + 7); } [value].forEach(deliver); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "tuple-rest-index-not-element",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { function deliver(...items: [actual: Value, index: number]): void { void items[0]; resolve(items[1] + 7); } [value].forEach(deliver); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "required-native-input-excludes-this-default",
    "function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { function deliver(this: void, actual: Value | number = value): void { resolve(actual); } [7].forEach(deliver); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "native-element-observer-resolver-correlation",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { const observe = (): void => { void value; }; const done = (): void => { resolve(7); }; [observe, done].forEach(callback => { callback(); }); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "native-element-observer-resolver-correlation-reversed",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { const observe = (): void => { void value; }; const done = (): void => { resolve(7); }; [done, observe].forEach(callback => { [0].forEach(callback); }); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "native-element-unused-callback",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { [() => { void value; }].forEach(callback => { void callback; }); resolve(7); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ],
  [
    "authored-this-nonresolver",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { function observe(this: void, actual: Value): void { void actual; } [value].forEach(observe); resolve(7); }); }\nconsole.log(await wrap(Promise.resolve(5)));\n"
  ]
]);

nativeEntryInverses.push(...[
  ["known-source-ignored-callable", "function ignore(callback: () => void): () => void { void callback; return () => {}; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { [ignore(() => { resolve(value); })].forEach(actual => { actual(); }); resolve(7); }); } console.log(await wrap(Promise.resolve(5)));"],
  ["opaque-map-unused-callable", "function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const values = new Map<number, () => void>([[0, () => { resolve(value); }]]); values.forEach(actual => { void actual; }); resolve(7); }); } console.log(await wrap(Promise.resolve(5)));"],
  ["opaque-set-nonresolving-callable", "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => { const values = new Set<() => void>([() => { void value; }]); values.forEach(actual => { actual(); }); resolve(7); }); } console.log(await wrap(Promise.resolve(5)));"]
]);


nativeEntryInverses.push(...[
  [
    "opaque-set-returned-observer-keeps-union-nonadoption",
    "function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { done(value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const observer = make((actual: Value): void => { void actual; }, value); const completion = make(resolve, 7); new Set([observer]).forEach(next => { next(); }); completion(); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-set-returned-observer-keeps-union-nonadoption-reversed",
    "function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { done(value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const observer = make((actual: Value): void => { void actual; }, value); const completion = make(resolve, 7); completion(); new Set([observer]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-set-factory-callee-is-not-returned-payload",
    "function make<Value>(value: Value, done: (actual: number) => void): () => void { done(7); return () => { void value; }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const observer = make(value, resolve); new Set([observer]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-set-factory-callee-is-not-returned-payload-alias",
    "function make<Value>(value: Value, done: (actual: number) => void): () => void { done(7); return () => { void value; }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const original = make(value, resolve); const observer = original; new Set([observer]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ]
]);


nativeEntryInverses.push(...[
  [
    "opaque-source-helper-demand-context",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { next(); }); send(resolve, 7); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-source-helper-demand-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); send(resolve, 7); new Set([payload]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-source-helper-chain-demand-context",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function forward<Part>(done: (value: Part) => void, value: Part): void { send(done, value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { forward(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { next(); }); send(resolve, 7); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-source-helper-chain-demand-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function forward<Part>(done: (value: Part) => void, value: Part): void { send(done, value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { forward(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); send(resolve, 7); new Set([payload]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-native-forwarded-helper-demand-context",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { [0].forEach(next); }); send(resolve, 7); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-native-forwarded-helper-demand-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); send(resolve, 7); new Set([payload]).forEach(next => { [0].forEach(next); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-default-helper-demand-context",
    "function send<Part>(done: (value: Part) => void, value: Part, actual: Part = value): void { done(actual); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { next(); }); send(resolve, 7); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-default-helper-demand-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part, actual: Part = value): void { done(actual); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); send(resolve, 7); new Set([payload]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-component-helper-demand-context",
    "function send<Part>(done: (value: Part) => void, input: { payload: Part }): void { done(input.payload); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, { payload: value }); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { next(); }); send(resolve, { payload: 7 }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-component-helper-demand-context-reversed",
    "function send<Part>(done: (value: Part) => void, input: { payload: Part }): void { done(input.payload); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, { payload: value }); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); send(resolve, { payload: 7 }); new Set([payload]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-recursive-helper-demand-context",
    "function send<Part>(done: (value: Part) => void, value: Part, depth: number): void { if (depth > 0) send(done, value, depth - 1); else done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value, 1); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { next(); }); send(resolve, 7, 1); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-recursive-helper-demand-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part, depth: number): void { if (depth > 0) send(done, value, depth - 1); else done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value, 1); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); send(resolve, 7, 1); new Set([payload]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-receiver-helper-demand-context",
    "class Relay<Part> { constructor(readonly done: (value: Part) => void, readonly value: Part) {} run(): void { this.done(this.value); } } function make<Part>(done: (value: Part) => void, value: Part): () => void { const relay = new Relay(done, value); return () => { relay.run(); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Set([payload]).forEach(next => { next(); }); new Relay(resolve, 7).run(); }); } console.log(await wrap(Promise.resolve(5)));"
  ],
  [
    "opaque-receiver-helper-demand-context-reversed",
    "class Relay<Part> { constructor(readonly done: (value: Part) => void, readonly value: Part) {} run(): void { this.done(this.value); } } function make<Part>(done: (value: Part) => void, value: Part): () => void { const relay = new Relay(done, value); return () => { relay.run(); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make((actual: Value): void => { void actual; }, value); new Relay(resolve, 7).run(); new Set([payload]).forEach(next => { next(); }); }); } console.log(await wrap(Promise.resolve(5)));"
  ]
]);

const nativeOpaquePayloadCases = [
["map-callable-payload","function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values = new Map<number, () => void>([[0, () => { resolve(value); }]]); values.forEach(actual => { actual(); }); }); }","resolve(value)"],
["set-callable-payload","function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { const values = new Set<() => void>([() => { resolve(value); }]); values.forEach(actual => { actual(); }); }); }","resolve(value)"],
["set-returned-adopter-actual-creation","function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { done(value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const observer = make((actual: number): void => { void actual; }, 7); const completion = make(resolve, value); new Set([completion]).forEach(next => { next(); }); observer(); }); }","done(value)"],
["set-returned-adopter-actual-creation-reversed","function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { done(value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const observer = make((actual: number): void => { void actual; }, 7); const completion = make(resolve, value); observer(); new Set([completion]).forEach(next => { next(); }); }); }","done(value)"]
];


nativeOpaquePayloadCases.push(...[
  [
    "opaque-source-helper-adopting-context",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { next(); }); send((actual: number): void => { void actual; }, 7); }); }",
    "done(value)"
  ],
  [
    "opaque-source-helper-adopting-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); send((actual: number): void => { void actual; }, 7); new Set([payload]).forEach(next => { next(); }); }); }",
    "done(value)"
  ],
  [
    "opaque-source-helper-chain-adopting-context",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function forward<Part>(done: (value: Part) => void, value: Part): void { send(done, value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { forward(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { next(); }); send((actual: number): void => { void actual; }, 7); }); }",
    "done(value)"
  ],
  [
    "opaque-source-helper-chain-adopting-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function forward<Part>(done: (value: Part) => void, value: Part): void { send(done, value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { forward(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); send((actual: number): void => { void actual; }, 7); new Set([payload]).forEach(next => { next(); }); }); }",
    "done(value)"
  ],
  [
    "opaque-native-forwarded-helper-adopting-context",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { [0].forEach(next); }); send((actual: number): void => { void actual; }, 7); }); }",
    "done(value)"
  ],
  [
    "opaque-native-forwarded-helper-adopting-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part): void { done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); send((actual: number): void => { void actual; }, 7); new Set([payload]).forEach(next => { [0].forEach(next); }); }); }",
    "done(value)"
  ],
  [
    "opaque-default-helper-adopting-context",
    "function send<Part>(done: (value: Part) => void, value: Part, actual: Part = value): void { done(actual); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { next(); }); send((actual: number): void => { void actual; }, 7); }); }",
    "done(actual)"
  ],
  [
    "opaque-default-helper-adopting-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part, actual: Part = value): void { done(actual); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); send((actual: number): void => { void actual; }, 7); new Set([payload]).forEach(next => { next(); }); }); }",
    "done(actual)"
  ],
  [
    "opaque-component-helper-adopting-context",
    "function send<Part>(done: (value: Part) => void, input: { payload: Part }): void { done(input.payload); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, { payload: value }); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { next(); }); send((actual: number): void => { void actual; }, { payload: 7 }); }); }",
    "done(input.payload)"
  ],
  [
    "opaque-component-helper-adopting-context-reversed",
    "function send<Part>(done: (value: Part) => void, input: { payload: Part }): void { done(input.payload); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, { payload: value }); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); send((actual: number): void => { void actual; }, { payload: 7 }); new Set([payload]).forEach(next => { next(); }); }); }",
    "done(input.payload)"
  ],
  [
    "opaque-recursive-helper-adopting-context",
    "function send<Part>(done: (value: Part) => void, value: Part, depth: number): void { if (depth > 0) send(done, value, depth - 1); else done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value, 1); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { next(); }); send((actual: number): void => { void actual; }, 7, 1); }); }",
    "done(value)"
  ],
  [
    "opaque-recursive-helper-adopting-context-reversed",
    "function send<Part>(done: (value: Part) => void, value: Part, depth: number): void { if (depth > 0) send(done, value, depth - 1); else done(value); } function make<Part>(done: (value: Part) => void, value: Part): () => void { return () => { send(done, value, 1); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); send((actual: number): void => { void actual; }, 7, 1); new Set([payload]).forEach(next => { next(); }); }); }",
    "done(value)"
  ],
  [
    "opaque-receiver-helper-adopting-context",
    "class Relay<Part> { constructor(readonly done: (value: Part) => void, readonly value: Part) {} run(): void { this.done(this.value); } } function make<Part>(done: (value: Part) => void, value: Part): () => void { const relay = new Relay(done, value); return () => { relay.run(); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Set([payload]).forEach(next => { next(); }); new Relay((actual: number): void => { void actual; }, 7).run(); }); }",
    "this.done(this.value)"
  ],
  [
    "opaque-receiver-helper-adopting-context-reversed",
    "class Relay<Part> { constructor(readonly done: (value: Part) => void, readonly value: Part) {} run(): void { this.done(this.value); } } function make<Part>(done: (value: Part) => void, value: Part): () => void { const relay = new Relay(done, value); return () => { relay.run(); }; } function wrap<Value>(value: Value): Promise<Value | number> { return new Promise<Value | number>(resolve => { const payload = make(resolve, value); new Relay((actual: number): void => { void actual; }, 7).run(); new Set([payload]).forEach(next => { next(); }); }); }",
    "this.done(this.value)"
  ]
]);


const nativeConstructorCases = [
  [
    "direct-executor",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => { resolve(value); }); }"
  ],
  [
    "nested-executor",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(outer => { const nested = new Promise<void>(inner => { outer(value); inner(undefined); }); void nested; }); }"
  ],
  [
    "named-this-nested-executor",
    "function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(outer => { function execute(this: void, inner: (value: void | PromiseLike<void>) => void): void { outer(value); inner(undefined); } const nested = new Promise<void>(execute); void nested; }); }"
  ]
];

const nativeConstructorInverses = [
  [
    "nested-nonresolver",
    "function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(done => { const nested = new Promise<void>(inner => { void value; inner(undefined); }); void nested; done(7); }); }\nif ((await wrap(Promise.resolve(5))) !== 7) throw new Error(\"native constructor nonresolver\");"
  ],
  [
    "foreign-same-named-constructor",
    "namespace Foreign { export class PromiseConstructor<Part> { constructor(execute: (resolve: (actual: Part) => void) => void) { void execute; } } }\nfunction wrap<Value>(value: Value): number { const other = new Foreign.PromiseConstructor<Value>(resolve => { resolve(value); }); void other; return 7; }\nif (wrap(Promise.resolve(5)) !== 7) throw new Error(\"foreign constructor identity\");"
  ]
];

function sourcePosition(ast, node, finish = false) {
  const bytes = Buffer.from(ast.getSourceText(ast.getSourceFile(node)));
  const leading = /^[\t\n\v\f\r ]*/u.exec(bytes.subarray(ast.pos(node), ast.end(node)).toString("utf8"))[0];
  const position = finish ? ast.end(node) : ast.pos(node) + Buffer.byteLength(leading);
  const lines = bytes.subarray(0, position).toString("utf8").split(/\r\n|\r|\n/u);
  return { line: lines.length, column: [...lines.at(-1)].length + 1 };
}

function sourceSpan(ast, node) {
  const start = sourcePosition(ast, node);
  const finish = sourcePosition(ast, node, true);
  return { fileName: "index.ts", ...start, endLine: finish.line, endColumn: finish.column };
}

function rejected(compilation, text, kind, declarationName) {
  assertRejectedAsyncSource(compilation, [{ code, kind, text }]);
  const { ast } = compilation.source;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  compilation.source.sourceFiles.filter(file => file !== undefined && !ast.isDeclarationFile(file)).forEach(visit);
  const issue = compilation.result.diagnostics[0];
  assert.deepEqual(issue.sourceSpan, sourceSpan(ast, issue.sourceNode), "the original instantiation has its exact canonical source span");
  assert.equal(issue.evidence.length, 2, "exactly two related locations, with the signed capability in the code and message");
  for (const [index, label] of ["declaration", "first-sensitive-operation"].entries()) {
    const candidates = nodes.filter(node => {
      const position = sourcePosition(ast, node);
      return `${label} index.ts:${position.line}:${position.column}` === issue.evidence[index];
    });
    assert.equal(candidates.length > 0, true, `${label}: exact related original source coordinates`);
    if (label === "declaration") assert.equal(candidates.some(node => nodes.some(parameter =>
      ast.is.IsTypeParameterDeclaration(parameter) && ast.parent(parameter) === node) &&
      (declarationName === undefined || ast.text(ast.name(node)) === declarationName)), true,
    "the related declaration owns the actual selected generic binder");
  }
  return issue;
}

const cases = [
  ["direct", identity, "identity"],
  ["forward-await", `${identity}\nasync function outer<Value>(value: Value): Promise<void> { await identity(value); }`, "outer"],
  ["forward-local", `${identity}\nasync function outer2<Value>(value: Value): Promise<number> { const result = await identity(value); return 0; }`, "outer2"],
  ["forward-discard", `${identity}\nfunction sync<Value>(value: Value): void { void identity(value); }`, "sync"],
  ["forward-pending", `async function later<Value>(value: Value, pending: Promise<void>) { await pending; return value; }
    async function outer3<Value>(value: Value): Promise<void> { await later(value, Promise.resolve(undefined)); }`, "outer3"],
  ["resolve", "function wrap<Value>(value: Value): void { void Promise.resolve(value); }", "wrap"],
  ["promise-like-reaction", `function likeReaction<Value>(value: Value): void {
    const pending: PromiseLike<number> = Promise.resolve(0); void pending.then(() => value);
  }`, "likeReaction"],
  ["named-executor", `function namedExecutor<Value>(value: Value) {
    function execute(resolve: (value: Value | PromiseLike<Value>) => void): void { resolve(value); }
    return new Promise<Value>(execute);
  }`, "namedExecutor"],
  ["resolver-helper", `function helper<Value>(value: Value) { return new Promise<Value>(resolve => {
    function deliver(callback: (value: Value) => void): void { callback(value); } deliver(resolve);
  }); }`, "helper"],
  ["generic-resolver-helper", `function deliver<Part>(callback: (value: Part) => void, value: Part): void { callback(value); }
    function helper<Value>(value: Value) { return new Promise<Value>(resolve => deliver(resolve, value)); }`, "helper"],
  ["member-resolver", `function helper<Value>(value: Value) { return new Promise<Value>(resolve => {
    const cell = { done: resolve }; const alias = cell.done; alias(value);
  }); }`, "helper"],
  ["typed-returned-executor", `type Executor<Part> = (resolve: (value: Part | PromiseLike<Part>) => void) => void;
    function create<Part>(value: Part): Executor<Part> { return resolve => resolve(value); }
    function helper<Value>(value: Value) { return new Promise<Value>(create(value)); }`, "helper"],
  ["nested-return", "function make<Value>(value: Value): { read(): Promise<Value> } { return { async read(): Promise<Value> { return value; } }; }", "make"],
  ["called-nested", "function consume<Value>(value: Value) { async function inner() { return value; } return inner(); }", "consume"],
  ["hoisted-call", "function consume<Value>(value: Value) { return inner(); async function inner() { return value; } }", "consume"],
  ["returned-arrow", "function consume<Value>(value: Value) { return async () => value; }", "consume"],
  ["stored-arrow", "function consume<Value>(value: Value) { const queue: (() => Promise<Value>)[] = []; const later = async () => value; queue.push(later); }", "consume"],
  ["invoked-arrow", "function consume<Value>(value: Value) { return (async () => value)(); }", "consume"],
  ["overloaded", "function identity2<Value>(value: Value): Promise<Value>; async function identity2<Value>(value: Value): Promise<Value> { return value; }", "identity2"],
];

export {
  diagnosticSummary,
  code,
  identity,
  nativeEntryCases,
  nativeEntryInverses,
  nativeOpaquePayloadCases,
  nativeConstructorCases,
  nativeConstructorInverses,
  sourcePosition,
  sourceSpan,
  rejected,
  cases,
};
