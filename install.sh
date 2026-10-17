#!/bin/bash
# DevRAG — Script de Instalação (Linux/Mac)

set -e

echo "🚀 DevRAG — Instalando ambiente de desenvolvimento..."

# Verificar pré-requisitos
command -v docker >/dev/null 2>&1 || { echo "❌ Docker não encontrado"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ Node.js não encontrado"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ Python3 não encontrado"; exit 1; }

# Subir infraestrutura
echo "📦 Subindo PostgreSQL + Redis..."
docker compose -f infra/docker-compose.yml up -d

# Instalar dependências do backend
echo "🐍 Instalando dependências Python..."
cd backend
pip install fastapi uvicorn
cd ..

# Instalar dependências do plugin
echo "📦 Instalando dependências Node.js..."
cd plugin
npm install
cd ..

# Instalar MCPs
echo "🔌 Instalando MCPs..."
npm install @modelcontextprotocol/server-postgres @modelcontextprotocol/server-filesystem @modelcontextprotocol/server-memory kb-mcp-server

# Copiar configuração do OpenCode
echo "⚙️ Configurando OpenCode..."
mkdir -p ~/.config/opencode/plugins/devkit
cp opencode.json ~/.config/opencode/
cp -r plugin/* ~/.config/opencode/plugins/devkit/
cp -r commands/* ~/.config/opencode/commands/
cp -r agents/* ~/.config/opencode/agents/
cp AGENTS.md ~/.config/opencode/

echo "✅ Instalação concluída!"
echo ""
echo "Próximos passos:"
echo "1. Instale o Ollama e baixe os modelos: ollama pull nomic-embed-text gemma3:4b"
echo "2. Inicie o backend: cd backend && python -m uvicorn app:app --host 127.0.0.1 --port 4200"
echo "3. Valide: curl http://127.0.0.1:4200/api/health"
