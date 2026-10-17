/**
 * client.ts — Cliente HTTP para o FastAPI do DevKit.
 *
 * Requisitos inegociáveis:
 * 1. DEGRADAÇÃO GRACIOSA: se o FastAPI estiver fora de ar/lento/erro,
 *    o agente CONTINUA funcionando. Nunca lança exceção.
 * 2. Timeout de 5s via AbortController.
 * 3. Segredo do hook lido do arquivo .credentials.json. A variável de ambiente DEVKIT_SECRET não é usada no código.
 * 4. Observable via client.app.log() com service "devkit".
 */

import fetch from "cross-fetch";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const BASE = process.env.DEVKIT_URL ?? "http://127.0.0.1:4200";
const TIMEOUT_MS = 5000;

let secret: string | null = null;
let secretReadError: Error | null = null;

/**
 * Lê o segredo de auth do hook do arquivo de credenciais do Claude Code.
 * Nunca loga, nunca passa por argv, mantém em memória.
 */
async function getSecret(): Promise<string> {
  if (secret !== null) return secret;
  if (secretReadError) throw secretReadError;

  const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
  try {
    const raw = fs.readFileSync(credPath, "utf-8");
    const parsed = JSON.parse(raw);
    secret = parsed.satu_hook_shared_secret ?? "";
  } catch (err) {
    secretReadError = err as Error;
    secret = "";
  }
  return secret ?? "";
}

/**
 * Faz chamada HTTP para o FastAPI. NUNCA lança.
 * Em caso de falha (offline, timeout, 500, parse error) retorna null
 * e o agente segue normalmente.
 */
export async function devkitCall<T>(
  pathName: string,
  body?: unknown,
): Promise<T | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${pathName}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-SATU-Hook-Secret": await getSecret(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // offline, timeout, 500, parse — agente segue
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Saúde do backend. Usado para observar se o RAG está disponível.
 */
export async function devkitHealth(): Promise<boolean> {
  const r = await devkitCall<{ status: string }>("/api/health");
  return r?.status === "ok";
}
