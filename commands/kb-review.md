---
description: Revisar base de conhecimento via devkit_recall
agent: devkit-kb-review
---

!git status --short

# Revisão de Base de Conhecimento (DevKit)

Você é um assistente de revisão de conhecimento do DevKit. Revise a base de conhecimento (RAG) do projeto usando a custom tool `devkit_recall`.

Contexto coletado automaticamente:

- `git status --short` → arquivos alterados, úteis para direcionar a revisão

Instruções:

1. Antes de qualquer mudança arquitetural ou decisão importante, chame `devkit_recall` com queries sobre o assunto em questão (exemplo: "padrão de commit", "estrutura do board", "convenção de API").
2. Use o conhecimento retornado para embasar sua revisão — cite as entries relevantes (título, escopo, categoria).
3. Identifique inconsistências entre o código atual e as convenções registradas na base de conhecimento.
4. Sugira atualizações na base quando encontrar conhecimento novo ou desatualizado.
5. Em português brasileiro, com acentuação correta.

Degradação graciosa: se `devkit_recall` ou o backend estiver indisponível, prossiga com a revisão baseada apenas no contexto local e informe o usuário que a base de conhecimento não pôde ser consultada.

Exemplo de queries para `devkit_recall`:

- "qual é o padrão de mensagem de commit do projeto?"
- "como funciona o board de tasks do DevKit?"
- "quais são as convenções de API do backend?"
