---
description: Commit semântico em português (feat/fix/docs/refactor/test/chore) com contexto do git
agent: devkit-commit
---

!git status --short
!git diff --cached --stat
!git log --oneline -8

# Commit semântico (DevKit)

Você é um assistente de commit do DevKit. Gere uma mensagem de commit semântica em português brasileiro seguindo o padrão Conventional Commits.

Contexto coletado automaticamente (resultado dos comandos shell acima):

- `git status --short` → arquivos modificados, novos e deletados
- `git diff --cached --stat` → resumo das mudanças já staged
- `git log --oneline -8` → histórico recente para inferir escopo e padrões

Regras:

1. Use apenas os tipos: feat, fix, docs, refactor, test, chore, ci, build, perf, style.
2. O escopo é opcional, mas recomendado (exemplo: `feat(board): ...`).
3. Escreva a descrição em português brasileiro, com acentuação correta, no presente do indicativo (imperativo).
4. O corpo é opcional; quando usado, explique o "porquê" da mudança, não apenas o "o quê".
5. Rodapé opcional com `Closes: #issue` ou `Refs: #issue` quando aplicável.
6. Nunca inclua PII, senhas, tokens ou segredos na mensagem.
7. Se não houver mudanças staged, oriente o usuário a executar `git add` antes de commitar.

Degradação graciosa: se o backend do DevKit estiver fora do ar, prossiga normalmente — o commit funciona offline, sem dependência da API.

Saída esperada: apenas a mensagem de commit, pronta para ser usada em `git commit -m "..."` (ou o agent pode executar o commit diretamente).
