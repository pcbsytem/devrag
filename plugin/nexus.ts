/**
 * nexus.ts — Orquestração de sessões de agente via OpenCode SDK (Fase 5).
 *
 * Conecta ao servidor OpenCode através de createOpencodeClient (@opencode-ai/sdk)
 * para listar, criar e cancelar sessões, acompanhar progresso por stream (SSE)
 * e reportar status de tasks ao backend FastAPI via /api/hook/*.
 *
 * Degradação graciosa: se o servidor OpenCode estiver fora, cada operação
 * retorna { data: null, error } em vez de lançar exceção. O agente continua
 * funcionando normalmente.
 *
 * Nenhuma referência a PII é feita em logs. Todos os erros são comparados
 * por código, nunca por mensagem.
 * ZERO `any`, ZERO `as unknown as`.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type {
  Session as SdkSession,
  SessionStatus as SdkSessionStatus,
  Event as SdkEvent,
  TextPartInput,
} from "@opencode-ai/sdk";
import { devkitCall } from "./client";

const DEFAULT_BASE_URL = "http://127.0.0.1:3333";
const DEFAULT_DIRECTORY = process.cwd();

/**
 * Sessão de agente no servidor OpenCode, mapeada para o domínio DevKit.
 */
export interface NexusSession {
  id: string;
  title: string;
  directory: string;
  status: "idle" | "busy" | "retry";
  createdAt: number;
  updatedAt: number;
}

/**
 * Resultado da execução de uma task via agente.
 */
export interface NexusTaskResult {
  taskId: string;
  sessionId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  output?: string;
  error?: string;
}

/**
 * Evento de stream (SSE) repassado ao consumidor (dashboard/UI).
 */
export interface NexusStreamEvent {
  type: string;
  sessionId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Resultado genérico de operação: dados ou erro, nunca exceção.
 */
export interface NexusResult<T> {
  data: T | null;
  error: string | null;
}

/**
 * Handle para encerrar um stream de eventos aberto.
 */
export interface StreamHandle {
  abort: () => void;
}

/**
 * Opções de configuração do Nexus.
 */
export interface NexusOptions {
  baseUrl?: string;
  directory?: string;
  onEvent?: (event: NexusStreamEvent) => void;
}

/**
 * Forma mínima compatível com o RequestResult do SDK
 * (ThrowOnError=false, responseStyle="fields").
 * Usada para acessar data/error sem depender dos tipos genéricos complexos do SDK.
 */
type SdkResponseShape = {
  data: unknown;
  error: unknown;
  request: Request;
  response: Response;
};

/**
 * Mapeia SessionStatus do SDK para o enum simplificado do Nexus.
 */
function mapSessionStatus(status: SdkSessionStatus): "idle" | "busy" | "retry" {
  if (status.type === "idle") return "idle";
  if (status.type === "busy") return "busy";
  return "retry";
}

/**
 * Converte um SdkSession em NexusSession (sem status, que vem separado via session.status()).
 */
function sdkSessionToNexus(sdk: SdkSession): Omit<NexusSession, "status"> {
  return {
    id: sdk.id,
    title: sdk.title,
    directory: sdk.directory,
    createdAt: sdk.time.created,
    updatedAt: sdk.time.updated,
  };
}

/**
 * Extrai sessionID de um evento do SDK, quando disponível.
 * Nunca lança: retorna undefined se não houver sessionID.
 */
function extractSessionId(event: SdkEvent): string | undefined {
  const props = event.properties as Record<string, unknown>;
  const sid = props.sessionID;
  return typeof sid === "string" ? sid : undefined;
}

/**
 * Converte um Evento do SDK em NexusStreamEvent.
 */
function sdkEventToNexus(event: SdkEvent): NexusStreamEvent {
  return {
    type: event.type,
    sessionId: extractSessionId(event),
    timestamp: new Date().toISOString(),
    data: (event.properties as Record<string, unknown>) ?? {},
  };
}

/**
 * Classe Nexus — orquestração de sessões de agente sobre o SDK do OpenCode.
 */
export class Nexus {
  private readonly client: OpencodeClient;
  private readonly directory: string;
  private readonly onEvent?: (event: NexusStreamEvent) => void;
  private activeStreams = new Set<AbortController>();

