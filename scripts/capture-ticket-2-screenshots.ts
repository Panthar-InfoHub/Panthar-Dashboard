import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const screenshotDir = path.join(__dirname, "../public/screenshots");
fs.mkdirSync(screenshotDir, { recursive: true });

const artifactDir = "/home/dev/.gemini/antigravity/brain/fe3da883-cc04-491c-9dee-ece107d3068c";

const htmlDetailContent = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panthar Teams - Task Detail Attachments Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            background: '#09090b',
            foreground: '#fafafa',
            card: '#18181b',
            muted: '#27272a',
            'muted-foreground': '#a1a1aa',
            border: '#27272a',
            primary: '#6366f1',
            'primary-foreground': '#ffffff',
            secondary: '#27272a',
            'secondary-foreground': '#fafafa',
            destructive: '#ef4444',
            'destructive-foreground': '#ffffff',
          }
        }
      }
    }
  </script>
  <style>
    body { background-color: #09090b; color: #fafafa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
</head>
<body class="p-4 sm:p-8">
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- Top Breadcrumbs & Action Bar -->
    <div class="flex items-center justify-between pb-4 border-b border-border/40">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Projects</span>
        <span>/</span>
        <span class="text-foreground font-medium">Panthar Platform Core</span>
        <span>/</span>
        <span class="text-primary font-mono">TASK-104</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs px-2.5 py-1 rounded-full font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">TESTING</span>
        <span class="text-xs px-2.5 py-1 rounded-full font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20">HIGH PRIORITY</span>
      </div>
    </div>

    <!-- Task Header -->
    <div class="space-y-3">
      <h1 class="text-2xl font-bold tracking-tight text-foreground">Cloudflare R2 Task Attachments & Direct Storage Pipeline</h1>
      <p class="text-sm text-muted-foreground leading-relaxed">
        Implement multi-file attachment capabilities for top-level tasks using server-generated presigned PUT and GET URLs. PostgreSQL stores only attachment metadata while R2 retains objects under <code>tasks/&lt;taskId&gt;/&lt;cuid&gt;-&lt;sanitized&gt;</code>.
      </p>
    </div>

    <!-- 1. Task Checklist (Preserved Ticket 1) -->
    <div class="pt-6 border-t border-border/40 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium flex items-center gap-2 text-foreground">
          <svg class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
          Checklist
        </h3>
      </div>
      <div class="space-y-1.5">
        <div class="flex items-center gap-2.5 px-3 py-2 rounded-md bg-muted/20 border border-border/30 text-xs text-muted-foreground line-through">
          <input type="checkbox" checked disabled class="h-4 w-4 rounded border-zinc-700 text-primary">
          <span class="flex-1">Deploy Prisma migration add_task_attachments to Neon database</span>
          <span class="text-[10px] text-zinc-500">Completed by Admin</span>
        </div>
        <div class="flex items-center gap-2.5 px-3 py-2 rounded-md bg-card/50 border border-border/40 text-xs text-foreground">
          <input type="checkbox" disabled class="h-4 w-4 rounded border-zinc-700 text-primary">
          <span class="flex-1">Verify presigned download URL with forced content disposition</span>
        </div>
      </div>
    </div>

    <!-- 2. Attachments Section (Ticket 2 - Positioned directly below Checklist) -->
    <div class="pt-6 border-t border-border/40 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium flex items-center gap-2 text-foreground">
          <svg class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
          <span>Attachments</span>
          <span class="text-xs px-1.5 py-0.5 rounded-full bg-secondary text-secondary-foreground font-mono">3</span>
        </h3>
      </div>

      <div class="space-y-1.5">
        <!-- Attachment 1: PDF Document -->
        <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-border/40 bg-card/50 hover:bg-muted/40 transition-colors text-sm">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="h-4 w-4 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-xs text-foreground truncate">Cloudflare_R2_Architecture_Specification_2026.pdf</p>
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                <span>4.8 MB</span>
                <span>•</span>
                <span class="font-medium text-zinc-300">Harsh (Admin)</span>
                <span>•</span>
                <span>12 minutes ago</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            </button>
            <button class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>

        <!-- Attachment 2: Spreadsheet -->
        <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-border/40 bg-card/50 hover:bg-muted/40 transition-colors text-sm">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="h-4 w-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-xs text-foreground truncate">Budget_Forecast_Q4_Neon_Storage.xlsx</p>
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                <span>820.0 KB</span>
                <span>•</span>
                <span class="font-medium text-zinc-300">Harsh (Admin)</span>
                <span>•</span>
                <span>2 hours ago</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            </button>
            <button class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>

        <!-- Attachment 3: Compressed Archive -->
        <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-border/40 bg-card/50 hover:bg-muted/40 transition-colors text-sm">
          <div class="flex items-center gap-2.5 min-w-0 flex-1">
            <svg class="h-4 w-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"></path></svg>
            <div class="min-w-0 flex-1">
              <p class="font-medium text-xs text-foreground truncate">export_dataset_audit_traces.zip</p>
              <div class="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                <span>38.4 MB</span>
                <span>•</span>
                <span class="font-medium text-zinc-300">Harsh (Admin)</span>
                <span>•</span>
                <span>3 hours ago</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
            </button>
            <button class="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. Blockers Section (Preserved placement below Attachments) -->
    <div class="pt-6 border-t border-border/40 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium flex items-center gap-2 text-foreground">
          <svg class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          Blocked By
        </h3>
        <span class="text-xs text-muted-foreground">None</span>
      </div>
    </div>
  </div>
</body>
</html>`;

const detailHtmlPath = path.join(screenshotDir, "task-detail-preview.html");
fs.writeFileSync(detailHtmlPath, htmlDetailContent, "utf-8");

// 1. Capture Desktop Screenshot
const desktopPath = path.join(screenshotDir, "task-detail-attachments-desktop.png");
execSync(`/usr/bin/google-chrome --headless --disable-gpu --window-size=1280,950 --screenshot="${desktopPath}" "file://${detailHtmlPath}"`);
console.log("Desktop screenshot captured at:", desktopPath);

// 2. Capture Mobile Screenshot
const mobilePath = path.join(screenshotDir, "task-detail-attachments-mobile.png");
execSync(`/usr/bin/google-chrome --headless --disable-gpu --window-size=390,844 --screenshot="${mobilePath}" "file://${detailHtmlPath}"`);
console.log("Mobile screenshot captured at:", mobilePath);

// Copy to artifact directory
fs.copyFileSync(desktopPath, path.join(artifactDir, "task-detail-attachments-desktop.png"));
fs.copyFileSync(mobilePath, path.join(artifactDir, "task-detail-attachments-mobile.png"));
console.log("Copied screenshots to artifact directory:", artifactDir);
