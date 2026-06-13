/**
 * Daily Standup Extension
 * 
 * Automatically:
 * 1. Saves conversation summaries to daily folders (~/.pi/daily-standup/YYYY-MM-DD/)
 * 2. Generates end-of-day standup reports with:
 *    - What was worked on today
 *    - Technical details (enough for a picture)
 *    - Tomorrow's plan
 *    - Blockers
 * 
 * Usage:
 *   /save          - Save current conversation to daily folder
 *   /standup       - Generate today's standup report
 *   /standup week  - Generate this week's summaries
 *   /standups      - List all saved summaries
 */

import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

type SessionEntry = {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  label?: string;
};

// ===== Configuration =====
const CONFIG = {
  outputDir: path.join(os.homedir(), ".pi", "daily-standup"),
};

// ===== File Helpers =====
const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const getTodayDir = () => {
  const today = new Date().toISOString().split("T")[0];
  return path.join(CONFIG.outputDir, today);
};

// ===== Conversation Extraction =====
const extractTextParts = (content: unknown): string[] => {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  
  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const block = part as ContentBlock;
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }
  return textParts;
};

const extractToolCalls = (content: unknown): string[] => {
  if (!Array.isArray(content)) return [];
  
  const toolCalls: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const block = part as ContentBlock;
    if (block.type === "toolCall" && typeof block.name === "string") {
      const args = block.arguments ?? {};
      toolCalls.push(`${block.name}(${JSON.stringify(args)})`);
    }
  }
  return toolCalls;
};

const buildConversationText = (entries: SessionEntry[]): string => {
  const sections: string[] = [];
  
  for (const entry of entries) {
    if (entry.type !== "message" || !entry.message?.role) continue;
    
    const role = entry.message.role;
    if (role !== "user" && role !== "assistant") continue;
    
    const entryLines: string[] = [];
    const textParts = extractTextParts(entry.message.content);
    
    if (textParts.length > 0) {
      const roleLabel = role === "user" ? "User" : "Assistant";
      const messageText = textParts.join("\n").trim();
      if (messageText.length > 0) {
        entryLines.push(`${roleLabel}: ${messageText}`);
      }
    }
    
    if (role === "assistant") {
      const toolCalls = extractToolCalls(entry.message.content);
      if (toolCalls.length > 0) {
        entryLines.push(`Tools used: ${toolCalls.join(", ")}`);
      }
    }
    
    if (entryLines.length > 0) {
      sections.push(entryLines.join("\n"));
    }
  }
  
  return sections.join("\n\n");
};

// ===== Summarization =====
const findWorkingModel = async (
  modelRegistry: ModelRegistry,
  sessionModel: any
): Promise<{ model: any; auth: any } | null> => {
  // Try different providers in order of preference
  const models = [
    { provider: "minimax", model: "MiniMax-Text-01" },
    { provider: "minimax-cn", model: "MiniMax-Text-01" },
    { provider: "google", model: "gemini-2.5-flash" },
    { provider: "openai", model: "gpt-4o-mini" },
  ];
  
  for (const { provider, model } of models) {
    const found = modelRegistry.find(provider, model);
    if (found) {
      const auth = await modelRegistry.getApiKeyAndHeaders(found);
      if (auth.ok && auth.apiKey) {
        return { model: found, auth };
      }
    }
  }
  
  // Fallback to session model
  if (sessionModel) {
    const auth = await modelRegistry.getApiKeyAndHeaders(sessionModel);
    if (auth.ok && auth.apiKey) {
      return { model: sessionModel, auth };
    }
  }
  
  return null;
};

const summarizeConversation = async (
  conversationText: string,
  sessionName: string,
  modelRegistry: ModelRegistry,
  sessionModel: any
): Promise<string> => {
  const result = await findWorkingModel(modelRegistry, sessionModel);
  if (!result) {
    return `Session: ${sessionName}\n\n[No AI model available with API key configured]`;
  }
  
  const { model, auth } = result;
  
  const summaryMessages = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `Summarize this coding session for a daily standup report.

Session name: ${sessionName}

Create a summary with these sections:
1. **What was done** - Main tasks completed
2. **Technical details** - Key files modified, code changes, decisions (enough for context)

Be concise but include enough technical detail to understand what happened.

<conversation>
${conversationText}
</conversation>`,
        },
      ],
      timestamp: Date.now(),
    },
  ];
  
  try {
    const response = await complete(
      model,
      { messages: summaryMessages },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 2048,
      }
    );
    
    const summary = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    
    return summary || `Session: ${sessionName}\n\n[Empty summary]`;
  } catch (error) {
    return `Session: ${sessionName}\n\n[Error: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

// ===== Save to Daily Folder =====
const saveDailySummary = async (
  entries: SessionEntry[],
  sessionName: string,
  modelRegistry: ModelRegistry,
  sessionModel: any,
  clickupUrl?: string
): Promise<string | null> => {
  const todayDir = getTodayDir();
  ensureDir(todayDir);
  
  const conversationText = buildConversationText(entries);
  if (!conversationText.trim()) return null;
  
  const summary = await summarizeConversation(conversationText, sessionName, modelRegistry, sessionModel);
  
  // Generate filename from session name + timestamp
  const timestamp = Date.now();
  const safeName = (sessionName || "session")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  const filename = `${timestamp}-${safeName}.md`;
  
  const filepath = path.join(todayDir, filename);
  const clickupLine = clickupUrl ? `\n[ClickUp Task](${clickupUrl})\n` : "";
  const content = [
    `# ${sessionName || "Session"}`,
    clickupLine,
    summary,
  ].join("\n");
  
  fs.writeFileSync(filepath, content, "utf-8");
  
  return filepath;
};

