/**
 * tools.ts — Custom tools expostas ao modelo do DevKit.
 *
 * - devkit_recall: busca conhecimento (bugs, decisões, armadilhas, convenções).
 *   Use ANTES de propor mudança arquitetural ou investigar erro.
 */

import { tool, type ToolContext } from "@opencode-ai/plugin";
import { devkitCall } from "./client";
import { renderKnowledgeBlock, KnowledgeHit } from "./render";

export const devkitRecallTool = tool({
  description:
    "Busca conhecimento do DevKit (bugs, decisões, armadilhas, convenções). " +
    "Use ANTES de propor mudança arquitetural ou investigar erro.",
  args: {
    query: tool.schema.string().describe("pergunta em linguagem natural"),
    scope: tool.schema
      .enum(["project", "stack", "domain", "universal"])
      .optional(),
  },
  async execute(args: { query: string; scope?: string }, context: ToolContext) {
    const r = await devkitCall<{ results: KnowledgeHit[] }>("/api/knowledge/search", {
      query: args.query,
      scope: args.scope,
      cwd: context.directory,
      limit: 8,
    });
    const hits = r?.results ?? [];
    if (hits.length === 0) {
      return "DevKit indisponível ou sem resultados.";
    }
    return renderKnowledgeBlock(hits) || "Sem resultados relevantes.";
  },
});
