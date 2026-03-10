const BLOCKED_HOSTS =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|::ffff:127\.|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// ── Helpers ───────────────────────────────────────────────────────────────────

function strip(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/ {2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToPlainMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")

    // Headings
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, l, t) => "\n" + "#".repeat(+l) + " " + strip(t) + "\n"
    )

    // Bold / italic
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `**${strip(c)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `_${strip(c)}_`)

    // Links
    .replace(
      /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, h, t) => `[${strip(t)}](${h})`
    )

    // Images
    .replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, (_, a) => (a ? `_${a}_` : ""))

    // ── Tables ────────────────────────────────────────────────────────
    .replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
      const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      if (rows.length === 0) return "";

      const parsed: { cells: string[]; header: boolean }[] = rows.map((row) => {
        const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
        return {
          cells: cells.map((c) => strip(c[1]).replace(/\n/g, " ").replace(/ {2,}/g, " ").trim()),
          header: /<th[^>]*>/i.test(row[1]),
        };
      });

      if (parsed.length === 0) return "";

      const colCount = Math.max(...parsed.map((r) => r.cells.length));
      const normalized = parsed.map((r) => {
        const padded = [...r.cells];
        while (padded.length < colCount) padded.push("");
        return { cells: padded, header: r.header };
      });

      const widths = Array.from({ length: colCount }, (_, i) =>
        Math.max(...normalized.map((r) => (r.cells[i] ?? "").length), 3)
      );

      const formatRow = (cells: string[]) =>
        "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";

      const separator = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";

      const lines: string[] = ["\n"];
      let separatorInserted = false;

      normalized.forEach((row, idx) => {
        lines.push(formatRow(row.cells));
        if (!separatorInserted && (row.header || idx === 0)) {
          lines.push(separator);
          separatorInserted = true;
        }
      });

      lines.push("\n");
      return lines.join("\n");
    })

    // Lists
    .replace(/<ul[^>]*>/gi, "\n")
    .replace(/<\/ul>/gi, "\n")
    .replace(/<ol[^>]*>/gi, "\n")
    .replace(/<\/ol>/gi, "\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${strip(c).replace(/\n/g, " ").trim()}\n`)

    // Paragraphs & blocks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => "\n" + strip(c) + "\n")
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, c) => "\n" + strip(c) + "\n")
    .replace(
      /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_, c) => "\n> " + strip(c).replace(/\n/g, "\n> ") + "\n"
    )

    // Code blocks — pre before code to avoid double-wrapping
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + strip(c) + "\n```\n")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => "`" + strip(c) + "`")

    // HR
    .replace(/<hr\s*\/?>/gi, "\n---\n")

    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")

    // Decode remaining entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

    // Clean up whitespace
    .replace(/ {2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlTableToCsv(html: string): string {
  // If no <table> tag found, treat the whole input as one table block
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) ?? [html];
  const allTables: string[] = [];

  for (const table of tables) {
    const rows: string[] = [];

    const captionMatch = table.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    if (captionMatch) {
      rows.push(`# ${strip(captionMatch[1]).replace(/\n/g, " ").trim()}`);
    }

    const rowMatches = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

    for (const row of rowMatches) {
      const cells: string[] = [];
      const cellMatches = [...row[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)];

      for (const cell of cellMatches) {
        const isHeader = cell[1] === "h";
        // strip newlines inside cells, collapse spaces, escape quotes
        let text = strip(cell[2]).replace(/\n/g, " ").replace(/ {2,}/g, " ").replace(/"/g, '""').trim();
        if (isHeader) text = text.toUpperCase();
        cells.push(`"${text}"`);
      }

      if (cells.length > 0) rows.push(cells.join(","));
    }

    if (rows.length > 0) allTables.push(rows.join("\n"));
  }

  return allTables.join("\n\n").trim();
}

async function extractWithSelector(html: string, selector: string): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [];
  let depth = 0;

  const fakeResponse = new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        depth++;
        const current = depth;
        el.onEndTag(() => {
          depth--;
          if (depth < current) {
            const trimmed = stack.splice(0).join("").trim();
            if (trimmed) results.push(trimmed);
          }
        });
      },
      text(chunk) {
        stack.push(chunk.text);
      },
    })
    .transform(fakeResponse)
    .text();

  return results.filter(Boolean);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

function respond(
  body: string | null,
  status: number,
  contentType: string,
  extra: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      ...corsHeaders(),
      ...extra,
    },
  });
}

