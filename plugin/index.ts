/**
 * index.ts — Registro de hooks do plugin DevKit para OpenCode v2.
 *
 * FASE 1 (RAG):
 * - Injeção de contexto via session.hook("context") — push automático
 *   de conhecimento antes de cada chamada ao modelo.
 *
 * FASE 2 (Captura):
 * - session.created — contexto inicial da sessão
 * - session.idle — captura aprendizados ao final da sessão
 * - file.edited — captura mudanças de código
 * - tool.execute.before — pré-edição com bloqueio real via DevKit
 *
 * Custom tool:
 * - devkit_recall: busca conhecimento (bugs, decisões, armadilhas).
 */

import { Session, Plugin } from "@opencode-ai/plugin";
import { devkitCall, devkitHealth } from "./client";
import { devkitRecallTool } from "./tools";
import {
  renderKnowledgeBlock,
  isTrivialMessage,
} from "./render";
import {
  shouldCapture,
  suggestTitle,
  suggestSummary,
  suggestScope,
  suggestCategory,
  saveLocalKnowledge,
} from "./capture";

export interface DevKitPluginOptions {
  baseUrl?: string;
}

export const devkitPlugin = (options: DevKitPluginOptions = {}): Plugin => {
  if (options.baseUrl) {
    process.env.DEVKIT_URL = options.baseUrl;
  }

  return {
    name: "devkit",
    version: "0.2.0",
    setup(ctx: Session) {
      // =====================================================================
      // FASE 1 — Injeção de contexto (RAG push)
      // =====================================================================
      // Executa antes de cada chamada ao modelo, enxerga as mensagens e
      // edita system/messages só para aquela chamada.
      ctx.session.hook("context", async (event) => {
        const last = event.messages.at(-1);
        const text = last ? extractText(last) : "";
        if (!text || isTrivialMessage(text)) return;

        const hits = await devkitCall("/api/knowledge/search", {
          query: text,
          scope: "project",
          cwd: ctx.directory,
          limit: 5,
        });
        if (!hits || !Array.isArray((hits as any).results)) return;

        const block = renderKnowledgeBlock((hits as any).results);
        if (!block) return;

        event.system.push({
          type: "text",
          text: block,
        });

        // --- Métricas de economia de tokens ---
        const queryTokens = estimateTokens(text);
        const fullContextEstimate = queryTokens + estimateTokens(block) * 5; // estimativa de contexto completo sem RAG
        const ragTokens = queryTokens + estimateTokens(block);
        const savingsTokens = Math.max(0, fullContextEstimate - ragTokens);
        const savingsPercent = fullContextEstimate > 0 ? (savingsTokens / fullContextEstimate) * 100 : 0;

        await devkitCall("/api/metrics/token-usage", {
          timestamp: new Date().toISOString(),
          query: text,
          full_context_estimate: fullContextEstimate,
          rag_context_tokens: ragTokens,
          savings_tokens: savingsTokens,
          savings_percent: savingsPercent,
        });

        ctx.app.log({
          service: "devkit",
          message: `Conhecimento injetado: ${(hits as any).results.length} entries | Economia: ${savingsPercent.toFixed(1)}%`,
          data: { query: text, cwd: ctx.directory, savingsTokens, savingsPercent },
        });
      });

      // =====================================================================
      // FASE 2 — Captura automática de conhecimento
      // =====================================================================

      // session.created — registra início da sessão
      ctx.session.on("session.created", async (event) => {
        await devkitCall("/api/hook/session-start", {
          session_id: event.properties.sessionID,
          cwd: ctx.directory,
        });
      });

      // session.idle — captura aprendizados ao final da sessão
      ctx.session.on("session.idle", async (event) => {
        const sessionID = event.properties.sessionID as string;

        // Chama o hook de stop no backend
        await devkitCall("/api/hook/stop", {
          session_id: sessionID,
          cwd: ctx.directory,
        });

        // Tenta capturar o último aprendizado da sessão
        const messages = event.messages ?? [];
        const lastUserMsg = messages
          .filter((m: any) => m.role === "user")
          .pop();

        if (lastUserMsg) {
          const text = extractText(lastUserMsg);
          if (text && !isTrivialMessage(text)) {
            const decision = shouldCapture(text);
            if (decision.capture) {
              await captureLearning({
                title: suggestTitle(text),
                content: text,
                summary: suggestSummary(text),
                scope: suggestScope(text, ctx.directory),
                category: suggestCategory(text),
                cwd: ctx.directory,
                sessionID,
              });
            }
          }
        }

        ctx.app.log({
          service: "devkit",
          message: `Sessão finalizada: ${sessionID}`,
          data: { cwd: ctx.directory },
        });
      });

      // file.edited — captura mudanças de código
      ctx.session.on("file.edited", async (event) => {
        const file = event.properties.path as string;
        await devkitCall("/api/hook/post-tool-use", {
          tool: "edit",
          file,
          cwd: ctx.directory,
        });

        // Se houver conteúdo do diff, tenta capturar
        const diffContent = event.properties.diff as string | undefined;
        if (diffContent) {
          const decision = shouldCapture(diffContent);
          if (decision.capture) {
            await captureLearning({
              title: `Edição: ${file}`,
              content: diffContent,
              summary: suggestSummary(diffContent),
              scope: suggestScope(diffContent, ctx.directory),
              category: "pattern",
              cwd: ctx.directory,
              sessionID: event.properties.sessionID as string,
            });
          }
        }
      });

      // tool.execute.before — pré-edição com bloqueio real
      ctx.tool.hook("execute.before", async (input, output) => {
        if (input.tool !== "edit" && input.tool !== "write") return;

        const verdict = await devkitCall("/api/hook/pre-edit-guard", {
          file: output.args.filePath,
          cwd: ctx.directory,
        });
        if (verdict?.block) {
          throw new Error(`DevKit bloqueou a edição: ${verdict.reason}`);
        }
      });

      // =====================================================================
      // Custom tool exposta ao modelo
      // =====================================================================
      ctx.tools.register("devkit_recall", devkitRecallTool);
    },
  };
};

