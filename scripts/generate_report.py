#!/usr/bin/env python3
"""
DevRAG — Gerador de Relatório de Economia de Tokens

Gera relatórios HTML e CSV com base nas métricas coletadas pelo backend.

Uso:
    python scripts/generate_report.py [--output report.html] [--metrics /tmp/devkit-token-metrics.json]
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_METRICS_FILE = "/tmp/devkit-token-metrics.json"


def load_metrics(file_path: str) -> list[dict]:
    """Carrega métricas do arquivo JSON."""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def calculate_summary(metrics: list[dict]) -> dict:
    """Calcula resumo agregado das métricas."""
    if not metrics:
        return {
            "total_tokens_saved": 0,
            "average_savings_percent": 0,
            "total_requests": 0,
            "period": "Sem dados",
        }

    total_saved = sum(m.get("savings_tokens", 0) for m in metrics)
    avg_percent = sum(m.get("savings_percent", 0) for m in metrics) / len(metrics)

    return {
        "total_tokens_saved": round(total_saved, 2),
        "average_savings_percent": round(avg_percent, 2),
        "total_requests": len(metrics),
        "period": "Últimas requisições",
    }


def generate_html_report(summary: dict, metrics: list[dict], output_file: str):
    """Gera relatório HTML com os dados de economia de tokens."""
    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>DevRAG — Relatório de Economia de Tokens</title>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f7fa; }}
        .container {{ max-width: 1000px; margin: 0 auto; }}
        .header {{ background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; }}
        .header h1 {{ margin: 0; font-size: 28px; }}
        .header p {{ margin: 5px 0 0; opacity: 0.9; }}
        .stats-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }}
        .stat-card {{ background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
        .stat-card .value {{ font-size: 32px; font-weight: bold; color: #059669; }}
        .stat-card .label {{ color: #6b7280; font-size: 14px; text-transform: uppercase; }}
        .table-container {{ background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow-x: auto; }}
        table {{ width: 100%; border-collapse: collapse; }}
        th {{ background: #f9fafb; padding: 12px; text-align: left; font-weight: 600; color: #374151; border-bottom: 2px solid #e5e7eb; }}
        td {{ padding: 12px; border-bottom: 1px solid #e5e7eb; }}
        tr:hover {{ background: #f9fafb; }}
        .badge {{ display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }}
        .badge-high {{ background: #dcfce7; color: #166534; }}
        .badge-medium {{ background: #fef3c7; color: #92400e; }}
        .badge-low {{ background: #f1f5f9; color: #475569; }}
        .mono {{ font-family: monospace; font-size: 14px; }}
        .generated {{ margin-top: 20px; color: #6b7280; font-size: 14px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 DevRAG — Relatório de Economia de Tokens</h1>
            <p>Gerado em {datetime.now().strftime('%d/%m/%Y às %H:%M')}</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="value">{summary['total_tokens_saved']:,}</div>
                <div class="label">Tokens Economizados</div>
            </div>
            <div class="stat-card">
                <div class="value">{summary['average_savings_percent']:.1f}%</div>
                <div class="label">Economia Média por Requisição</div>
            </div>
            <div class="stat-card">
                <div class="value">{summary['total_requests']:,}</div>
                <div class="label">Requisições com RAG</div>
            </div>
            <div class="stat-card">
                <div class="value">{summary['period']}</div>
                <div class="label">Período</div>
            </div>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Data/Hora</th>
                        <th>Consulta</th>
                        <th>Contexto Completo</th>
                        <th>Com RAG</th>
                        <th>Economia</th>
                    </tr>
                </thead>
                <tbody>
"""

    # Adicionar linhas da tabela
    sorted_metrics = sorted(metrics, key=lambda m: m.get("timestamp", ""), reverse=True)
    for item in sorted_metrics[:100]:  # Limitar a 100 linhas
        ts = item.get("timestamp", "")
        date_str = ts[:16].replace("T", " ") if ts else "N/A"
        query = item.get("query", "")[:60] + ("..." if len(item.get("query", "")) > 60 else "")
        full_ctx = item.get("full_context_estimate", 0)
        rag_ctx = item.get("rag_context_tokens", 0)
        pct = item.get("savings_percent", 0)

        badge_class = "badge-high" if pct > 50 else ("badge-medium" if pct > 20 else "badge-low")

        html += f"""
                    <tr>
                        <td class="mono">{date_str}</td>
                        <td>{query}</td>
                        <td class="mono">{full_ctx:,}</td>
                        <td class="mono">{rag_ctx:,}</td>
                        <td><span class="badge {badge_class}">{pct:.1f}%</span></td>
                    </tr>
        """

    html += f"""                </tbody>
            </table>
        </div>

        <div class="generated">
            <p>Relatório gerado pelo DevRAG. Total de {len(metrics)} requisições analisadas.</p>
        </div>
    </div>
</body>
</html>"""

    with open(output_file, "w", encoding="utf-8") as f:
        f.write(html)


def generate_csv(metrics: list[dict], output_file: str):
    """Gera arquivo CSV com as métricas."""
    import csv

    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "query", "full_context_estimate", "rag_context_tokens", "savings_tokens", "savings_percent"])
        for m in metrics:
            writer.writerow([
                m.get("timestamp", ""),
                m.get("query", ""),
                m.get("full_context_estimate", 0),
                m.get("rag_context_tokens", 0),
                m.get("savings_tokens", 0),
                m.get("savings_percent", 0),
            ])


def main():
    parser = argparse.ArgumentParser(description="Gerador de relatório de economia de tokens DevRAG")
    parser.add_argument("--metrics", default=DEFAULT_METRICS_FILE, help="Caminho do arquivo de métricas JSON")
    parser.add_argument("--output-html", default="token_savings_report.html", help="Arquivo HTML de saída")
    parser.add_argument("--output-csv", default="token_savings_report.csv", help="Arquivo CSV de saída")
    args = parser.parse_args()

    metrics = load_metrics(args.metrics)
    summary = calculate_summary(metrics)

    generate_html_report(summary, metrics, args.output_html)
    generate_csv(metrics, args.output_csv)

    print("=== RELATÓRIO DEV RAG ===")
    print(f"Total de tokens economizados: {summary['total_tokens_saved']:,}")
    print(f"Economia média: {summary['average_savings_percent']:.1f}%")
    print(f"Total de requisições: {summary['total_requests']}")
    print(f"\nArquivos gerados:")
    print(f"  HTML: {args.output_html}")
    print(f"  CSV:  {args.output_csv}")


if __name__ == "__main__":
    main()