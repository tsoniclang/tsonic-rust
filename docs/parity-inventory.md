# JS/Node lane inventory relative to the C# target surface

Classification of JS/Node lanes reviewed against the C# target surface.
The machine-checked list lives in docs/parity-lanes.json; every listed
lane carries exactly one classification — implemented (positive runtime
proof in the generated Cargo bank), hard-rejected (shared architecture), or
target-limit (a precisely rejected capability that cannot preserve the source
contract in the selected closed Rust runtime). The guard test keeps this
document and the lane list from drifting.

## Implemented

- Array: literals, index/at, length, variadic push/unshift, pop, shift,
  splice, includes, indexOf, lastIndexOf, forEach, map, filter, reduce, some,
  every, find, findIndex, findLast, findLastIndex, reverse, default sort,
  fill, copyWithin, and concat over exact scalar/array alternatives; slice over closed Clone carriers and join over
  exact stringifiable carriers; Array.of over an exact selected element type,
  Array.from over strings, and Array.isArray over closed JsValue inputs;
  callbacks receive every declared argument,
  reduce supports both initial-value and first-present-element forms, and one
  identity-preserving `JsArray<T>` carrier represents dense and sparse arrays.
- Boolean: primitive toString and valueOf.
- String: length, toUpperCase, toLowerCase, includes, startsWith,
  endsWith, indexOf, lastIndexOf, slice, substring, substr, at, charAt,
  charCodeAt, codePointAt, repeat, padStart, padEnd, trim, trimStart,
  trimEnd, trimLeft, trimRight, toString, valueOf, concat, split, replace,
  replaceAll, search, match, Unicode normalization, isWellFormed, and
  toWellFormed; String.fromCharCode and
  String.fromCodePoint; String.matchAll call, fallibility lowering, and result
  consumption for constant patterns. UTF-16 results that Rust strings cannot
  represent fail closed.
- RegExp: constant literals and new RegExp with literal arguments over the
  oracle-proven subset; test, replace, split, search, global match with
  null coalescing; regexp property reads; exec/match result consumption and
  matchAll result consumption through the exact selected match-array carrier.
- Math: all source-profile constants and functions, including trigonometric,
  hyperbolic, logarithmic, rounding, bit-conversion, variadic hypot/min/max,
  pow, and random operations; operations whose Rust primitives differ from
  JavaScript use exact runtime rows.
- Number.parseInt/parseFloat: exact prefix parsing; Number constants, valueOf,
  decimal toString, integral-radix toString, toFixed, toExponential,
  toPrecision, and non-coercive Number.isNaN/isFinite/isInteger/isSafeInteger
  predicates. Decimal conversion uses the
  ECMAScript Ryū algorithm; non-number unknown values and fractional
  non-decimal radix calls fail closed.
- JSON: parse, stringify, stringify with null replacer and closed numeric
  or string space, over the closed JsValue carrier.
- Map, Set: empty constructors, mutable and read-only carriers,
  get/set/has/delete/add/clear, size, keys/values/entries, direct iteration,
  callbacks with every declared arity, insertion order, and SameValueZero.
  Set algebra rows (union, intersection, difference, symmetricDifference,
  isSubsetOf, isSupersetOf, isDisjointFrom) are runtime-proven through the
  active source profile.
- Date: identity-preserving UTC carrier constructors, now, parse, UTC,
  getTime, valueOf, toISOString, toUTCString, toJSON, UTC getters, and UTC setters
  with JavaScript overflow and TimeClip behavior.
- Console: console.log, console.error, console.warn, console.info, and
  console.debug with exact string, number,
  int32, and boolean arguments through one closed `JsValue` slice ABI;
  empty variadic calls pass an explicit empty slice.
- Node: path, os, fs, fs/promises (async signatures over synchronous file
  operations), process (cwd, exit, value exports, env with null-preserving
  reads, fallible execPath property, argv0, version, chdir, available and
  constrained memory, uptime, hrtime, and memoryUsage), Buffer, URL, URLSearchParams, legacy
  url.parse/format with the UrlObject carrier, crypto (randomUUID,
  randomBytes, createHash, createHmac), util (closed string helpers,
  inspect over closed JsValue, format with closed placeholders), and
  node:assert `ok` with optional string messages. The buffer extras are closed:
  Buffer copies mutate the
  selected target, slice/subarray values share backing storage, byte swaps
  preserve object identity, and the complete C#-visible numeric read/write
  matrix returns JavaScript numbers through one exact source ABI.
  The process identity and metrics lane preserves named/default module forms and
  maps timing tuples and memory fields through closed native carriers. Named and
  default process stdio stdout/stderr values use exact sink-backed output carriers
  with string and Buffer writes, descriptor identity, and terminal detection.
  Canonical `node:*` modules and their Node-compatible bare module aliases resolve to
  one provider/module/export identity rather than duplicate declaration models.
- Object.keys/values/entries and Object.hasOwn/hasOwnProperty over exact generated
  structural object carriers. Integer-index keys use ECMAScript numeric order;
  remaining keys preserve the exact authored own-property order. Open nominal,
  spread-ambiguous, and otherwise unproven runtime shapes fail closed.
- Error model, async/await, callbacks, tuples, fixed arrays, records,
  string-literal unions, discriminated object unions with exact selected
  narrowing evidence, generics, statics — see README.

## Hard-rejected by architecture

- Open reflection and dynamic member access; eval and embedded engines.
- JSON replacer functions and custom toJSON dispatch.
- Process termination side effects beyond exit(code).

## Target limits

- `"a".localeCompare("b", "tr")` and locale case conversion cannot run
  without one selected ICU locale and data version; host-default locale
  behavior is not deterministic compiler semantics.
- local-time getters, setters, and locale strings such as `date.setHours(1)`
  and `date.toLocaleString()` cannot run without one selected timezone and
  locale-data version; the target does not silently use the build or execution
  machine's defaults.
- streams and fs.watch calls such as `watch(path, callback)` cannot preserve
  cancellation, backpressure, event ordering, and resource lifetimes because
  the closed Rust Node capability omits that asynchronous scheduler.
- `Object.assign(target, source)` cannot add fields while preserving the
  identity of `target`: two different static Rust record layouts cannot be one
  object without replacing the closed carrier with runtime reflection.
- `console.log(openObject)` cannot inspect arbitrary values without runtime
  reflection. Structural cyclic graphs also have no identity-preserving
  source-to-`JsValue` graph contract, so the target does not snapshot them.
- `process.stdin.on("data", callback)` cannot preserve Node stream events
  without the omitted scheduler. `process.stdout.write(text)` and Buffer writes
  use the exact sink-backed output contract instead.
