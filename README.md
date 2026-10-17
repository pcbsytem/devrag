# DevRAG — RAG Contextual para Desenvolvimento de Software

DevRAG é um sistema de RAG (Retrieval-Augmented Generation) contextual para OpenCode v2. Ele captura aprendizados das sessões de desenvolvimento, indexa com embeddings vetoriais e injeta o conhecimento relevante de volta no contexto do agente antes de cada resposta.

## 🚀 Instalação Rápida

### Pré-requisitos

- **OpenCode v2+** instalado
- **Docker** e Docker Compose (para PostgreSQL + Redis)
- **Node.js** 18+ (para MCPs)
- **Python 3.11+** (para o backend FastAPI)
- **Ollama** (para embeddings e LLM local)

### 1. Clonar o repositório

```bash
git clone https://github.com/seu-usuario/devrag.git
cd devrag
```

### 2. Subir a infraestrutura

```bash
# Docker Compose sobe PostgreSQL + Redis
docker compose -f infra/docker-compose.yml up -d
```

### 3. Instalar o Ollama e modelos

```bash
# Instalar Ollama (se não tiver)
# Windows: irm https://ollama.com/install.ps1 | iex
# Linux/Mac: curl -fsSL https://ollama.com/install.sh | sh

# Baixar modelos necessários
ollama pull nomic-embed-text
ollama pull gemma3:4b
```

### 4. Instalar dependências do backend

```powershell
# Windows (PowerShell)
.\install.ps1 --backend-only
```

```bash
# Linux/Mac
chmod +x install.sh
./install.sh --backend-only
```

### 5. Configurar o plugin DevRAG no OpenCode

Copie a configuração do OpenCode:

```bash
# Copiar opencode.json para ~/.config/opencode/
cp opencode.json ~/.config/opencode/

# Copiar plugin para ~/.config/opencode/plugins/
cp -r plugin/* ~/.config/opencode/plugins/devkit/

# Copiar commands
cp -r commands/* ~/.config/opencode/commands/

# Copiar agents
cp -r agents/* ~/.config/opencode/agents/

# Copiar AGENTS.md
cp AGENTS.md ~/.config/opencode/
```

### 6. Instalar dependências do plugin

```powershell
# Windows
cd plugin
npm install
```

```bash
# Linux/Mac
cd plugin
npm install
```

### 7. Instalar MCPs

```powershell
# Windows
.\install.ps1 --mcps
```

```bash
# Linux/Mac
./install.sh --mcps
```

### 8. Iniciar o backend

```powershell
# Windows
cd backend
python -m uvicorn app:app --host 127.0.0.1 --port 4200
```

```bash
# Linux/Mac
cd backend
python -m uvicorn app:app --host 127.0.0.1 --port 4200
```

### 9. Validar a instalação

```bash
# Health check do backend
curl http://127.0.0.1:4200/api/health

# Health check do Ollama
curl http://127.0.0.1:11434/api/tags

# Versão do OpenCode
opencode --version
```

Todos devem retornar sucesso.

---

## 📁 Estrutura do Repositório

