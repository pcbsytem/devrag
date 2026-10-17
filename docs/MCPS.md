# MCPs do DevRAG

Servidores MCP configurados para o OpenCode v2 no arquivo `opencode.json`.

## MCPs instalados

| MCP | Pacote | Usado para |
|-----|--------|------------|
| **postgres** | `@modelcontextprotocol/server-postgres` | Acesso direto ao PostgreSQL (porta 5432, banco `achadinhos`) |
| **filesystem** | `@modelcontextprotocol/server-filesystem` | Leitura/escrita de arquivos em `Projects`, `plugins/devkit`, `extension/server` |
| **memory** | `@modelcontextprotocol/server-memory` | Memória persistente entre sessões do agente |
| **kb-rag** | `kb-mcp-server` | Base de conhecimento RAG |
| **github** | `@modelcontextprotocol/server-github` | Issues, PRs, repositórios (requer token) |

## Como configurar o MCP do GitHub

O MCP do GitHub exige autenticação via **Personal Access Token**. **Nunca coloque o token direto no arquivo `opencode.json`**.

### 1. Criar o token no GitHub

Acesse: https://github.com/settings/tokens
- Crie um token clássico com escopo `repo`
- Copie o token (ele só aparece uma vez)

### 2. Definir a variável de ambiente

No seu terminal (PowerShell), antes de abrir o OpenCode:

```powershell
$env:GITHUB_PERSONAL_ACCESS_TOKEN = "seu_token_aqui"
```

Ou defina permanentemente nas variáveis de ambiente do sistema.

### 3. Abrir o OpenCode

```powershell
opencode
```

## Como usar

Os MCPs são carregados automaticamente pelo OpenCode v2 ao iniciar. O agente pode invocá-los via tools expostas, por exemplo:

- `postgres_query` — executar SQL no banco de conhecimento
- `filesystem_read_file` — ler arquivos do projeto
- `memory_create_entities` — salvar aprendizados na memória
- `github_*` — criar/issues, listar PRs, consultar repositórios

## Integração com o plugin DevKit

- **`/commit` e `/pr`**: usam shell injection de git para coletar contexto
- **`/board`**: pode usar o MCP `postgres` para consultar tasks diretamente no banco
- **`/kb-review`**: usa `devkit_recall` (plugin) + MCP `memory` para persistir revisões
- **Agents**: `dk-review`, `appsec`, `survey` usam MCP `filesystem` para inspecionar código
- **Agents com GitHub**: podem criar issues e PRs automaticamente via MCP `github`

## Requisitos

- Node.js e npm instalados
- PostgreSQL rodando na porta 5432 (container `postgres-achadinhos` já está up)
- GitHub PAT (apenas para o MCP `github`)

## Testar

```bash
# Verificar se os pacotes estão instalados
ls node_modules/@modelcontextprotocol/

# O OpenCode carrega os MCPs automaticamente na próxima inicialização
opencode
```