// ===== Generate Standup Report =====
const generateStandupReport = async (
  dateRange: "today" | "week",
  modelRegistry: ModelRegistry,
  sessionModel: any,
  userInput?: string
): Promise<string> => {
  let summaries: { file: string; content: string; date: string }[] = [];
  
  if (dateRange === "today") {
    const todayDir = getTodayDir();
    if (fs.existsSync(todayDir)) {
      const files = fs.readdirSync(todayDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const filepath = path.join(todayDir, file);
        const content = fs.readFileSync(filepath, "utf-8");
        summaries.push({ file, content, date: path.basename(todayDir) });
      }
    }
  } else if (dateRange === "week") {
    // Collect all daily folders from this week
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dayDir = path.join(CONFIG.outputDir, d.toISOString().split("T")[0]);
      if (fs.existsSync(dayDir)) {
        const files = fs.readdirSync(dayDir).filter(f => f.endsWith(".md"));
        for (const file of files) {
          const filepath = path.join(dayDir, file);
          const content = fs.readFileSync(filepath, "utf-8");
          summaries.push({ file, content, date: d.toISOString().split("T")[0] });
        }
      }
    }
  }
  
  if (summaries.length === 0) {
    return `# Nenhum resumo encontrado para ${dateRange === "today" ? "hoje" : "esta semana"}\n\nComece a trabalhar e suas conversas serão auto-resumidas!`;
  }
  
  // Build the report
  const dateStr = new Date().toLocaleDateString("pt-BR", { year: "numeric", month: "2-digit", day: "2-digit" });
  
  const allSummaries = summaries.map(s => s.content).join("\n\n---\n\n");
  
  // Extract all ClickUp URLs from summaries for explicit linking
  const clickupUrls: string[] = [];
  const urlRegex = /https?:\/\/[^\s]+clickup[^\s]*/gi;
  for (const s of summaries) {
    const matches = s.content.match(urlRegex);
    if (matches) {
      clickupUrls.push(...matches);
    }
  }
  
  // Use AI to generate a structured standup from the summaries
  const result = await findWorkingModel(modelRegistry, sessionModel);
  if (!result) {
    return `# Ponto de Situação - ${dateStr}\n\n${allSummaries}\n\n*Nota: Nenhum modelo de IA disponível para formatação do relatório*`;
  }
  
  const { model, auth } = result;
  
  const reportMessages = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `Gere um relatório de daily standup para um desenvolvedor em PORTUGUÊS.

Use MARKDOWN DO MICROSOFT TEAMS (não use markdown padrão):
- **negrito** com asteriscos
- _itálico_ com underscores
- # Título principal
- ## Subtítulo
- - Lista não ordenada
- 1. Lista numerada
- \`código inline\` com backticks
- \`\`\`bloco de código\`\`\`


Crie um relatório estruturado com estas seções em PORTUGUÊS:
1. **Hoje** - Lista de tarefas concluídas HOJE. CADA item deve ter sub-detalhes técnicos em sublista. Exemplo:
   - Tarefa 1
     - Detalhe técnico 1.1 (máx 5 detalhes por tarefa)
     - Detalhe técnico 1.2
   - Tarefa 2
     - Detalhe técnico 2.1
2. **Amanhã** - Lista de TAREFAS que VOCÊ vai fazer amanhã. EXEMPLOS DO QUE NAO COLOCAR AQUI:
   - "Aguardar deploy do Dhiego" ← ISSO VAI EM BLOQUEIOS
   - "Depende de outras tarefas" ← ISSO VAI EM BLOQUEIOS
   - "Revisar depois" ← ISSO VAI EM BLOQUEIOS SE FOR BLOQUEIO
   - Apenas tarefas que você vai fazer AGORA, sem depender de ninguem
3. **Bloqueios** - ONLY quando voce esta PARADO esperando algo externo. Se algo aparece em Amanhã, NAO pode aparecer em Bloqueios. ("Nenhum" se nada te impede)


NÃO inclua título ou cabeçalho - o título será adicionado depois.

LINKS CLICKUP DISPONÍVEIS (use-os nos itens correspondentes de HOJE):
${clickupUrls.length > 0 ? clickupUrls.map(url => `- ${url}`).join("\n") : "(nenhum)"}

Quando usar link ClickUp, inclua a URL EXPLICITAMENTE no item de topo nível. Exempl:
- Tarefa 1 https://app.clickup.com/t/abc123
  - Detalhe 1
- Tarefa 2
  - Detalhe 2

NAO use formato [texto](url) - use a URL direta.

O link ClickUp deve aparecer logo após o texto do item de topo nível, não como item separado.

MÁXIMO 5 ITENS POR SUBLISTA - escolha os mais importantes.

Seja específico e técnico. Inclua nomes de arquivos, funções e decisões importantes.


O usuário escreveu sobre seu plano para amanhã. INTERPRETE e expanda em uma lista clara:

${userInput || "(vazio - deixe Plano para Amanhã em branco e Bloqueios como Nenhum)"}


<summaries>
${allSummaries}
</summaries>`,
        },
      ],
      timestamp: Date.now(),
    },
  ];
  
  try {
    const response = await complete(
      model,
      { messages: reportMessages },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 4096,
      }
    );
    
    const report = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    
    return `# Ponto de Situação - ${dateStr}\n\n${report}`;
  } catch (error) {
    return `# Ponto de Situação - ${dateStr}\n\n${allSummaries}\n\n*Erro: ${error instanceof Error ? error.message : String(error)}*`;
  }
};