```
devrag/
├── backend/                 # FastAPI backend (RAG API)
│   └── app.py
├── plugin/                  # Plugin DevRAG para OpenCode v2
│   ├── index.ts             # Hooks de contexto + captura + eventos
│   ├── client.ts            # HTTP client + auth + graceful degradation
│   ├── tools.ts             # devkit_recall (custom tool)
│   ├── render.ts            # Formatação de bloco + TRIVIAL_WORDS
│   ├── capture.ts           # Heurística de captura automática
│   ├── nexus.ts             # Orquestração via OpenCode SDK
│   ├── server.ts            # Wrapper headless opencode serve
│   ├── package.json         # Dependências
│   ├── tsconfig.json        # Build gate
│   └── README.md
├── commands/                # Commands do OpenCode
│   ├── commit.md
│   ├── pr.md
│   ├── board.md
│   ├── apply.md
│   └── kb-review.md
├── agents/                  # Agents do OpenCode v2
│   ├── build.md
│   ├── dk-debate.md
│   ├── dk-work.md
│   ├── peer-arch.md
│   ├── req-explorer.md
│   ├── survey.md
│   ├── deep-debug.md
│   ├── investigate.md
│   ├── dk-review.md
│   ├── dk-qa.md
│   ├── appsec.md
│   ├── ui-senior.md
│   ├── ux-content.md
│   ├── dk-learn.md
│   ├── prompt-gen.md
│   └── dk-roundtable.md
├── infra/                   # Infraestrutura (Docker Compose)
│   └── docker-compose.yml
├── docs/                    # Documentação
│   └── MCPS.md
├── opencode.json            # Configuração do OpenCode
├── AGENTS.md                # Postura global do projeto
├── install.ps1              # Script de instalação (Windows)
├── install.sh               # Script de instalação (Linux/Mac)
├── .env.example             # Variáveis de ambiente
└── .gitignore               # Arquivos a ignorar
```

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENTE (OpenCode v2)                         │
│  Hooks: session.hook("context") — RAG push automático           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              PLUGIN DEVRAG (~/.config/opencode/plugins/)        │
│  • client.ts     — HTTP client + auth + graceful degradation    │
│  • index.ts      — Hooks: contexto, captura, eventos            │
│  • tools.ts      — devkit_recall (busca conhecimento)           │
│  • capture.ts    — Heurística TRIVIAL/STRONG/WEAK indicators    │
│  • nexus.ts      — Orquestração via OpenCode SDK                │
│  • server.ts     — Wrapper headless opencode serve              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND FASTAPI (http://127.0.0.1:4200)            │
│  • GET  /api/health                                             │
│  • POST /api/knowledge/search  (busca híbrida vetorial+texto)   │
│  • POST /api/knowledge         (captura de aprendizados)        │
│  • POST /api/hook/*            (eventos de sessão)              │
│  • POST /api/nexus/*           (orquestração de sessões)        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              INFRAESTRUTURA (Docker Compose)                    │
│  • PostgreSQL 16 + pgvector  (porta 5432)                       │
│  • Redis 7                       (porta 6379)                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              OLLAMA (http://127.0.0.1:11434)                    │
│  • nomic-embed-text  (embeddings 768d)                          │
│  • gemma3:4b         (LLM para respostas)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 MCPs Configurados

DevRAG inclui os seguintes MCPs (Model Context Protocol):

| MCP | Pacote | Uso |
|-----|--------|-----|
| **postgres** | `@modelcontextprotocol/server-postgres` | Acesso SQL ao PostgreSQL |
| **filesystem** | `@modelcontextprotocol/server-filesystem` | Leitura/escrita de arquivos |
| **memory** | `@modelcontextprotocol/server-memory` | Memória persistente entre sessões |
| **kb-rag** | `kb-mcp-server` | Base de conhecimento RAG |

Configure em `opencode.json` na seção `"mcp"`.

---

## 📋 Comandos Disponíveis

| Command | Arquivo | Descrição |
|---------|---------|-----------|
| `/commit` | `commands/commit.md` | Commit semântico em português |
| `/pr` | `commands/pr.md` | Criar pull request |
| `/board` | `commands/board.md` | CRUD do board de tasks |
| `/apply` | `commands/apply.md` | Aplicar mudanças sugeridas |
| `/kb-review` | `commands/kb-review.md` | Revisar base de conhecimento |

---

## 🤖 Agents Disponíveis

**Primários:**
| Agent | Modelo | Temp | Papel |
|-------|--------|------|-------|
| `build` | sonnet | 0.5 | Agente padrão, uso diário |
| `dk-debate` | opus | 0.7 | Arquiteto, questiona até consenso |
| `dk-work` | sonnet | 0.3 | Executor de tasks do board |
| `peer-arch` | opus | 0.5 | Coordenação N-way entre projetos |

**Subagents (via `@nome`):**
`req-explorer`, `survey`, `deep-debug`, `investigate`, `dk-review`, `dk-qa`, `appsec`, `ui-senior`, `ux-content`, `dk-learn`, `prompt-gen`, `dk-roundtable`

---

## 🔒 Requisitos Inegociáveis

1. **Degradação graciosa**: se o FastAPI estiver fora de ar, o agente continua funcionando
2. **Timeout de 5s** via AbortController
3. **Sem ruído**: mensagens triviais não injetam conhecimento
4. **Orçamento de contexto**: no máximo 5 entries, ~2000 tokens/injeção
5. **Segredo fora do argv**: lido de `~/.claude/.credentials.json`
6. **TypeScript estrito**: zero `any`, zero `as unknown as`

---

## 📄 Licença

MIT License

---

## 🤝 Contribuindo

1. Faça um fork do repositório
2. Crie uma branch para sua feature
3. Faça commit das mudanças
4. Abra um Pull Request

---

## 📊 Medir Economia de Tokens

O DevRAG rastreia automaticamente quantos tokens você economiza em cada requisição com RAG.

### Ver métricas em tempo real

Abra o dashboard no navegador:

```bash
# Abrir o dashboard
open docs/dashboard.html   # Mac
start docs/dashboard.html  # Windows
xdg-open docs/dashboard.html  # Linux
```

Ou acesse diretamente via API:

```bash
# Métricas agregadas
curl http://127.0.0.1:4200/api/metrics/savings

# Histórico completo
curl http://127.0.0.1:4200/api/metrics/token-usage/history
```

### Gerar relatório detalhado

```bash
# Gerar HTML + CSV
python scripts/generate_report.py

# Ou com caminhos personalizados
python scripts/generate_report.py \
  --metrics /tmp/devkit-token-metrics.json \
  --output-html relatorio.html \
  --output-csv relatorio.csv
```

O relatório inclui:
- Total de tokens economizados
- Percentual médio de economia por requisição
- Tabela com histórico de cada consulta
- Gráficos de economia por dia e distribuição

### Exemplo de saída

```
=== RELATÓRIO DEV RAG ===
Total de tokens economizados: 245.000
Economia média: 86.2%
Total de requisições: 1.240

Arquivos gerados:
  HTML: token_savings_report.html
  CSV:  token_savings_report.csv
```

### Como funciona a medição

O plugin calcula automaticamente:

| Métrica | Como é calculada |
|---------|-----------------|
| Contexto Completo | Tokens da consulta + estimativa do contexto completo sem RAG |
| Com RAG | Tokens da consulta + tokens do conhecimento injetado |
| Economia | Diferença entre Contexto Completo e Com RAG |
| % Economia | (Economia / Contexto Completo) × 100 |

> **Nota:** A contagem de tokens é uma estimativa baseada em ~4 caracteres por token. Para precisão exata, configure o modelo LLM específico no backend.

---

## 📞 Suporte

Para dúvidas ou problemas, abra uma issue no GitHub.
