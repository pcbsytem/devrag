/**
 * capture.ts — Lógica de captura automática de conhecimento.
 *
 * Heurística baseada em palavras para decidir o que virar entry de
 * knowledge_entries, antes de gastar LLM:
 *
 * - TRIVIAL_WORDS — "sim", "ok", "commit", "valeu"... → descarta
 * - STRONG_INDICATORS — "causa raiz", "descobri", "trade-off", "armadilha",
 *   "gotcha", "workaround", "convenção"... → captura direto
 * - WEAK_INDICATORS — "corrigi", "resolvido", "fixed"... → avalia
 *
 * Nunca lança: se algo falhar, a captura simplesmente não ocorre.
 */

import * as fs from "fs";
import * as path from "path";

/**
 * Palavras triviais — não geram conhecimento.
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
  "entendido",
  "certo",
  "beleza",
]);

/**
 * Indicadores fortes — o conteúdo provavelmente é um aprendizado valioso.
 */
const STRONG_INDICATORS = new Set([
  "causa raiz",
  "descobri",
  "trade-off",
  "trade off",
  "armadilha",
  "gotcha",
  "workaround",
  "convenção",
  "convencao",
  "padrão",
  "padrao",
  "boa prática",
  "boa pratica",
  "anti-padrão",
  "anti-padrao",
  "lição",
  "licao",
  "aprendizado",
  "falha",
  "erro crítico",
  "erro critico",
  "bug",
  "decisão",
  "decisao",
  "arquitetura",
  "inconsistência",
  "inconsistencia",
]);

/**
 * Indicadores fracos — pode ser aprendizado, mas precisa de mais contexto.
 */
const WEAK_INDICATORS = new Set([
  "corrigi",
  "resolvi",
  "resolveu",
  "fixed",
  "fix",
  "ajustei",
  "melhorei",
  "otimizei",
  "refatorei",
]);

/**
 * Avalia se um texto deve ser capturado como conhecimento.
 * Retorna { capture: true, reason } ou { capture: false, reason }.
 */
export function shouldCapture(text: string): { capture: boolean; reason: string } {
  if (!text || text.trim().length === 0) {
    return { capture: false, reason: "texto vazio" };
  }

  const normalized = text.trim().toLowerCase();

  // Descarta mensagens triviais
  if (normalized.length <= 3) {
    return { capture: false, reason: "texto muito curto" };
  }
  if (TRIVIAL_WORDS.has(normalized)) {
    return { capture: false, reason: "palavra trivial" };
  }

  // Verifica indicadores fortes
  for (const indicator of STRONG_INDICATORS) {
    if (normalized.includes(indicator)) {
      return { capture: true, reason: `indicador forte: ${indicator}` };
    }
  }

  // Verifica indicadores fracos (precisa de tamanho mínimo)
  if (normalized.length >= 20) {
    for (const indicator of WEAK_INDICATORS) {
      if (normalized.includes(indicator)) {
        return { capture: true, reason: `indicador fraco: ${indicator}` };
      }
    }
  }

  return { capture: false, reason: "sem indicadores de aprendizado" };
}

/**
 * Extrai um título sugerido a partir do conteúdo.
 */
export function suggestTitle(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return "Aprendizado da sessão";

  // Primeira linha não trivial como título
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 100) {
      if (!TRIVIAL_WORDS.has(trimmed.toLowerCase())) {
        return trimmed;
      }
    }
  }

  return "Aprendizado da sessão";
}

/**
 * Extrai um resumo do conteúdo (máximo 200 caracteres).
 */
export function suggestSummary(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 200) return trimmed;
  return trimmed.substring(0, 197).trim() + "...";
}

/**
 * Classifica o escopo com base no conteúdo e no diretório de trabalho.
 */
export function suggestScope(content: string): "project" | "stack" | "domain" | "universal" {
  const normalized = content.toLowerCase();

  // Indicadores de stack (tecnologia específica)
  const stackKeywords = [
    "javascript",
    "typescript",
    "python",
    "react",
    "nextjs",
    "nestjs",
    "fastapi",
    "postgres",
    "docker",
    "kubernetes",
    "aws",
    "node",
    "go",
    "rust",
    "java",
    "sql",
    "graphql",
    "api",
    "framework",
    "biblioteca",
    "library",
  ];
  for (const kw of stackKeywords) {
    if (normalized.includes(kw)) return "stack";
  }

  // Indicadores de domínio (área de negócio)
  const domainKeywords = [
    "segurança",
    "seguranca",
    "pci-dss",
    "lgpd",
    "gdpr",
    "financeiro",
    "comissão",
    "comissao",
    "oferta",
    "ecommerce",
    "marketplace",
    "venda",
    "cliente",
  ];
  for (const kw of domainKeywords) {
    if (normalized.includes(kw)) return "domain";
  }

  // Indicadores universais (princípios gerais)
  const universalKeywords = [
    "princípio",
    "principio",
    "boa prática",
    "boa pratica",
    "convenção",
    "convencao",
    "arquitetura",
    "design",
    "padrão",
    "padrao",
  ];
  for (const kw of universalKeywords) {
    if (normalized.includes(kw)) return "universal";
  }

  // Default: projeto
  return "project";
}

/**
 * Categoria sugerida com base no conteúdo.
 */
export function suggestCategory(content: string): string {
  const normalized = content.toLowerCase();

  const categories: Record<string, string[]> = {
    bug_fix: ["bug", "erro", "falha", "corrigi", "resolvi", "fixed", "fix"],
    pattern: ["padrão", "padrao", "boa prática", "boa pratica", "convenção", "convencao"],
    architecture: ["arquitetura", "estrutura", "camada", "microsserviço", "microsservico"],
    discovery: ["descobri", "descoberta", "aprendi", "entendi", "percebi"],
    flow: ["fluxo", "pipeline", "processo", "etapa", "passo"],
    security: ["segurança", "seguranca", "vulnerabilidade", "acesso", "autenticação", "autenticacao"],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    for (const kw of keywords) {
      if (normalized.includes(kw)) return category;
    }
  }

  return "discovery";
}

/**
 * Salva um entry de conhecimento localmente (cache) quando o backend
 * não está disponível. Será enviado na próxima oportunidade.
 */
export function saveLocalKnowledge(entry: {
  title: string;
  content: string;
  summary: string;
  scope: string;
  category: string;
  cwd?: string;
}): void {
  try {
    const cacheDir = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "cache",
      "devkit-capture"
    );
    fs.mkdirSync(cacheDir, { recursive: true });

    const fileName = `capture-${Date.now()}.json`;
    fs.writeFileSync(path.join(cacheDir, fileName), JSON.stringify(entry, null, 2));
  } catch {
    // Falha silenciosa — não deve quebrar o agente
  }
}
