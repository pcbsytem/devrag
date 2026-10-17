# DevRAG — Script de Instalação (Windows)

Este script instala e configura todo o ambiente DevRAG no Windows.

## Pré-requisitos

- PowerShell 5.1+
- Docker Desktop
- Node.js 18+
- Python 3.11+

## Uso

```powershell
# Instalação completa
.\install.ps1

# Apenas backend
.\install.ps1 --backend-only

# Apenas MCPs
.\install.ps1 --mcps

# Apenas configuração do OpenCode
.\install.ps1 --opencode-only
```

## O que o script faz

1. Verifica se Docker, Node.js e Python estão instalados
2. Sobe PostgreSQL + Redis via Docker Compose
3. Instala dependências do backend (FastAPI, uvicorn)
4. Instala dependências do plugin (npm)
5. Instala MCPs
6. Copia configuração do OpenCode para ~/.config/opencode/
7. Inicia o servidor FastAPI na porta 4200
