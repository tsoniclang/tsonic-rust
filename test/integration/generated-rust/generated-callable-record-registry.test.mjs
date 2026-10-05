import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const callbackFiles = {
  "contracts.ts": `
    export interface Destination { total: number; }
    export interface FileStat { size: number; }
    export type HeaderCallback = (destination: Destination, path: string, stat: FileStat) => void;
    export interface TransferOptions {
      root?: string;
      enabled?: boolean;
      setHeaders?: HeaderCallback;
      label?: string;
    }
    export interface SendOptions extends TransferOptions {}
    export interface StaticOptions {
      enabled?: boolean;
      setHeaders?: HeaderCallback;
    }
  `,
  "receiver.ts": `
    import type { Destination, SendOptions } from "./contracts.js";
    export class Receiver implements Destination {
      total = 0;
      sendFile(path: string, options: SendOptions): void {
        if (options.root !== "root" || options.label !== undefined) throw new Error("options");
        const callback = options.setHeaders;
        if (callback !== undefined) callback(this, path, { size: 7 });
      }
    }
  `,
  "forward.ts": `
    import type { StaticOptions } from "./contracts.js";
    import { Receiver } from "./receiver.js";
    async function pause(): Promise<void> {}
    export function forward(receiver: Receiver, options?: StaticOptions): void {
      receiver.sendFile("file", {
        root: "root",
        enabled: options?.enabled,
        setHeaders: options?.setHeaders,
      });
    }
    export function deferred(receiver: Receiver, options?: StaticOptions): () => Promise<void> {
      return async (): Promise<void> => {
        await pause();
        receiver.sendFile("file", {
          root: "root",
          enabled: options?.enabled,
          setHeaders: options?.setHeaders,
        });
      };
    }
  `,
  "index.ts": `
    import type { HeaderCallback, StaticOptions } from "./contracts.js";
    import { forward, deferred } from "./forward.js";
    import { Receiver } from "./receiver.js";
    function checkTotal(actual: number, expected: number): void {
      if (actual !== expected) throw new Error("callback total");
    }
    export async function main(): Promise<void> {
      const receiver = new Receiver();
      forward(receiver);
      forward(receiver, {});
      await deferred(receiver)();
      await deferred(receiver, {})();
      checkTotal(receiver.total, 0);
      const callback: HeaderCallback = (destination, path, stat) => {
        if (path !== "file") throw new Error("path");
        destination.total += stat.size;
      };
      const options: StaticOptions = { enabled: false, setHeaders: callback };
      forward(receiver, options);
      await deferred(receiver, options)();
      checkTotal(receiver.total, 14);
      options.setHeaders = undefined;
      forward(receiver, options);
      await deferred(receiver, options)();
      checkTotal(receiver.total, 14);
    }
  `,
};

for (const surfaces of [[], ["js"]]) {
  test(`cross-file optional callback records survive synchronous and suspended forwarding on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `optional_callback_record_forwarding_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } }, files: callbackFiles });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      const generated = rustSourceText(result);
      assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(generated), false,
        "optional callable forwarding must not bypass native absence or type safety");
      validateGeneratedProject(name, result.artifacts, { run: true });
    });

  test(`suspended callable bodies retain the file's exact method record implementation on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `suspended_callable_record_registry_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: {
          "contract.ts": `export interface Operation { run(): number; }`,
          "factory.ts": `
            import type { Operation } from "./contract.js";
            async function pause(): Promise<void> {}
            export function factory(): () => Promise<number> {
              return async (): Promise<number> => {
                await pause();
                const operation: Operation = { run(): number { return 3; } };
                return operation.run();
              };
            }
          `,
          "index.ts": `
            import { factory } from "./factory.js";
            export async function main(): Promise<void> {
              const execute = factory();
              if (await execute() !== 3) throw new Error("record registry");
            }
          `,
        },
      });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });

  test(`stored generic callable bodies share the file's exact record implementation registry on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `generic_callable_record_registry_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: {
          "contract.ts": `export interface Operation { run(): number; }`,
          "factory.ts": `
            import type { Operation } from "./contract.js";
            export function factory(): <Value>(value: Value) => Operation {
              return function<Value>(value: Value): Operation {
                void value;
                return { run(): number { return 3; } };
              };
            }
          `,
          "index.ts": `
            import { factory } from "./factory.js";
            export function main(): void {
              const create = factory();
              const first = create(7);
              const second = create("value");
              if (first.run() !== 3 || second.run() !== 3) throw new Error("record registry");
            }
          `,
        },
      });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });

  test(`method record state retains omitted optional fields and present false values on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `method_record_optional_state_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: {
          "contract.ts": `
            export interface Operation {
              label?: string;
              enabled?: boolean;
              callback?: () => number;
              run(): number;
            }
          `,
          "factory.ts": `
            import type { Operation } from "./contract.js";
            export function absent(): Operation { return { run(): number { return 3; } }; }
            export function present(): Operation {
              return { label: "ready", enabled: false, callback: () => 7, run(): number { return 3; } };
            }
          `,
          "index.ts": `
            import { absent, present } from "./factory.js";
            export function main(): void {
              const empty = absent();
              if (empty.label !== undefined || empty.enabled !== undefined ||
                empty.callback !== undefined || empty.run() !== 3) throw new Error("absent fields");
              const filled = present();
              if (filled.label !== "ready" || filled.enabled !== false ||
                filled.run() !== 3) throw new Error("present fields");
              const callback = filled.callback;
              if (callback === undefined || callback() !== 7) throw new Error("present callback");
            }
          `,
        },
      });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });
}
