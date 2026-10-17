/**
 * tools.ts — Custom tools expostas ao modelo do DevKit.
 *
 * - devkit_recall: busca conhecimento (bugs, decisões, armadilhas, convenções).
 *   Use ANTES de propor mudança arquitetural ou investigar erro.
 */

import { tool } from "@opencode-ai/plugin";
import { devkitCall } from "./client";
import { renderKnowledgeBlock } from "./render";

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
  async execute(args, context) {
    const r = await devkitCall("/api/knowledge/search", {
      query: args.query,
      scope: args.scope,
      cwd: context.directory,
      limit: 8,
    });
    if (!r || !Array.isArray((r as any).results)) {
      return "DevKit indisponível ou sem resultados.";
    }
    return renderKnowledgeBlock((r as any).results) || "Sem resultados relevantes.";
  },
});
