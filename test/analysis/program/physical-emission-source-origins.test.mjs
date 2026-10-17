import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";

const nativeSource = `
const seed: boolean = "seed".includes("s");
class Flags { static ready: boolean = "ready".includes("r"); }
export function contains(text: string): boolean { return text.includes("value") && seed && Flags.ready; }
`;

const callableSource = `
type Identity = <Value>(value: Value) => Value;
function make(text: string): Identity {
  return <Value>(value: Value): Value => { text.includes("value"); return value; };
}
export function choose(flag: boolean): number {
  const first = make("first");
  const second = make("second");
  const selected = flag ? first : second;
  return selected(1);
}
`;

const constructorSource = `
class Base {
  initial: boolean = "base".includes("b");
  constructor(text: string) { text.includes("seed"); }
}
class Item extends Base {
  field: boolean = "own".includes("w");
  constructor(text: string) { super(text); text.includes("value"); }
}
class Leaf { ready: boolean = "leaf".includes("l"); }
class Other {
  field: boolean;
  constructor(text: string) { this.field = text.includes("other") && new Leaf().ready; }
}
type Identity = <Value>(value: Value) => Value;
function create(): Identity {
  return <Value>(value: Value): Value => { new Other("known"); return value; };
}
export function value(text: string): boolean {
  const first = new Other(text);
  const second = new Item(text);
  const invoke = create();
  return invoke(first.field && second.field);
}
`;

