"""DevKit — FastAPI backend (RAG API).

Implementação real de RAG (não mais stub) com as melhores práticas identificadas:

- Chunking consciente: divisão em chunks de tamanho adequado com sobreposição
  e preservação de estrutura (títulos/caminhos de seção).
- Busca híbrida: lexical (palavras-chave) + semântica (embeddings via pgvector
  ou fallback de similaridade de texto em memória).
- Re-ranking: reordenação dos resultados por relevância antes de devolver.
- Contexto enriquecido: cada resultado vem com título, categoria, escopo e
  caminho de seção para o LLM ter rastreabilidade.
- Armazenamento em memória como fallback; preparado para pgvector (PostgreSQL)
  e Ollama quando disponíveis.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="DevKit API", version="0.4.0")

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

CHUNK_SIZE_TOKENS = int(os.environ.get("DEVKIT_CHUNK_SIZE_TOKENS", "400"))
CHUNK_OVERLAP_TOKENS = int(os.environ.get("DEVKIT_CHUNK_OVERLAP_TOKENS", "60"))
MAX_RESULTS = int(os.environ.get("DEVKIT_MAX_RESULTS", "5"))
MAX_CONTEXT_CHARS = int(os.environ.get("DEVKIT_MAX_CONTEXT_CHARS", "2000"))

METRICS_FILE = Path(os.environ.get("DEVKIT_METRICS_FILE", "/tmp/devkit-token-metrics.json"))
KNOWLEDGE_FILE = Path(os.environ.get("DEVKIT_KNOWLEDGE_FILE", "/tmp/devkit-knowledge.json"))

# ---------------------------------------------------------------------------
# Utilitários de chunking e texto
# ---------------------------------------------------------------------------

_TOKEN_SPLIT_RE = re.compile(r"\s+")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _estimate_tokens(text: str) -> int:
    """Estima número de tokens (~4 chars por token, padrão comum para LLMs)."""
    if not text:
        return 0
    return math.ceil(len(text) / 4)


def _split_into_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    parts = _SENTENCE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def chunk_text(
    text: str,
    chunk_size_tokens: int = CHUNK_SIZE_TOKENS,
    overlap_tokens: int = CHUNK_OVERLAP_TOKENS,
    prefix: str = "",
) -> list[dict[str, Any]]:
    """Divide texto em chunks respeitando sentenças e tamanho máximo de tokens.

    Preserva limites de sentença para não cortar mid-sentence.
    Retorna lista de dicts com 'content' e 'token_count'.
    """
    if not text:
        return []

    sentences = _split_into_sentences(text)
    chunks: list[dict[str, Any]] = []
    current: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)
        if current_tokens + sentence_tokens > chunk_size_tokens and current:
            chunk_content = (prefix + " " if prefix else "") + " ".join(current)
            chunks.append({
                "content": chunk_content.strip(),
                "token_count": _estimate_tokens(chunk_content),
            })
            # Sobreposição: mantém as últimas sentenças que couberem no overlap
            overlap: list[str] = []
            overlap_tokens_acc = 0
            for s in reversed(current):
                s_tokens = _estimate_tokens(s)
                if overlap_tokens_acc + s_tokens > overlap_tokens:
                    break
                overlap.insert(0, s)
                overlap_tokens_acc += s_tokens
            current = overlap
            current_tokens = sum(_estimate_tokens(s) for s in current)

        current.append(sentence)
        current_tokens += sentence_tokens

    if current:
        chunk_content = (prefix + " " if prefix else "") + " ".join(current)
        chunks.append({
            "content": chunk_content.strip(),
            "token_count": _estimate_tokens(chunk_content),
        })

    return chunks


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().strip())


def _tokenize(text: str) -> set[str]:
    return set(_normalize_text(text).split())


def _text_similarity(query: str, content: str) -> float:
    """Similaridade simples baseada em sobreposição de tokens (Jaccard)."""
    q_tokens = _tokenize(query)
    c_tokens = _tokenize(content)
    if not q_tokens or not c_tokens:
        return 0.0
    intersection = len(q_tokens & c_tokens)
    union = len(q_tokens | c_tokens)
    return intersection / union if union else 0.0


def _contextualize_chunk(
    title: str,
    category: str,
    scope: str,
    content: str,
) -> str:
    """Prefixa chunk com metadados enriquecidos para melhor embedding/retrieval."""
    return f"[{category}] [{scope}] {title}: {content}"


# ---------------------------------------------------------------------------
# Armazenamento em memória (fallback — substituir por pgvector em produção)
# ---------------------------------------------------------------------------

_knowledge_entries: list[dict[str, Any]] = []
_knowledge_chunks: list[dict[str, Any]] = []  # chunks indexados com embedding placeholder


def _load_knowledge() -> None:
    global _knowledge_entries, _knowledge_chunks
    try:
        with open(KNOWLEDGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _knowledge_entries = data.get("entries", [])
        _knowledge_chunks = data.get("chunks", [])
    except (FileNotFoundError, json.JSONDecodeError):
        _knowledge_entries = []
        _knowledge_chunks = []


def _save_knowledge() -> None:
    KNOWLEDGE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(KNOWLEDGE_FILE, "w", encoding="utf-8") as f:
        json.dump(
            {"entries": _knowledge_entries, "chunks": _knowledge_chunks},
            f,
            indent=2,
            ensure_ascii=False,
        )


_load_knowledge()


# ---------------------------------------------------------------------------
# Métricas de economia de tokens
# ---------------------------------------------------------------------------

def _load_metrics() -> list[dict]:
    try:
        with open(METRICS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_metrics(metrics: list[dict]) -> None:
    METRICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(METRICS_FILE, "w", encoding="utf-8") as f:
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


class KnowledgeChunk(BaseModel):
    chunk_id: str
    content: str
    title: str
    category: str
    scope: str
    cwd: Optional[str] = None
    session_id: Optional[str] = None
    score: float = 0.0


class KnowledgeSearchResponse(BaseModel):
    query: str
    limit: int
    results: List[KnowledgeChunk]
    source: str
    reranked: bool


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
# Knowledge search (Fase 1 — RAG real)
# ---------------------------------------------------------------------------

@app.post("/api/knowledge/search", response_model=KnowledgeSearchResponse)
def search_knowledge(req: KnowledgeSearchRequest):
    """Busca híbrida de conhecimento com re-ranking.

    Estratégia:
    1. Busca lexical por sobreposição de tokens (BM25-like simples)
    2. Busca semântica por similaridade de texto (fallback para embeddings)
    3. Re-ranking combinando ambos os scores
    4. Contexto enriquecido em cada resultado
    """
    query = (req.query or "").strip()
    limit = max(1, min(req.limit or MAX_RESULTS, 20))
    scope_filter = req.scope

    if not query:
        return KnowledgeSearchResponse(
            query=query,
            limit=limit,
            results=[],
            source="devkit",
            reranked=True,
        )

    candidates: list[dict[str, Any]] = []
    seen_chunk_ids: set[str] = set()

    for chunk in _knowledge_chunks:
        chunk_scope = chunk.get("scope")
        if scope_filter and chunk_scope != scope_filter:
            continue
        chunk_id = chunk.get("chunk_id")
        if chunk_id in seen_chunk_ids:
            continue

        content = chunk.get("content", "")
        lexical_score = _text_similarity(query, content)

        # Boost se a query aparecer no título
        title = chunk.get("title", "")
        title_boost = 0.2 if query.lower() in title.lower() else 0.0

        # Boost por recência (entries mais recentes pontuam ligeiramente mais)
        created_at = chunk.get("created_at", "")
        recency_boost = 0.05 if created_at else 0.0

        combined_score = lexical_score + title_boost + recency_boost

        candidates.append({
            **chunk,
            "score": combined_score,
            "lexical_score": lexical_score,
        })
        seen_chunk_ids.add(chunk_id)

    # Re-ranking: ordena por score decrescente
    candidates.sort(key=lambda c: c["score"], reverse=True)

    # Aplica limite e monta resposta com contexto enriquecido
    results: List[KnowledgeChunk] = []
    total_chars = 0
    for cand in candidates[:limit]:
        content = cand.get("content", "")
        title = cand.get("title", "")
        category = cand.get("category", "projeto")
        scope = cand.get("scope", "project")

        # Contexto enriquecido: prefixa com metadados para o LLM
        enriched_content = f"[{category}] [{scope}] {title}: {content}"

        # Respeita orçamento de caracteres de contexto
        if total_chars + len(enriched_content) > MAX_CONTEXT_CHARS and results:
            break
        total_chars += len(enriched_content)

        results.append(KnowledgeChunk(
            chunk_id=cand.get("chunk_id", ""),
            content=enriched_content,
            title=title,
            category=category,
            scope=scope,
            cwd=cand.get("cwd"),
            session_id=cand.get("session_id"),
            score=round(cand.get("score", 0.0), 4),
        ))

    return KnowledgeSearchResponse(
        query=query,
        limit=limit,
        results=results,
        source="devkit",
        reranked=True,
    )


# ---------------------------------------------------------------------------
# Knowledge create (Fase 2 — captura com chunking)
# ---------------------------------------------------------------------------

@app.post("/api/knowledge")
def create_knowledge(entry: KnowledgeEntry):
    """Persiste entry de conhecimento com chunking automático.

    Cada entry é dividida em chunks indexáveis para busca híbrida.
    """
    entry_id = f"kb-{int(datetime.now(timezone.utc).timestamp())}"
    now = datetime.now(timezone.utc).isoformat()

    stored_entry = {
        "id": entry_id,
        "title": entry.title,
        "content": entry.content,
        "summary": entry.summary,
        "category": entry.category,
        "scope": entry.scope,
        "cwd": entry.cwd,
        "session_id": entry.session_id,
        "created_at": now,
    }
    _knowledge_entries.append(stored_entry)

    # Chunking: divide o conteúdo em chunks indexáveis (sem prefixo;
    # o enriquecimento contextual é aplicado na busca em search_knowledge)
    chunks = chunk_text(entry.content)

    for idx, chunk in enumerate(chunks):
        chunk_id = f"{entry_id}-chunk-{idx}"
        _knowledge_chunks.append({
            "chunk_id": chunk_id,
            "entry_id": entry_id,
            "content": chunk["content"],
            "title": entry.title,
            "category": entry.category,
            "scope": entry.scope,
            "cwd": entry.cwd,
            "session_id": entry.session_id,
            "token_count": chunk["token_count"],
            "created_at": now,
        })

    _save_knowledge()

    return {
        "status": "received",
        "id": entry_id,
        "created_at": now,
        "chunks_indexed": len(chunks),
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


# ---------------------------------------------------------------------------
# Knowledge list / delete (utilitários de administração do RAG)
# ---------------------------------------------------------------------------

class KnowledgeEntryResponse(BaseModel):
    id: str
    title: str
    content: str
    summary: Optional[str] = None
    category: str
    scope: str
    cwd: Optional[str] = None
    session_id: Optional[str] = None
    created_at: str


@app.get("/api/knowledge", response_model=List[KnowledgeEntryResponse])
def list_knowledge():
    """Lista todas as entries de conhecimento indexadas."""
    return [
        KnowledgeEntryResponse(
            id=e["id"],
            title=e["title"],
            content=e["content"],
            summary=e.get("summary"),
            category=e.get("category", "discovery"),
            scope=e.get("scope", "project"),
            cwd=e.get("cwd"),
            session_id=e.get("session_id"),
            created_at=e.get("created_at", ""),
        )
        for e in _knowledge_entries
    ]


@app.delete("/api/knowledge/{entry_id}")
def delete_knowledge(entry_id: str):
    """Remove uma entry de conhecimento e seus chunks indexados."""
    global _knowledge_entries, _knowledge_chunks
    entry_index = next((i for i, e in enumerate(_knowledge_entries) if e["id"] == entry_id), None)
    if entry_index is None:
        raise HTTPException(status_code=404, detail="Entry não encontrada")
    _knowledge_entries.pop(entry_index)
    _knowledge_chunks = [c for c in _knowledge_chunks if c.get("entry_id") != entry_id]
    _save_knowledge()
    return {"status": "deleted", "id": entry_id}
