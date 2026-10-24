// @vitest-environment node

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "vite";
import type { UserConfig } from "vite";
import viteConfig from "../vite.config";

describe("dashboard development proxy", () => {
  it("routes the live-view WebSocket to the CafeQuest server", () => {
    const config = viteConfig as UserConfig;

    expect(config.server?.proxy?.["/cast-ws"]).toMatchObject({
      target: "ws://localhost:3000",
      ws: true,
    });
  });
});

describe("iOS 12 production dashboard", () => {
  it("lowers modern operators before serving JavaScript to the iPad", async () => {
    const config = viteConfig as UserConfig;
    const result = await build({
      ...config,
      root: fileURLToPath(new URL("../", import.meta.url)),
      configFile: false,
      logLevel: "silent",
      build: { ...config.build, write: false },
    });
    if (!("output" in result)) throw new Error("Expected a production bundle");
    const chunks = result.output.filter((output) => output.type === "chunk");
    expect(chunks.length).toBeGreaterThan(0);
    const unsupported = new Set<string>();
    const operators = new Set([
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.QuestionDotToken,
      ts.SyntaxKind.QuestionQuestionEqualsToken,
      ts.SyntaxKind.AmpersandAmpersandEqualsToken,
      ts.SyntaxKind.BarBarEqualsToken,
    ]);
    for (const chunk of chunks) {
      const source = ts.createSourceFile(chunk.fileName, chunk.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const visit = (node: ts.Node) => {
        if (operators.has(node.kind)) unsupported.add(node.getText(source));
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect([...unsupported]).toEqual([]);
  }, 20_000);
});
