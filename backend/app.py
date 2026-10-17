"""DevKit — FastAPI backend (RAG API).

Slice mínimo do backend para health check, busca de conhecimento,
hooks de captura (Fase 2) e orquestração de sessões via SDK (Fase 5).
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime, timezone
import asyncio
import json
import os
from pathlib import Path

app = FastAPI(title="DevKit API", version="0.3.0")

# ---------------------------------------------------------------------------
# Métricas de economia de tokens
# ---------------------------------------------------------------------------

_METRICS_FILE = Path(os.environ.get("DEVKIT_METRICS_FILE", "/tmp/devkit-token-metrics.json"))


def _load_metrics() -> list[dict]:
    try:
        with open(_METRICS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_metrics(metrics: list[dict]):
    _METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_METRICS_FILE, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: str


class KnowledgeSearchRequest(BaseModel):
    query: str
    limit: int = 5
    scope: Optional[str] = None
    cwd: Optional[str] = None


class KnowledgeSearchResponse(BaseModel):
    query: str
    limit: int
    results: List[dict]
    source: str


class KnowledgeEntry(BaseModel):
    title: str
    content: str
    summary: Optional[str] = None
    category: str = "discovery"
    scope: str = "project"
    cwd: Optional[str] = None
    session_id: Optional[str] = None


class HookEvent(BaseModel):
    session_id: Optional[str] = None
    cwd: Optional[str] = None
    file: Optional[str] = None
    tool: Optional[str] = None
    properties: Optional[dict[str, Any]] = None


class PreEditVerdict(BaseModel):
    block: bool = False
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/api/health", response_model=HealthResponse)
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Knowledge search (Fase 1)
# ---------------------------------------------------------------------------

@app.post("/api/knowledge/search", response_model=KnowledgeSearchResponse)
def search_knowledge(req: KnowledgeSearchRequest):
    # Stub — integração com pgvector/Ollama virá na fase de RAG completo.
    return {
        "query": req.query,
        "limit": req.limit,
        "results": [],
        "source": "devkit",
    }


# ---------------------------------------------------------------------------
# Knowledge create (Fase 2 — captura)
# ---------------------------------------------------------------------------

@app.post("/api/knowledge")
def create_knowledge(entry: KnowledgeEntry):
    # Stub — persiste entry de conhecimento (pgvector + Postgres) na fase
    # de RAG completo. Por enquanto apenas confirma o recebimento.
    return {
        "status": "received",
        "id": f"kb-{int(datetime.now(timezone.utc).timestamp())}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Hooks (Fase 2 — captura de eventos)
# ---------------------------------------------------------------------------

@app.post("/api/hook/session-start")
def hook_session_start(evt: HookEvent):
    return {"status": "received", "event": "session-start"}


@app.post("/api/hook/stop")
def hook_stop(evt: HookEvent):
    return {"status": "received", "event": "stop"}


@app.post("/api/hook/post-tool-use")
def hook_post_tool_use(evt: HookEvent):
    return {"status": "received", "event": "post-tool-use"}


@app.post("/api/hook/pre-edit-guard", response_model=PreEditVerdict)
def hook_pre_edit_guard(evt: HookEvent):
    # Stub — permite todas as edições por padrão. Regras reais virão na
    # fase de code review.
    return {"block": False, "reason": None}


# ---------------------------------------------------------------------------
# Nexus (Fase 5 — orquestração de sessões via OpenCode SDK)
# ---------------------------------------------------------------------------

class NexusSessionCreate(BaseModel):
    title: Optional[str] = None
    directory: Optional[str] = None


class NexusSessionResponse(BaseModel):
    id: str
    title: str
    directory: str
    status: str
    created_at: str
    updated_at: str


class NexusTaskRequest(BaseModel):
    session_id: str
    prompt: str


class NexusTaskResponse(BaseModel):
    task_id: str
    session_id: str
    status: str


class HookTaskStatus(BaseModel):
    session_id: str
    task_id: str
    status: str
    output: Optional[str] = None
    error: Optional[str] = None
    timestamp: Optional[str] = None


class TokenMetricRecord(BaseModel):
    timestamp: str
    query: str
    full_context_estimate: int
    rag_context_tokens: int
    savings_tokens: int
    savings_percent: float


class TokenMetricsResponse(BaseModel):
    total_tokens_saved: float
    average_savings_percent: float
    total_requests: int
    period: str


# Armazenamento em memória (stub — substituir por banco de dados em produção)
_nexus_sessions: dict[str, NexusSessionResponse] = {}
_nexus_event_queues: dict[str, asyncio.Queue] = {}


@app.post("/api/nexus/session", response_model=NexusSessionResponse)
def create_nexus_session(req: NexusSessionCreate):
    """Cria uma nova sessão de agente no Nexus."""
    session_id = f"nexus-{int(datetime.now(timezone.utc).timestamp())}"
    now = datetime.now(timezone.utc).isoformat()
    session = NexusSessionResponse(
        id=session_id,
        title=req.title or "Sessão",
        directory=req.directory or "",
        status="idle",
        created_at=now,
        updated_at=now,
    )
    _nexus_sessions[session_id] = session
    _nexus_event_queues[session_id] = asyncio.Queue()
    return session


@app.get("/api/nexus/sessions", response_model=List[NexusSessionResponse])
def list_nexus_sessions():
    """Lista todas as sessões Nexus registradas."""
    return list(_nexus_sessions.values())


@app.delete("/api/nexus/session/{session_id}")
def delete_nexus_session(session_id: str):
    """Cancela (remove) uma sessão Nexus pelo ID."""
    if session_id not in _nexus_sessions:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    del _nexus_sessions[session_id]
    _nexus_event_queues.pop(session_id, None)
    return {"status": "cancelled", "session_id": session_id}


@app.get("/api/nexus/session/{session_id}/stream")
async def stream_nexus_session(session_id: str):
    """Stream de progresso (SSE) de uma sessão Nexus."""
    if session_id not in _nexus_sessions:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    async def event_generator():
        queue = _nexus_event_queues.get(session_id)
        if queue is None:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Sessão sem stream'})}\n\n"
            return
        while True:
            event = await queue.get()
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/nexus/task", response_model=NexusTaskResponse)
def run_nexus_task(req: NexusTaskRequest):
    """Executa uma task via agente em uma sessão Nexus."""
    if req.session_id not in _nexus_sessions:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    task_id = f"task-{int(datetime.now(timezone.utc).timestamp())}"
    session = _nexus_sessions[req.session_id]
    session.status = "busy"
    session.updated_at = datetime.now(timezone.utc).isoformat()
    return NexusTaskResponse(
        task_id=task_id,
        session_id=req.session_id,
        status="running",
    )


@app.post("/api/hook/task-status")
def hook_task_status(evt: HookTaskStatus):
    """Repassa evento de status de task para o stream SSE da sessão."""
    queue = _nexus_event_queues.get(evt.session_id)
    if queue is not None:
        try:
            queue.put_nowait({
                "type": "task-status",
                "session_id": evt.session_id,
                "task_id": evt.task_id,
                "status": evt.status,
                "output": evt.output,
                "error": evt.error,
                "timestamp": evt.timestamp,
            })
        except Exception:
            # Fila cheia ou fechada — ignora silenciosamente
            pass
    return {"status": "received", "event": "task-status"}


# ---------------------------------------------------------------------------
# Métricas de economia de tokens
# ---------------------------------------------------------------------------

@app.post("/api/metrics/token-usage")
def record_token_metric(record: TokenMetricRecord):
    """Registra uma métrica de economia de tokens de uma requisição RAG."""
    metrics = _load_metrics()
    metrics.append(record.model_dump())
    _save_metrics(metrics)
    return {"status": "received", "recorded": len(metrics)}


@app.get("/api/metrics/savings", response_model=TokenMetricsResponse)
def get_savings_metrics():
    """Retorna métricas agregadas de economia de tokens."""
    metrics = _load_metrics()
    if not metrics:
        return TokenMetricsResponse(
            total_tokens_saved=0,
            average_savings_percent=0,
            total_requests=0,
            period="nunca",
        )

    total_saved = sum(m.get("savings_tokens", 0) for m in metrics)
    avg_percent = sum(m.get("savings_percent", 0) for m in metrics) / len(metrics)

    return TokenMetricsResponse(
        total_tokens_saved=round(total_saved, 2),
        average_savings_percent=round(avg_percent, 2),
        total_requests=len(metrics),
        period="últimas requisições",
    )


@app.get("/api/metrics/token-usage/history")
def get_token_metrics_history():
    """Retorna o histórico completo de métricas de tokens."""
    return _load_metrics()