function observed(text, verify) {
  const preparationUrl = new URL("../../../dist/analysis/callables/emission-contexts.js", import.meta.url).href;
  const originUrl = new URL("../../../dist/analysis/callables/emission-source-origins.js", import.meta.url).href;
  const helperUrl = new URL("../../helpers/rust-session.mjs", import.meta.url).href;
  const key = "r14-physical-emission-source-origins";
  const script = `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { targetUseSiteRef } from "@tsonic/target-api/analysis";
const observations = { preparations: [], factories: [], sourceQueries: [], nativeRows: [], anchors: 0, published: false };
globalThis[Symbol.for(${JSON.stringify(key)})] = observations;
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  if (url !== ${JSON.stringify(preparationUrl)} && url !== ${JSON.stringify(originUrl)}) return loaded;
  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
  const name = url === ${JSON.stringify(preparationUrl)} ? "prepareRustEmissionContextRequests" : "createRustEmissionSourceOriginPreparation";
  const anchor = "export function " + name + "(";
  assert.equal(source.split(anchor).length, 2, name + ": one exact observation anchor");
  observations.anchors++;
  const extension = name === "prepareRustEmissionContextRequests"
    ? 'export function prepareRustEmissionContextRequests(input, requests) { const result = observedPrepare(input, requests); globalThis[Symbol.for(${JSON.stringify(key)})].preparations.push({input, requests, result}); return result; }'
    : 'export function createRustEmissionSourceOriginPreparation(input, requests) { const observations = globalThis[Symbol.for(${JSON.stringify(key)})]; observations.factories.push({input, requests}); const sourceStorage = new Proxy(input.sourceStorage, {get(target, key, receiver) { const value = Reflect.get(target, key, receiver); if (typeof value !== "function") return value; return (...args) => { assert.equal(observations.published, false, "published A must not query source storage"); const result = Reflect.apply(value, target, args); observations.sourceQueries.push({key, args, result}); return result; }; }}); return observedPrepare({...input, sourceStorage, genericBindingsFor(declaration, bindings) { assert.equal(observations.published, false, "published A must not select native binding rows"); const result = input.genericBindingsFor(declaration, bindings); observations.nativeRows.push({declaration, bindings, result}); return result; }}, requests); }';
  return { ...loaded, source: source.replace(anchor, "function observedPrepare(") + "\\n" + extension };
} });
const { analyzeRust } = await import(${JSON.stringify(helperUrl)});
const { createRustEmissionSourceOriginPreparation } = await import(${JSON.stringify(originUrl)});
const { program } = analyzeRust({ surfaces: ["js"], target: {id: "rust", options: {outputType: "lib"}}, files: {
  "index.ts": ${JSON.stringify(text)},
} });
assert.equal(observations.anchors, 2, "both complete real-pipeline observation anchors were used");
(${verify.toString()})(program, observations, createRustEmissionSourceOriginPreparation);
observations.published = true;
const queryCount = observations.sourceQueries.length;
const nativeCount = observations.nativeRows.length;
for (const context of program.physicalEmissionContexts.contexts) {
  assert.equal(Object.isFrozen(context) && Object.isFrozen(context.sourceOrigins), true, "source origins are sealed data");
  for (const origins of context.sourceOrigins) {
    assert.equal(program.physicalEmissionContexts.sourceOriginFor(context.use, origins.occurrence) === origins, true,
      "the exact context/occurrence lookup retains the identical admitted source row");
    assert.equal(Object.isFrozen(origins), true, "each published source-origin row is immutable");
    assert.equal(program.physicalEmissionContexts.sourceOriginFor({...context.use}, origins.occurrence) === undefined, true,
      "a copied context cannot recover another context's source evidence");
    assert.equal(program.physicalEmissionContexts.sourceOriginFor(context.use, {...origins.occurrence}) === undefined, true,
      "a copied occurrence cannot recover another occurrence's source evidence");
    assert.equal(program.physicalEmissionContexts.sourceFor(origins.occurrence.node, {...origins.occurrence.operation}) === undefined, true,
      "an equal-shaped operation is not the identical admitted operation");
    const foreign = targetUseSiteRef(origins.occurrence, context.use.role, "foreign-source-origin-context");
    assert.equal(program.physicalEmissionContexts.sourceOriginFor(foreign, origins.occurrence) === undefined, true,
      "a foreign context with an identical original occurrence is absent");
  }
}
assert.equal(observations.sourceQueries.length, queryCount, "public readers perform no source query after publication");
assert.equal(observations.nativeRows.length, nativeCount, "public readers perform no native selection after publication");
process.stdout.write("R14_INSTRUMENTED_SOURCE_ORIGIN_PROOF");
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `instrumented source-origin proof: ${result.error?.message ?? ""}\n${result.stderr.slice(-8192)}\n${result.stdout.slice(-2048)}`);
  assert.equal(result.stdout, "R14_INSTRUMENTED_SOURCE_ORIGIN_PROOF", "explicit instrumented source-origin proof label");
}

function verifyNativeAndModule(program, observations) {
  const pairs = program.physicalEmissionContexts.contexts.flatMap(context => context.sourceOrigins.map(origins => ({context, origins})));
  const native = pairs.filter(({context}) => context.use.role === "native-body");
  const modules = pairs.filter(({context}) => context.use.role === "module-initializer");
  assert.equal(native.length > 0 && modules.length >= 2, true, "real native bodies, authored module code and static field code participate");
  for (const {context, origins} of native) {
    assert.equal(origins.kind, "resolved", "a native body's actual source declaration is selected");
    assert.equal(origins.subject.node === origins.occurrence.node && origins.subject.kind === "value" && origins.subject.projection.length === 0,
      true, "the original unprojected operation subject is retained");
    assert.equal(origins.alternatives.length > 0, true, "a native body's declaration activation is not invented empty");
    for (const origin of origins.alternatives) {
      assert.equal(origin.kind === "declaration" && origin.activation.kind === "declaration" &&
        origin.activation.declaration === context.declaration, true, "the actual declaration activation belongs to this exact body owner");
      assert.equal(observations.nativeRows.some(row => row.result.kind === "resolved" && row.result.sourceActivations.kind === "resolved" &&
        row.result.sourceActivations.rows.some(selected => selected.activation === origin.activation && selected.targetBindings === origin.targetBindings)),
      true, "native target bindings and source activation come from one original selected row");
    }
  }
  let staticRegions = 0;
  for (const {context, origins} of modules) {
    assert.equal(origins.kind, "resolved", "the actual authored module region has a lexical source context");
    for (const origin of origins.alternatives) {
      assert.equal(origin.kind, "module", "a module is never fabricated as a callable activation");
      assert.equal(origin.sourceFile === context.declaration && origin.module.sourceFile === context.declaration, true,
        "the original emitted module owner is retained independently of its execution region");
      assert.equal(origin.initializer.modules.includes(origin.module), true, "the same real selected initializer contains the same real module");
      assert.equal(observations.sourceQueries.some(query => query.key === "bindingsForLexicalOwner" &&
        query.args[0] === origins.occurrence.node && query.result === origin.selection), true,
      "module bindings are the actual source-scope owner's selected object");
      assert.equal(Object.hasOwn(origin, "activation"), false, "a SourceFile never masquerades as a native activation");
      if (origin.region !== origin.sourceFile) staticRegions++;
    }
  }
  assert.equal(staticRegions > 0, true, "a static initializer keeps its distinct source region without changing its module owner");
}

test("native declaration and module/static origins retain exact source bindings and original initialization membership", () => {
  observed(nativeSource, verifyNativeAndModule);
});

function verifyCallableOrigins(program, observations, create) {
  const actual = program.physicalEmissionContexts.contexts.filter(context => context.use.role === "body")
    .flatMap(context => context.sourceOrigins.map(origins => ({context, origins})));
  assert.equal(actual.length > 0, true, "the actual selected generic callable body contains an emitted provider operation");
  let distinctSources = false;
  let preservedUnavailable = false;
  for (const {context, origins} of actual) {
    assert.equal(origins.kind, "resolved", "the closed actual invocation domain remains closed");
    const alternatives = origins.alternatives;
    assert.equal(alternatives.length > 0, true, "the actual callable invocation retains its source execution");
    for (const origin of alternatives) {
      assert.equal(origin.kind === "callable" && origin.activation.declaration === context.declaration, true,
        "each original source execution owns the identical body declaration");
      assert.equal(observations.sourceQueries.some(query => query.key === "contributingExecutionsFor" &&
        query.args[0] === origins.subject && query.args[1] === context.declaration && query.args[2] === origin.producer &&
        query.result.kind !== "unresolved" && query.result.producers.includes(origin.execution)), true,
      "the exact original producer, unprojected subject and body owner are the shared query's real inputs");
      assert.equal(observations.nativeRows.some(row => row.bindings === origin.execution.bindings && row.result.kind === "resolved" &&
        row.result.sourceActivations.kind === "resolved" && row.result.sourceActivations.rows.some(selected =>
          selected.activation === origin.activation && selected.targetBindings === origin.targetBindings)), true,
      "the original source activation remains paired with its independently selected native bindings");
      if (alternatives.some(other => other.kind === "callable" && other.member === origin.member &&
        other.producer.bindings !== origin.producer.bindings)) distinctSources = true;
    }
    const original = observations.factories.find(factory => factory.requests.some(request => request.use === context.use));
    assert.equal(original !== undefined, true, "the actual late source association inputs are retained by observation");
    const request = original.requests.find(request => request.use === context.use);
    const foreignMember = {...request, source: {...request.source, member: Object.freeze({})}};
    const prepare = create(original.input, [foreignMember]);
    const missing = prepare(foreignMember, origins.occurrence);
    assert.equal(missing.kind, "unavailable", "a foreign admitted-member identity cannot fall back to the same native carrier");
    const foreign = program.sourceFiles[0];
    const wrongOwner = {...request, declaration: foreign};
    const rejected = create(original.input, [wrongOwner])(wrongOwner, origins.occurrence);
    assert.equal(rejected.kind, "unavailable", "a foreign demanded body owner is not repaired through native shape equality");
    const foreignOccurrence = {...origins.occurrence, node: Object.freeze({})};
    const absent = create(original.input, [request])(request, foreignOccurrence);
    assert.equal(absent.kind, "unavailable", "an unchecked source subject cannot be reconstructed from an occurrence's native operation");
    const storageWithForeignBindings = {...original.input.nativeStorage};
    for (const name of ["valueFor", "operandFor", "returnFor", "invocationCallableFor"]) {
      storageWithForeignBindings[name] = subject => {
        const selected = original.input.nativeStorage[name](subject);
        return selected.kind === "unresolved" ? selected : {...selected, sources: selected.sources.map(source => source.kind === "unresolved"
          ? source : {...source, producers: source.producers.map(row => ({...row, producer: {...row.producer,
            bindings: Object.freeze({...row.producer.bindings})}}))})};
      };
    }
    const foreignBindings = create({...original.input, nativeStorage: Object.freeze(storageWithForeignBindings)}, [request])(request, origins.occurrence);
    assert.equal(foreignBindings.kind, "unavailable", "an equal-shaped foreign source binding token cannot use the original native member as a fallback");
    const boundary = Object.freeze({kind: "opaque-result", subject: origins.subject, exposure: origins.occurrence.node,
      bindings: alternatives[0].producer.bindings});
    for (const [name, selected] of [
      ["resolved", Object.freeze({kind: "complete", producers: Object.freeze([])})],
      ["open", Object.freeze({kind: "open", producers: Object.freeze([]), boundaries: Object.freeze([boundary])})],
      ["unavailable", Object.freeze({kind: "unresolved", reason: "required source execution unavailable"})],
    ]) {
      let queries = 0;
      const sourceStorage = Object.freeze({...original.input.sourceStorage, contributingExecutionsFor(subject, owner, entry) {
        assert.equal(subject === origins.subject && owner === request.declaration && alternatives.some(origin => origin.producer === entry),
          true, name + ": the controlled result is injected only at the genuine original source query seam");
        queries++;
        return selected;
      }});
      const result = create({...original.input, sourceStorage}, [request])(request, origins.occurrence);
      assert.equal(queries > 0, true, name + ": the actual complete owner exercised the controlled source contract");
      assert.equal(result.kind, name, name + ": exact empty, open and unavailable remain different products");
      if (result.kind === "unavailable") assert.equal(result.reason, selected.reason, "unavailable retains the original exact refusal");
      else assert.equal(result.alternatives.length, 0, name + ": no fake activation fills an empty original execution set");
      if (result.kind === "open") assert.equal(result.boundaries.includes(boundary), true, "the exact controlled open boundary is retained");
    }
    const firstProducer = alternatives[0].producer;
    const retained = alternatives.find(origin => origin.producer !== firstProducer);
    if (retained !== undefined) {
      const sourceStorage = Object.freeze({...original.input.sourceStorage, contributingExecutionsFor(subject, owner, producer) {
        return producer === firstProducer ? Object.freeze({kind: "unresolved", reason: "one original source execution unavailable"})
          : original.input.sourceStorage.contributingExecutionsFor(subject, owner, producer);
      }});
      const partial = create({...original.input, sourceStorage}, [request])(request, origins.occurrence);
      assert.equal(partial.kind, "unavailable", "one unavailable source alternative remains an explicit unavailable product");
      assert.equal(partial.reason, "one original source execution unavailable", "the original unavailable reason is retained");
      assert.equal(partial.alternatives.some(origin => origin.kind === "callable" && origin.producer === retained.producer &&
        origin.member === retained.member && origin.execution === retained.execution && origin.activation === retained.activation &&
        origin.targetBindings === retained.targetBindings), true,
      "unavailable status retains every independently known original producer/execution/native row");
      preservedUnavailable = true;
    }
    const withoutSourceVector = Object.freeze({...original.input.nativeStorage, valueFor(subject) {
      const selected = original.input.nativeStorage.valueFor(subject);
      if (selected.kind === "unresolved") return selected;
      const {sources, ...removed} = selected;
      assert.equal(Array.isArray(sources), true, "the old-form control starts with a genuine complete source vector");
      return removed;
    }, operandFor(subject) {
      const selected = original.input.nativeStorage.operandFor(subject);
      if (selected.kind === "unresolved") return selected;
      const {sources, ...removed} = selected;
      assert.equal(Array.isArray(sources), true, "the old-form operand control starts with a genuine complete source vector");
      return removed;
    }});
    assert.throws(() => create({...original.input, nativeStorage: withoutSourceVector}, [request]),
      /complete original selection source vector/u, "the old source-less storage product is refused without a compatibility route");
  }
  assert.equal(distinctSources, true, "equal native member payloads retain both different original source creation bindings");
  assert.equal(preservedUnavailable, true, "the real distinct-source domain exercises partial unavailable status without dropping known alternatives");
}

test("equal-native callable members preserve every distinct original producer and bound activation before interning", () => {
  observed(callableSource, verifyCallableOrigins);
});

function verifyConstructorOrigins(program, observations, create) {
  const contexts = program.physicalEmissionContexts.contexts.filter(context => context.use.role === "constructor-layer");
  const rows = contexts.flatMap(context => context.sourceOrigins.flatMap(origins => {
    assert.equal(origins.kind, "resolved", "a checked source construction retains its original region selection");
    return origins.alternatives.map(origin => ({context, origins, origin}));
  }));
  assert.equal(rows.length > 0, true, "real constructor and instance-initializer provider operations retain source associations");
  let initialized = false;
  let forwarded = false;
  for (const {context, origins, origin} of rows) {
    assert.equal(origin.kind, "construction", "a constructor layer uses a construction selection, not a guessed callable frame");
    assert.equal(origin.owner === context.declaration || origin.construction.classes.some(selected => selected.owner === origin.owner), true,
      "the original body or class initializer owns the execution region");
    const implementation = origin.construction.implementation;
    assert.equal(implementation !== undefined && implementation.declaration === origin.owner &&
      implementation.regions.includes(origin.region) && implementation.selection === origin.selection ||
      origin.construction.classes.some(selected => selected.owner === origin.owner && selected.regions.some(region =>
        region.node === origin.region && region.selection === origin.selection)), true,
    "the exact original construction alternative supplies the identical original region and binding selection");
    assert.equal(observations.sourceQueries.some(query => query.key === "constructionFor" && query.args[0] === origin.invocation &&
      query.args[1] === origin.callerBindings && query.result.kind === "resolved" && query.result.alternatives.includes(origin.construction)), true,
    "actual invocation and original caller bindings select the actual cached construction alternative");
    assert.equal(observations.nativeRows.some(row => row.declaration === origin.owner && row.bindings === origin.selection.bindings &&
      row.result.kind === "resolved" && row.result.sourceActivations.kind === "resolved" && row.result.sourceActivations.rows.some(selected =>
        selected.activation === origin.activation && selected.targetBindings === origin.targetBindings)), true,
    "each selected activation retains its own native row without matching by equal native type");
    assert.equal(observations.sourceQueries.some(query => query.key === "enclosingRegionFor" && query.args[0] === origins.occurrence.node &&
      query.result === origin.region), true, "the actual provider occurrence belongs to the original selected source region");
    if (origin.construction.classes.some(selected => selected.regions.some(region => region.selection === origin.selection))) initialized = true;
    if (origin.caller.kind === "construction" && origin.root === origin.caller.root) forwarded = true;
  }
  assert.equal(initialized, true, "an actual instance-field initializer retains its class source scope");
  assert.equal(forwarded, true, "super construction retains the original allocation/root and actual caller activation");
  const distinct = rows.find(row => rows.some(other => other.origin.root.root !== row.origin.root.root));
  assert.equal(distinct !== undefined, true, "the real program contains independent original constructor roots");
  const failing = rows.find(row => row.origin.root.root !== distinct.origin.root.root && row.origin.owner !== distinct.origin.owner);
  assert.equal(failing !== undefined, true, "a separate actual constructor owner supplies the unavailable-origin control");
  const original = observations.factories.find(factory => factory.requests.some(request => request.use === distinct.context.use));
  assert.equal(original !== undefined, true, "the root isolation control uses complete actual late inputs");
  const request = original.requests.find(request => request.use === distinct.context.use);
  const isolated = create({...original.input, genericBindingsFor(declaration, bindings) {
    return declaration === failing.origin.owner ? Object.freeze({kind: "unresolved", reason: "separate constructor origin unavailable"})
      : original.input.genericBindingsFor(declaration, bindings);
  }}, original.requests)(request, distinct.origins.occurrence);
  assert.equal(isolated.kind, "resolved", "an unrelated root's unavailable origin cannot poison this original construction/region");
  assert.equal(isolated.alternatives.every(origin => origin.kind === "construction" && origin.root.root === distinct.origin.root.root), true,
    "failure isolation never replaces the successful root with an equal-native alternative");
  const selectedRequest = original.requests.find(request => request.use === failing.context.use);
  const affected = create({...original.input, genericBindingsFor(declaration, bindings) {
    return declaration === failing.origin.owner ? Object.freeze({kind: "unresolved", reason: "separate constructor origin unavailable"})
      : original.input.genericBindingsFor(declaration, bindings);
  }}, original.requests)(selectedRequest, failing.origins.occurrence);
  assert.equal(affected.kind, "unavailable", "only the actual affected constructor region retains its unavailable status");
  assert.equal(affected.reason, "separate constructor origin unavailable", "the unavailable region keeps its original selecting-owner reason");
  const callable = rows.find(row => row.origin.caller.kind === "callable");
  assert.equal(callable !== undefined, true, "a genuine selected generic callable supplies an actual construction caller");
  const callableRequest = original.requests.find(request => request.declaration === callable.origin.caller.activation.declaration &&
    request.source.kind === "callable" && request.demands.some(demand => demand.subject === callable.origin.invocation));
  assert.equal(callableRequest !== undefined, true, "the open-domain control starts at the real emitted callable request");
  const boundary = Object.freeze({kind: "opaque-result", subject: callable.origins.subject,
    exposure: callable.origin.invocation, bindings: callable.origin.caller.execution.bindings});
  const sourceStorage = Object.freeze({...original.input.sourceStorage, contributingExecutionsFor(subject, owner, producer) {
    const selected = original.input.sourceStorage.contributingExecutionsFor(subject, owner, producer);
    return owner !== callable.origin.caller.activation.declaration || selected.kind === "unresolved" ? selected
      : Object.freeze({kind: "open", producers: selected.producers, boundaries: Object.freeze([
        ...selected.kind === "open" ? selected.boundaries : [], boundary,
      ])});
  }});
  const prepareOpen = create({...original.input, sourceStorage}, original.requests);
  const openRequest = original.requests.find(request => request.use === callable.context.use);
  const opened = prepareOpen(openRequest, callable.origins.occurrence);
  assert.equal(opened.kind, "open", "an open caller remains open instead of becoming globally unavailable");
  assert.equal(opened.alternatives.some(origin => origin.kind === "construction" &&
    origin.invocation === callable.origin.invocation && origin.construction === callable.origin.construction &&
    origin.selection === callable.origin.selection && origin.activation === callable.origin.activation &&
    origin.targetBindings === callable.origin.targetBindings), true,
  "an open caller retains its known exact construction, source region and activation/native row");
  assert.equal(opened.boundaries.includes(boundary), true, "the original open caller boundary survives construction forwarding");
  const independent = rows.find(row => row.origin.root.root !== callable.origin.root.root && row.origin.caller.kind === "declaration");
  assert.equal(independent !== undefined, true, "the open-domain control includes an independent closed root");
  const independentRequest = original.requests.find(request => request.use === independent.context.use);
  const closed = prepareOpen(independentRequest, independent.origins.occurrence);
  assert.equal(closed.kind, "resolved", "an open source caller never contaminates an unrelated closed constructor root");
  const nested = rows.find(row => row.origin.caller.kind === "construction" &&
    row.origin.root.root !== callable.origin.root.root && row.origin.caller.root.root === callable.origin.root.root);
  assert.equal(nested !== undefined, true, "the real open source path contains a nested independent allocation");
  const nestedRequest = original.requests.find(request => request.use === nested.context.use);
  const nestedOpen = prepareOpen(nestedRequest, nested.origins.occurrence);
  assert.equal(nestedOpen.kind, "open", "open status follows the original actual caller into its nested allocation");
  assert.equal(nestedOpen.boundaries.includes(boundary), true, "a previously visited closed path cannot erase a later original open caller boundary");
  const reversed = create({...original.input, sourceStorage,
    emissionRequests: Object.freeze([...original.input.emissionRequests].reverse())}, Object.freeze([...original.requests].reverse()));
  const reversedOpen = reversed(openRequest, callable.origins.occurrence);
  const reversedClosed = reversed(independentRequest, independent.origins.occurrence);
  assert.equal(reversedOpen.kind, opened.kind, "reversing request enumeration preserves the affected root's status");
  assert.equal(reversedClosed.kind, closed.kind, "reversing request enumeration preserves the independent root's status");
  assert.equal(reversedOpen.alternatives.length, opened.alternatives.length, "reversing request order retains every known open alternative");
  assert.equal(reversedOpen.alternatives.every(origin => opened.alternatives.some(previous =>
    origin.kind === "construction" && previous.kind === "construction" && origin.invocation === previous.invocation &&
    origin.construction === previous.construction && origin.root === previous.root && origin.callerBindings === previous.callerBindings &&
    origin.owner === previous.owner && origin.region === previous.region && origin.selection === previous.selection &&
    origin.activation === previous.activation && origin.targetBindings === previous.targetBindings)), true,
  "reverse enumeration preserves original source identities rather than matching equal native types");
  assert.equal(reversedOpen.boundaries.includes(boundary), true, "reverse enumeration retains the exact same original boundary");
  const reversedUnavailable = create({...original.input,
    emissionRequests: Object.freeze([...original.input.emissionRequests].reverse()), genericBindingsFor(declaration, bindings) {
      return declaration === failing.origin.owner ? Object.freeze({kind: "unresolved", reason: "separate constructor origin unavailable"})
        : original.input.genericBindingsFor(declaration, bindings);
    }}, Object.freeze([...original.requests].reverse()));
  assert.equal(reversedUnavailable(request, distinct.origins.occurrence).kind, "resolved",
    "reverse enumeration preserves an unrelated root when a different exact region is unavailable");
  assert.equal(reversedUnavailable(selectedRequest, failing.origins.occurrence).kind, "unavailable",
    "reverse enumeration preserves the actual failing region rather than whichever failure was visited last");
}

test("constructor, super and instance-initializer origins use actual construction and per-activation binding rows", () => {
  observed(constructorSource, verifyConstructorOrigins);
});

test("uninjected native, callable and constructor source-origin controls continue to emit ordinary Rust", () => {
  for (const [name, text] of [["native/module", nativeSource], ["callable", callableSource], ["constructor", constructorSource]]) {
    const result = compileRust({surfaces: ["js"], files: {"index.ts": text}}).result;
    assert.equal(result.diagnostics.length, 0, name + ": genuine source has no rejection");
    assert.equal(result.artifacts.some(artifact => artifact.path.endsWith(".rs")), true, name + ": genuine source emits Rust without observation");
  }
});
