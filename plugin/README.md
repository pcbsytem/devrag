# DevKit Plugin — OpenCode v2

Plugin do DevKit para OpenCode v2. Substitui os 12 scripts shell
do Claude Code por um único plugin TypeScript que fala com o backend FastAPI
(http://127.0.0.1:4200).

## Estrutura

```
~/.config/opencode/plugins/devkit/
├── package.json    # dependências do plugin
├── index.ts        # registro de hooks (context, eventos, tools)
├── client.ts       # cliente HTTP + auth + graceful degradation
├── tools.ts        # custom tool devkit_recall
├── render.ts       # formatação do bloco de conhecimento + TRIVIAL_WORDS
├── capture.ts      # heurística de captura automática (Fase 2)
├── nexus.ts        # orquestração de sessões via OpenCode SDK (Fase 5)
└── server.ts       # wrapper para iniciar opencode serve headless (Fase 5)

~/.config/opencode/commands/
├── commit.md       # commit semântico em português (shell injection git)
├── pr.md           # criar pull request (shell injection git branch/diff)
├── board.md        # CRUD do board via API DevKit
├── apply.md        # aplicar mudanças sugeridas na API
└── kb-review.md    # revisar base de conhecimento via devkit_recall
```

## Requisitos inegociáveis

1. **Degradação graciosa**: se o FastAPI estiver fora de ar, o agente
   continua funcionando normalmente. Nenhuma exceção é lançada.
2. **Timeout de 5s** via AbortController.
3. **Sem ruído**: mensagens triviais (`ok`, `sim`, `commit`, etc.) não
   injetam conhecimento.
4. **Orçamento de contexto**: no máximo 5 entries, ~2000 tokens/injeção.
5. **Segredo fora do argv**: lido de `~/.claude/.credentials.json`.

## Como testar

1. Garanta o backend rodando:
   ```bash
   cd ~/.claude/extension/server
   uvicorn app:app --host 127.0.0.1 --port 4200
   ```
2. Abra o OpenCode e faça uma pergunta sobre um assunto que exista na
   base de conhecimento. O conhecimento deve aparecer no contexto **sem**
   o modelo pedir.
3. Teste a custom tool manualmente: chame `devkit_recall` com uma query.
4. Teste mensagem trivial ("ok"): nenhuma injeção, nenhuma chamada HTTP.
5. Derrube o FastAPI (`Ctrl+C` ou `docker stop`): o agente segue
   respondendo normalmente e o log registra a falha sem erro ao usuário.
6. Faça uma edição de arquivo: o evento `file.edited` dispara captura
   automática se houver indicadores de aprendizado.

### Fase 5 — Nexus (testar orquestração de sessões)

7. Defina a senha do servidor OpenCode:
   ```bash
   export OPENCODE_SERVER_PASSWORD="sua-senha-segura"
   ```
8. Inicie o servidor OpenCode headless:
   ```bash
   # Via módulo server.ts (requer o servidor OpenCode em PATH)
   npm run dev  # carrega o plugin; o server.ts é usado pelo dashboard
   ```
   Ou inicie manualmente:
   ```bash
   OPENCODE_SERVER_PASSWORD="sua-senha-segura" opencode serve --host 127.0.0.1 --port 3333
   ```
9. Garanta o backend FastAPI rodando (para hooks de status de tasks):
   ```bash
   cd ~/.claude/extension/server
   uvicorn app:app --host 127.0.0.1 --port 4200
   ```
10. O módulo `nexus.ts` expõe `createNexus()` para listar, criar e cancelar
    sessões, `streamEvents()` para acompanhar progresso via SSE e
    `reportTaskStatus()` para reportar status ao backend via
    `/api/hook/task-status`.
11. Degradação graciosa: se o servidor OpenCode estiver fora, `nexusHealthCheck()`
    retorna `false` e as operações retornam erro sem lançar exceção.

## Roadmap

### Fase 1 — RAG (concluída ✅)

- [x] Estrutura do plugin
- [x] client.ts (HTTP + auth + graceful degradation)
- [x] Injeção de contexto via session.hook("context")
- [x] devkit_recall (custom tool)
- [x] README com como testar

### Fase 2 — Captura e eventos (concluída ✅)

- [x] capture.ts (heurística TRIVIAL/STRONG/WEAK indicators)
- [x] session.created — registro de início de sessão
- [x] session.idle — captura de aprendizados ao final da sessão
- [x] file.edited — captura de mudanças de código
- [x] tool.execute.before — pré-edição com bloqueio real
- [x] Backend: /api/knowledge, /api/hook/* endpoints

### Fase 3 — Commands (concluída ✅)

Os commands estão em `~/.config/opencode/commands/` e usam shell injection (`!comando`) para coletar contexto antes do prompt existir, com degradação graciosa quando o backend está offline.

| Command | Arquivo | O que faz |
|---------|---------|-----------|
| `/commit` | `commit.md` | Commit semântico em português (feat/fix/docs/etc) com `git status`, `git diff --cached`, `git log` |
| `/pr` | `pr.md` | Criar pull request com `git branch`, `git diff main...HEAD`, `git log` |
| `/board` | `board.md` | CRUD do board via API DevKit (listar/mudar status/criar/deletar tasks) |
| `/apply` | `apply.md` | Aplicar mudanças sugeridas via API DevKit |
| `/kb-review` | `kb-review.md` | Revisar base de conhecimento via custom tool `devkit_recall` |

Cada command tem frontmatter YAML (`description` e `agent`), está em português brasileiro com acentuação correta e segue a regra de degradação graciosa: se o backend estiver fora de ar, o command continua funcionando offline.

#### Como usar

1. Garanta o backend rodando (para commands que dependem da API: board, apply):
   ```bash
   cd ~/.claude/extension/server
   uvicorn app:app --host 127.0.0.1 --port 4200
   ```
2. No OpenCode, digite `/commit`, `/pr`, `/board`, `/apply` ou `/kb-review`.
3. Os comandos coletam contexto automaticamente via shell injection antes de gerar o prompt.

#### Exemplos

- `/commit` → coleta `git status --short`, `git diff --cached --stat`, `git log --oneline -8` e gera uma mensagem de commit semântica em português.
- `/board list` → chama `GET /api/board/tasks` e exibe a tabela de tasks.
- `/kb-review` → chama `devkit_recall` para revisar a base de conhecimento antes de mudanças arquiteturais.

### Endpoints necessários para Fase 3 (backend FastAPI)

Os commands `/board` e `/apply` dependem de endpoints que ainda não existem em `app.py`. Para que funcionem plenamente, adicione ao backend:

| Endpoint | Método | Descrição | Usado por |
|----------|--------|-----------|-----------|
| `/api/board/tasks` | GET | Listar tasks do board | `/board` |
| `/api/board/tasks/{id}/status` | PATCH | Mudar status de uma task | `/board` |
| `/api/board/tasks` | POST | Criar nova task | `/board` |
| `/api/board/tasks/{id}` | DELETE | Deletar uma task | `/board` |
| `/api/apply/pending` | GET | Listar mudanças pendentes | `/apply` |
| `/api/apply/{id}` | GET | Detalhes de uma mudança | `/apply` |
| `/api/apply/{id}` | POST | Aplicar uma mudança | `/apply` |

Os comandos `/commit`, `/pr` e `/kb-review` não dependem de novos endpoints do backend (usam shell injection git e a custom tool `devkit_recall`, que já existe via `GET /api/knowledge/search`).

### Fase 4 — Agents (concluída ✅)

Os agents ficam em `~/.config/opencode/agents/` (um arquivo `.md` por agent), com frontmatter YAML (description, mode, model, temperature, permission) e instruções em português brasileiro. Todos referenciam o `AGENTS.md` como contrato global e chamam `devkit_recall` antes de mudanças arquiteturais.

#### Primários (tab alterna entre eles)

| Agent | Modelo | Temp | Permissão | Papel |
|-------|--------|------|-----------|-------|
| `build.md` | sonnet | 0.5 | edit/write/allow | Agente padrão, uso diário, engenharia sênior |
| `dk-debate.md` | opus | 0.7 | edit/write/allow | Arquiteto que questiona até consenso |
| `dk-work.md` | sonnet | 0.3 | edit/write/allow | Executor autônomo de tasks do board |
| `peer-arch.md` | opus | 0.5 | edit/write/allow | Coordenação N-way entre projetos |

#### Subagents (invocados por `@nome` ou pelo primary)

| Agent | Modelo | Temp | Permissão | Papel |
|-------|--------|------|-----------|-------|
| `req-explorer.md` | haiku | 0.3 | edit/write: deny | Gateway do pipeline de requisitos |
| `survey.md` | haiku | 0.2 | edit/write: deny | Inspeção profunda de código |
| `deep-debug.md` | sonnet | 0.3 | edit/write/allow | Depuração profunda (causa raiz) |
| `investigate.md` | sonnet | 0.3 | edit/write: deny, hidden: true | Investigação de erro (invocado pelo plugin) |
| `dk-review.md` | opus | 0.1 | edit/write: deny | Code review sênior (apenas leitura) |
| `dk-qa.md` | sonnet | 0.4 | edit/write/allow | QA via Playwright MCP |
| `appsec.md` | sonnet | 0.2 | edit/write: deny, bash: allow | Segurança via SAST (bash) |
| `ui-senior.md` | sonnet | 0.8 | edit/write: deny | UI sênior (apenas leitura) |
| `ux-content.md` | sonnet | 0.8 | edit/write: deny | UX content (apenas leitura) |
| `dk-learn.md` | haiku | 0.2 | edit/write/allow | Ingestão de PDF/URL no RAG |
| `prompt-gen.md` | sonnet | 0.6 | edit/write/allow | Geração de prompts |
| `dk-roundtable.md` | sonnet | 0.6 | edit/write/allow | Debate multi-modelo via OpenRouter |

#### Convenções aplicadas a todos os agents

- Frontmatter YAML completo (description, mode, model, temperature, permission).
- Permissões como garantia, não convenção (`permission: {edit: deny}` para review/design).
- Instruções em português brasileiro com acentuação correta.
- Chamar `devkit_recall` antes de mudanças arquiteturais.
- Referenciar o `AGENTS.md` como contrato global.
- Nenhuma referência à palavra proibida em qualquer arquivo.

### Fase 5 — Nexus sobre o SDK (concluída ✅)

- [x] `nexus.ts` — orquestração via `createOpencodeClient` (@opencode-ai/sdk)
- [x] `server.ts` — wrapper `opencode serve` com `OPENCODE_SERVER_PASSWORD`
- [x] Backend: endpoints `/api/nexus/*` e `/api/hook/task-status`
- [x] Stream de progresso via SSE (`/api/nexus/session/:id/stream`)
- [x] Degradação graciosa se o servidor OpenCode estiver fora

#### Endpoints Nexus (backend FastAPI)

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/nexus/session` | POST | Criar sessão de agente |
| `/api/nexus/sessions` | GET | Listar sessões |
| `/api/nexus/session/{id}` | DELETE | Cancelar sessão |
| `/api/nexus/session/{id}/stream` | GET | Stream de progresso (SSE) |
| `/api/nexus/task` | POST | Executar task via agente |
| `/api/hook/task-status` | POST | Reportar status de task (hook) |

#### Módulos TypeScript

| Módulo | Responsabilidade |
|--------|-----------------|
| `nexus.ts` | Conecta ao OpenCode via SDK; lista/cria/cancela sessões; stream SSE; reporta hooks |
| `server.ts` | Inicia `opencode serve` headless com senha; health check do servidor |

Não faça nesta fase: commands, agents, migrations.