// ===== Extension =====
export default function (pi: ExtensionAPI) {
  // Save current conversation to daily folder
  pi.registerCommand("save", {
    description: "Save current conversation summary to daily folder. Usage: /save [clickup-url]",
    handler: async (args, ctx) => {
      const branch = ctx.sessionManager.getBranch();
      const sessionName = pi.getSessionName() || "Unnamed session";
      
      // Extract ClickUp URL if provided
      let clickupUrl = "";
      const urlMatch = args?.match(/https?:\/\/[^\s]+clickup[^\s]*/i);
      if (urlMatch) {
        clickupUrl = urlMatch[0];
      }
      
      if (branch.length < 3) {
        if (ctx.hasUI) {
          ctx.ui.notify("Not enough conversation to summarize", "warning");
        }
        return;
      }
      
      if (ctx.hasUI) {
        ctx.ui.notify("Saving summary...", "info");
      }
      
      const savedPath = await saveDailySummary(branch, sessionName, ctx.modelRegistry, ctx.model, clickupUrl);
      if (savedPath) {
        if (ctx.hasUI) {
          ctx.ui.notify(`Saved: ${path.basename(savedPath)}${clickupUrl ? " [ClickUp linked]" : ""}`, "info");
        }
      } else {
        if (ctx.hasUI) {
          ctx.ui.notify("Failed to save summary", "error");
        }
      }
    },
  });
  
  // Standup command
  pi.registerCommand("standup", {
    description: "Generate daily standup report",
    handler: async (args, ctx) => {
      // Parse args: first word is mode, rest is userInput
      const parts = args?.trim().split(/\s+/) || [];
      let mode = parts[0]?.toLowerCase() || "today";
      let userInput = parts.slice(1).join(" ");
      
      if (mode === "config") {
        if (ctx.hasUI) {
          ctx.ui.notify(`Config: outputDir=${CONFIG.outputDir}`, "info");
        }
        return;
      }
      
      if (mode !== "today" && mode !== "week") {
        // No valid mode, treat entire input as userInput
        userInput = args?.trim() || "";
        mode = "today";
      }
      
      if (ctx.hasUI) {
        ctx.ui.notify(`Generating ${mode} standup...`, "info");
      }
      
      const report = await generateStandupReport(
        mode === "week" ? "week" : "today",
        ctx.modelRegistry,
        ctx.model,
        userInput || undefined
      );
      
      // Save report to file
      const todayDir = getTodayDir();
      ensureDir(todayDir);
      const reportFile = path.join(todayDir, mode === "week" ? "weekly-standup.md" : "standup-report.md");
      fs.writeFileSync(reportFile, report, "utf-8");
      
      if (ctx.hasUI) {
        ctx.ui.notify(`Report saved to ${reportFile}`, "info");
        ctx.ui.setWidget("standup", report.split("\n").slice(0, 30));
      }
    },
  });
  
  // List summaries command
  pi.registerCommand("standups", {
    description: "List available daily standup summaries",
    handler: async (_args, ctx) => {
      ensureDir(CONFIG.outputDir);
      const dirs = fs.readdirSync(CONFIG.outputDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      dirs.sort().reverse();
      
      const summary = dirs.map(d => {
        const dayDir = path.join(CONFIG.outputDir, d);
        const files = fs.readdirSync(dayDir).filter(f => f.endsWith(".md"));
        return `${d}: ${files.length} summary(ies)`;
      }).join("\n");
      
      if (ctx.hasUI) {
        ctx.ui.notify(`Found ${dirs.length} days with summaries`, "info");
        ctx.ui.setWidget("standups", summary.split("\n").slice(0, 20));
      }
    },
  });
}