  constructor(options: NexusOptions = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.directory = options.directory ?? DEFAULT_DIRECTORY;
    this.onEvent = options.onEvent;

    this.client = createOpencodeClient({
      baseUrl,
      directory: this.directory,
    });
  }

  // =========================================================================
  // Sessões
  // =========================================================================

  /**
   * Lista todas as sessões ativas no servidor OpenCode, enriquecidas com status.
   */
  async listSessions(): Promise<NexusResult<NexusSession[]>> {
    try {
      const response = await this.client.session.list({
        query: { directory: this.directory },
      });
      const shaped = response as SdkResponseShape;

      if (shaped.error !== undefined) {
        return { data: null, error: String(shaped.error) };
      }

      const sdkSessions = shaped.data as SdkSession[];

      // Busca status de todas as sessões
      const statusResponse = await this.client.session.status({
        query: { directory: this.directory },
      });
      const shapedStatus = statusResponse as SdkResponseShape;

      let statusMap: Record<string, SdkSessionStatus> = {};
      if (shapedStatus.error === undefined && shapedStatus.data !== undefined) {
        statusMap = shapedStatus.data as Record<string, SdkSessionStatus>;
      }

      return {
        data: sdkSessions.map((s) => ({
          ...sdkSessionToNexus(s),
          status: mapSessionStatus(statusMap[s.id] ?? { type: "idle" }),
        })),
        error: null,
      };
    } catch (err) {
      return { data: null, error: `Falha ao listar sessões: ${String(err)}` };
    }
  }

  /**
   * Cria uma nova sessão de agente no servidor OpenCode.
   */
  async createSession(
    title?: string,
    directory?: string,
  ): Promise<NexusResult<NexusSession>> {
    try {
      const response = await this.client.session.create({
        body: { title },
        query: { directory: directory ?? this.directory },
      });
      const shaped = response as SdkResponseShape;

      if (shaped.error !== undefined) {
        return { data: null, error: String(shaped.error) };
      }

      const sdk = shaped.data as SdkSession;
      return {
        data: { ...sdkSessionToNexus(sdk), status: "idle" },
        error: null,
      };
    } catch (err) {
      return { data: null, error: `Falha ao criar sessão: ${String(err)}` };
    }
  }

  /**
   * Cancela (aborta) uma sessão pelo ID.
   */
  async cancelSession(sessionId: string): Promise<NexusResult<boolean>> {
    try {
      const response = await this.client.session.abort({
        path: { id: sessionId },
        query: { directory: this.directory },
      });
      const shaped = response as SdkResponseShape;

      if (shaped.error !== undefined) {
        return { data: null, error: String(shaped.error) };
      }

      return { data: true, error: null };
    } catch (err) {
      return { data: null, error: `Falha ao cancelar sessão ${sessionId}: ${String(err)}` };
    }
  }

  /**
   * Obtém uma sessão específica pelo ID.
   */
  async getSession(sessionId: string): Promise<NexusResult<NexusSession>> {
    try {
      const response = await this.client.session.get({
        path: { id: sessionId },
        query: { directory: this.directory },
      });
      const shaped = response as SdkResponseShape;

      if (shaped.error !== undefined) {
        return { data: null, error: String(shaped.error) };
      }

      const sdk = shaped.data as SdkSession;
      return {
        data: { ...sdkSessionToNexus(sdk), status: "idle" },
        error: null,
      };
    } catch (err) {
      return { data: null, error: `Falha ao obter sessão ${sessionId}: ${String(err)}` };
    }
  }

  // =========================================================================
  // Tasks (execução via agente)
  // =========================================================================

