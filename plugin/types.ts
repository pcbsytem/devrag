/**
 * types.ts — Tipos locais do contexto de plugin injetado pelo host OpenCode v2.
 *
 * O tipo Session não é exportado por nenhum pacote @opencode-ai (nem @opencode-ai/plugin
 * nem @opencode-ai/sdk). É injetado pelo runtime do OpenCode ao carregar o plugin.
 * Todos os tipos aqui são definidos localmente para evitar dependência de tipos
 * inexistentes no pacote @opencode-ai/plugin.
 */

export interface SessionHooks {
  hook(event: string, handler: (event: unknown) => unknown): void;
  on(event: string, handler: (event: unknown) => unknown): void;
}

export interface SessionApp {
  log(data: {
    service: string;
    message: string;
    data?: Record<string, unknown>;
  }): void;
}

export interface SessionTools {
  register(name: string, tool: unknown): void;
}

export interface SessionToolHook {
  hook(event: string, handler: (input: unknown, output: unknown) => unknown): void;
}

export interface Session {
  session: SessionHooks;
  directory: string;
  app: SessionApp;
  tools: SessionTools;
  tool: SessionToolHook;
}

/**
 * Tipo do objeto retornado pela fábrica devkitPlugin.
 * O OpenCode v2 carrega o plugin e chama setup(ctx) com o contexto injetado.
 */
export interface DevKitPlugin {
  name: string;
  version: string;
  setup(ctx: Session): void;
}

/**
 * Eventos de session com propriedades tipadas.
 */

export interface ContextHookEvent {
  messages: Array<{
    content?: string | unknown[];
    role?: string;
  }>;
  system: {
    push: (part: { type: string; text: string }) => void;
  };
}

export interface SessionCreatedEvent {
  properties: {
    sessionID: string;
  };
}

export interface SessionIdleEvent {
  properties: {
    sessionID: string;
  };
  messages: Array<{
    role: string;
    content?: string | unknown[];
  }>;
}

export interface FileEditedEvent {
  properties: {
    path: string;
    diff?: string;
    sessionID: string;
  };
}

export interface ToolExecuteBeforeInput {
  tool: string;
  args: {
    filePath: string;
  };
}

export interface ToolExecuteBeforeOutput {
  args: { filePath: string };
}