/**
 * Captura um aprendizado no backend ou salva localmente se offline.
 */
async function captureLearning(entry: {
  title: string;
  content: string;
  summary: string;
  scope: string;
  category: string;
  cwd?: string;
  sessionID?: string;
}): Promise<void> {
  const payload = {
    title: entry.title,
    content: entry.content,
    summary: entry.summary,
    category: entry.category,
    scope: entry.scope,
    cwd: entry.cwd,
    session_id: entry.sessionID,
  };

  const sent = await devkitCall("/api/knowledge", payload);
  if (!sent) {
    // Backend offline — salva localmente para retry posterior
    saveLocalKnowledge({
      title: entry.title,
      content: entry.content,
      summary: entry.summary,
      scope: entry.scope,
      category: entry.category,
      cwd: entry.cwd,
    });
    return;
  }

  ctxAppLog("Conhecimento capturado", { title: entry.title, scope: entry.scope });
}

/**
 * Helper de log (evita dependência direta do ctx.app no capture.ts).
 */
function ctxAppLog(message: string, data?: Record<string, unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalCtx = (globalThis as any).__DEVKIT_CTX__;
  if (globalCtx?.app?.log) {
    globalCtx.app.log({
      service: "devkit",
      message,
      data,
    });
  }
}

/**
 * Extrai texto de uma mensagem (texto simples ou array de partes).
 */
function extractText(msg: any): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p: any) => (typeof p.text === "string" ? p.text : ""))
      .join("\n");
  }
  return "";
}

/**
 * Estima o número de tokens em uma string.
 * Aproximação: ~4 caracteres por token (padrão comum para LLMs).
 * Para português, pode ser ligeiramente diferente, mas serve para estimativa.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