  /**
   * Executa uma task enviando um prompt de texto para uma sessão existente
   * (promptAsync — retorna imediatamente, o agente processa em background).
   *
   * Como o SDK retorna 204 No Content (void) para promptAsync, o taskId é
   * gerado localmente e o progresso é acompanhado pelo stream de eventos.
   */
  async executeTask(
    sessionId: string,
    prompt: string,
  ): Promise<NexusResult<NexusTaskResult>> {
    try {
      const taskId = `task-${Date.now()}`;

      const textPart: TextPartInput = {
        type: "text",
        text: prompt,
      };

      const response = await this.client.session.promptAsync({
        body: {
          parts: [textPart],
        },
        path: { id: sessionId },
        query: { directory: this.directory },
      });
      const shaped = response as SdkResponseShape;

      if (shaped.error !== undefined) {
        return {
          data: null,
          error: String(shaped.error),
        };
      }

      // Reporta início da task ao backend FastAPI via /api/hook/task-status
      await this.reportTaskStatus(sessionId, taskId, "running");

      return {
        data: {
          taskId,
          sessionId,
          status: "running",
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: `Falha ao executar task: ${String(err)}` };
    }
  }

  /**
   * Reporta o status de uma task ao backend FastAPI via /api/hook/task-status.
   * Nunca lança: se o backend estiver fora, silenciosamente ignora.
   */
  async reportTaskStatus(
    sessionId: string,
    taskId: string,
    status: "running" | "completed" | "failed" | "cancelled",
    output?: string,
    errorMessage?: string,
  ): Promise<void> {
    await devkitCall("/api/hook/task-status", {
      session_id: sessionId,
      task_id: taskId,
      status,
      output,
      error: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // =========================================================================
  // Stream de eventos (SSE)
  // =========================================================================

  /**
   * Abre um stream SSE de eventos globais do servidor OpenCode.
   * Cada evento é repassado via onEvent (se fornecido).
   * Retorna um handle para abortar o stream.
   *
   * Degradação graciosa: se o servidor estiver fora, retorna handle no-op.
   */
  streamEvents(onEvent?: (event: NexusStreamEvent) => void): StreamHandle {
    const controller = new AbortController();
    this.activeStreams.add(controller);

    const handler = (event: NexusStreamEvent): void => {
      this.onEvent?.(event);
      onEvent?.(event);
    };

    (async () => {
      try {
        const response = await this.client.global.event();
        const shaped = response as { stream: AsyncGenerator<SdkEvent> };
        const stream = shaped.stream;

        for await (const sdkEvent of stream) {
          if (controller.signal.aborted) break;
          handler(sdkEventToNexus(sdkEvent));
        }
      } catch {
        // Stream encerrado ou erro de conexão — degradação graciosa
      } finally {
        this.activeStreams.delete(controller);
      }
    })();

    return {
      abort: (): void => {
        controller.abort();
        this.activeStreams.delete(controller);
      },
    };
  }

  /**
   * Encerra todos os streams ativos.
   */
  close(): void {
    for (const controller of this.activeStreams) {
      controller.abort();
    }
    this.activeStreams.clear();
  }
}

/**
 * Factory: cria uma instância Nexus conectada ao servidor OpenCode.
 * Em caso de falha de conexão, a instância ainda é retornada e as operações
 * individuais degradam graciosamente (retornam erro em vez de lançar).
 */
export function createNexus(options: NexusOptions = {}): Nexus {
  return new Nexus(options);
}

/**
 * Verifica se o servidor OpenCode está respondendo, tentando listar sessões.
 * Usado para health check. Nunca lança.
 */
export async function nexusHealthCheck(baseUrl: string = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    const client = createOpencodeClient({ baseUrl, directory: DEFAULT_DIRECTORY });
    const response = await client.session.list({
      query: { directory: DEFAULT_DIRECTORY },
    });
    const shaped = response as SdkResponseShape;
    return shaped.error === undefined;
  } catch {
    return false;
  }
}
