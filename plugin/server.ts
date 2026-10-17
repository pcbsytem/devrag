/**
 * server.ts — Wrapper para iniciar o servidor OpenCode headless com autenticação (Fase 5).
 *
 * - Lê OPENCODE_SERVER_PASSWORD da variável de ambiente.
 * - Inicia `opencode serve` com senha protegida.
 * - Health check do servidor (polling até ficar disponível).
 *
 * Degradação graciosa: se `opencode` não estiver disponível ou o servidor
 * não subir, retorna erro em vez de lançar exceção.
 */

import * as child_process from "child_process";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3333;
const HEALTH_INTERVAL_MS = 500;
const HEALTH_MAX_RETRIES = 40; // ~20s no total

/**
 * Handle do servidor OpenCode iniciado.
 */
export interface ServerHandle {
  url: string;
  port: number;
  process: child_process.ChildProcess;
  close: () => void;
}

/**
 * Opções para iniciar o servidor.
 */
export interface ServerOptions {
  host?: string;
  port?: number;
  password?: string;
}

/**
 * Resultado de tentativa de iniciar o servidor.
 */
export interface ServerStartResult {
  handle: ServerHandle | null;
  error: string | null;
}

/**
 * Lê a senha do servidor da variável de ambiente OPENCODE_SERVER_PASSWORD.
 * Nunca retorna a senha em logs.
 */
function getServerPassword(): string | null {
  return process.env.OPENCODE_SERVER_PASSWORD ?? null;
}

/**
 * Verifica se o servidor OpenCode está respondendo via health check.
 * Nunca lança.
 */
async function serverIsHealthy(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_INTERVAL_MS);
    try {
      const res = await fetch(`${url}/api/health`, {
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/**
 * Inicia `opencode serve` como subprocesso com autenticação por senha.
 * Aguarda o health check antes de retornar o handle.
 */
export async function startServer(options: ServerOptions = {}): Promise<ServerStartResult> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const password = options.password ?? getServerPassword();

  if (!password) {
    return {
      handle: null,
      error: "OPENCODE_SERVER_PASSWORD não definida. Defina a variável de ambiente antes de iniciar o servidor.",
    };
  }

  const url = `http://${host}:${port}`;
  const env = {
    ...process.env,
    OPENCODE_SERVER_PASSWORD: password,
  };

  let proc: child_process.ChildProcess;
  try {
    proc = child_process.spawn("opencode", ["serve", "--host", host, "--port", String(port)], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (err) {
    return {
      handle: null,
      error: `Falha ao spawnar processo opencode serve: ${String(err)}`,
    };
  }

  // Health check: aguarda o servidor ficar disponível
  let retries = 0;
  while (retries < HEALTH_MAX_RETRIES) {
    if (proc.exitCode !== null && proc.exitCode !== undefined) {
      return {
        handle: null,
        error: `Processo opencode serve encerrou precocemente com código ${proc.exitCode}`,
      };
    }
    if (await serverIsHealthy(url)) {
      return {
        handle: {
          url,
          port,
          process: proc,
          close: (): void => {
            try {
              proc.kill("SIGTERM");
            } catch {
              // Degradação graciosa — processo pode já ter encerrado
            }
          },
        },
        error: null,
      };
    }
    retries++;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }

  // Timeout: servidor não ficou saudável a tempo
  try {
    proc.kill("SIGTERM");
  } catch {
    // Ignora erro ao tentar encerrar
  }

  return {
    handle: null,
    error: `Servidor OpenCode não ficou disponível em ${url} após ${HEALTH_MAX_RETRIES * HEALTH_INTERVAL_MS}ms`,
  };
}

/**
 * Encerra um handle de servidor previamente iniciado.
 */
export function stopServer(handle: ServerHandle): void {
  try {
    handle.process.kill("SIGTERM");
  } catch {
    // Degradação graciosa
  }
}