// ── Source escaping for format=html ──────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request): Promise<Response> {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders(), "Access-Control-Max-Age": "86400" },
      });
    }

    try {
      const { searchParams } = new URL(request.url);
      const target        = searchParams.get("url");
      const regexParam    = searchParams.get("regex");
      const selectorParam = searchParams.get("selector");
      const format        = searchParams.get("format") ?? "markdown";

      // ── Validate ─────────────────────────────────────────────────────────
      if (!target) {
        return respond("Missing `url` param", 400, "text/plain; charset=utf-8");
      }

      if (!["markdown", "json", "html", "csv"].includes(format)) {
        return respond(
          "`format` must be: markdown, json, html, or csv",
          400,
          "text/plain; charset=utf-8"
        );
      }

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return respond("Invalid `url` param", 400, "text/plain; charset=utf-8");
      }

      if (BLOCKED_HOSTS.test(targetUrl.hostname)) {
        return respond("Forbidden target", 403, "text/plain; charset=utf-8");
      }

      // ── Forward request ──────────────────────────────────────────────────
      const forwardHeaders = new Headers(request.headers);
      for (const h of ["host", "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cf-visitor"]) {
        forwardHeaders.delete(h);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      let remoteResponse: Response;
      try {
        remoteResponse = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: forwardHeaders,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body as BodyInit,
          redirect: "follow",
          signal: controller.signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return respond(`Fetch failed: ${msg}`, 502, "text/plain; charset=utf-8");
      } finally {
        clearTimeout(timer);
      }

      const contentType = remoteResponse.headers.get("content-type") ?? "";
      const isHtml = contentType.includes("text/html");

      // ── Pass-through (no regex, no selector) ─────────────────────────────
      if (!regexParam && !selectorParam) {
        const headers = new Headers(remoteResponse.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(remoteResponse.body, {
          status: remoteResponse.status,
          statusText: remoteResponse.statusText,
          headers,
        });
      }

      // ── Body size guard ──────────────────────────────────────────────────
      let buffer: ArrayBuffer;
      try {
        buffer = await remoteResponse.arrayBuffer();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return respond(`Failed to read response body: ${msg}`, 502, "text/plain; charset=utf-8");
      }

      if (buffer.byteLength > MAX_BYTES) {
        return respond("Response too large (limit: 5MB)", 413, "text/plain; charset=utf-8");
      }

      const body = new TextDecoder().decode(buffer);

      // ── Selector branch ──────────────────────────────────────────────────
      if (selectorParam) {
        if (!isHtml) {
          return respond("CSS selector requires an HTML response", 415, "text/plain; charset=utf-8");
        }

        const items = await extractWithSelector(body, selectorParam);

        if (items.length === 0) {
          return respond("No matches found for selector", 404, "text/plain; charset=utf-8");
        }

        switch (format) {
          case "json":
            return respond(
              JSON.stringify({ total: items.length, items }, null, 2),
              200,
              "application/json; charset=utf-8"
            );

          case "csv": {
            const csv = items.map((v) => `"${v.replace(/\n/g, " ").replace(/"/g, '""').trim()}"`).join("\n");
            return respond(csv, 200, "text/csv; charset=utf-8", {
              "Content-Disposition": 'attachment; filename="data.csv"',
            });
          }

          case "html":
            // Return escaped source so tags are visible as text
            return respond(
              escapeHtml(items.join("\n\n")),
              200,
              "text/plain; charset=utf-8"
            );

          default: { // markdown
            const md = items.map((item) => (isHtml ? htmlToPlainMarkdown(item) : item)).join("\n\n");
            return respond(md, 200, "text/markdown; charset=utf-8");
          }
        }
      }

      // ── Regex branch ─────────────────────────────────────────────────────
      let filterRegex: RegExp;
      try {
        filterRegex = new RegExp(regexParam!, "gis");
      } catch {
        return respond(
          "Invalid `regex` param: not a valid regular expression",
          400,
          "text/plain; charset=utf-8"
        );
      }

      const isTextBased =
        isHtml ||
        contentType.includes("xml") ||
        contentType.includes("text/plain");

      if (!isTextBased) {
        return respond("Target did not return text-based content", 415, "text/plain; charset=utf-8");
      }

      const matches = [...body.matchAll(filterRegex)];

      if (matches.length === 0) {
        return respond("No matches found for the provided regex", 404, "text/plain; charset=utf-8");
      }

      const extracted = matches
        .map((m) => (m[1] !== undefined ? m[1] : m[0]).trim())
        .filter(Boolean);

      const joined = extracted.join("\n\n");

      switch (format) {
        case "json":
          return respond(
            JSON.stringify({ total: extracted.length, items: extracted }, null, 2),
            200,
            "application/json; charset=utf-8"
          );

        case "html":
          // Return escaped source so tags are visible as plain text
          return respond(
            escapeHtml(joined),
            200,
            "text/plain; charset=utf-8"
          );

        case "csv": {
          if (!isHtml) {
            return respond("CSV format requires an HTML response", 415, "text/plain; charset=utf-8");
          }
          const csv = htmlTableToCsv(joined);
          if (!csv) {
            return respond("No table found in response", 404, "text/plain; charset=utf-8");
          }
          return respond(csv, 200, "text/csv; charset=utf-8", {
            "Content-Disposition": 'attachment; filename="table.csv"',
          });
        }

        default: { // markdown
          const markdown = isHtml ? htmlToPlainMarkdown(joined) : joined;
          return respond(markdown, 200, "text/markdown; charset=utf-8");
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return respond(`Proxy error: ${msg}`, 502, "text/plain; charset=utf-8");
    }
  },
};
