/**
 * render.ts — Formatação do bloco de conhecimento injetado no contexto.
 *
 * Regras:
 * - Máximo 5 entries, 2000 tokens por injeção (orçamento de contexto).
 * - Trunca por entry, nunca corta o bloco no meio.
 * - Sem ruído: nunca injeta nada se não houver resultados.
 */

interface KnowledgeHit {
  title: string;
  summary: string;
  content?: string;
  scope?: string;
  relevance_score?: number;
}

/**
 * Renderiza o bloco de conhecimento com as entries encontradas.
 * Se houver mais que 5, corta e avisa.
 */
export function renderKnowledgeBlock(hits: KnowledgeHit[]): string {
  if (!hits || hits.length === 0) return "";

  const limited = hits.slice(0, 5);
  const lines: string[] = [];
  lines.push("## Conhecimento do Projeto (DevKit)");

  let totalChars = 0;
  const maxChars = 2000; // orçamento aproximado de tokens (chars ~ tokens)

  for (const hit of limited) {
    const entry = [
      `- [${hit.title}] (${hit.scope ?? "projeto"})`,
      `  ${hit.summary ?? ""}`,
    ].join("\n");

    // Trunca por entry, nunca corta no meio do bloco
    if (totalChars + entry.length > maxChars) break;
    lines.push(entry);
    totalChars += entry.length;
  }

  if (hits.length > 5) {
    lines.push(`... e mais ${hits.length - 5} entries`);
  }

  lines.push(""); // linha em branco para separar do contexto do usuário
  return lines.join("\n");
}

/**
 * Lista de palavras triviais — não injeta conhecimento para essas mensagens.
 * Replica TRIVIAL_WORDS do hook_engine.py do FastAPI.
 */
const TRIVIAL_WORDS = new Set([
  "ok",
  "sim",
  "não",
  "nao",
  "valeu",
  "obrigado",
  "obrigada",
  "thanks",
  "thank you",
  "commit",
  "continua",
  "continue",
  "prossiga",
  "vai",
  "go",
  "okey",
  "okey dokey",
]);

/**
 * Retorna true se a mensagem do usuário for trivial (não merece injeção de RAG).
 */
export function isTrivialMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.length <= 3) return true;
  if (TRIVIAL_WORDS.has(normalized)) return true;
  return false;
}
