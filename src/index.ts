const BLOCKED_HOSTS =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|::1|::ffff:127\.|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code));
}

function strip(s: string): string {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/ {2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripInline(s: string): string {
  // Like strip() but collapses newlines to a single space — for table cells / CSV
  return strip(s).replace(/\n/g, " ").replace(/ {2,}/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Selector extractor (regex-based, preserves inner HTML) ────────────────────

function extractBySelector(html: string, selector: string): string[] {
  // Supports: tag, .class, tag.class, #id, tag#id  (first compound token only)
  const token = selector.trim().split(/\s+/)[0];
  const tagMatch  = token.match(/^([a-z][a-z0-9]*)/i);
  const classMatches = [...token.matchAll(/\.([a-z0-9_-]+)/gi)];
  const idMatch   = token.match(/#([a-z0-9_-]+)/i);

  const tag = tagMatch?.[1] ?? "[a-z][a-z0-9]*";

  let lookahead = "";
  if (idMatch)
    lookahead += `(?=[^>]*\\bid="${idMatch[1]}"[^>]*)`;
  for (const cls of classMatches) {
    lookahead += `(?=[^>]*\\bclass="[^"]*(?:^|\\s)${cls[1]}(?:\\s|$)[^"]*")`;
  }

  const re = new RegExp(`<(${tag})${lookahead}[^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
  return [...html.matchAll(re)].map((m) => m[0]);
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  return decodeEntities(
    html
      // Remove noise
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")

      // Headings
      .replace(
        /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
        (_, l, t) => "\n\n" + "#".repeat(+l) + " " + stripInline(t) + "\n\n"
      )

      // Inline formatting
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, c) => `**${stripInline(c)}**`)
      .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi,     (_, _t, c) => `_${stripInline(c)}_`)
      .replace(/<(s|del)[^>]*>([\s\S]*?)<\/\1>/gi,    (_, _t, c) => `~~${stripInline(c)}~~`)

      // Links & images
      .replace(
        /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_, h, t) => `[${stripInline(t)}](${h})`
      )
      .replace(/<img[^>]+alt="([^"]*)"[^>]*>/gi, (_, a) => (a ? `_${a}_` : ""))

      // ── Tables → aligned markdown ─────────────────────────────────────────
      .replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
        const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        if (!rows.length) return "";

        const parsed = rows.map((row) => ({
          cells: [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
            (c) => stripInline(c[1])
          ),
          isHeader: /<th[^>]*>/i.test(row[1]),
        }));

        const colCount = Math.max(...parsed.map((r) => r.cells.length));

        const grid = parsed.map((r) => {
          const cells = [...r.cells];
          while (cells.length < colCount) cells.push("");
          return { cells, isHeader: r.isHeader };
        });

        const widths = Array.from({ length: colCount }, (_, i) =>
          Math.max(...grid.map((r) => r.cells[i]?.length ?? 0), 3)
        );

        const fmtRow = (cells: string[]) =>
          "| " + cells.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";

        const separator =
          "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";

        const lines: string[] = ["\n"];
        let sepDone = false;

        grid.forEach((row, idx) => {
          lines.push(fmtRow(row.cells));
          if (!sepDone && (row.isHeader || idx === 0)) {
            lines.push(separator);
            sepDone = true;
          }
        });

        lines.push("\n");
        return lines.join("\n");
      })

      // Lists
      .replace(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gi, "\n")
      .replace(
        /<li[^>]*>([\s\S]*?)<\/li>/gi,
        (_, c) => `- ${stripInline(c)}\n`
      )

      // Blockquote
      .replace(
        /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
        (_, c) => "\n> " + strip(c).replace(/\n/g, "\n> ") + "\n"
      )

      // Code — pre BEFORE code to avoid double-wrapping
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, c) => "\n```\n" + strip(c) + "\n```\n")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => "`" + stripInline(c) + "`")

      // Paragraphs & line breaks
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, c) => "\n" + strip(c) + "\n")
      .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, c) => "\n" + strip(c) + "\n")

      // HR
      .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")

      // Strip remaining tags
      .replace(/<[^>]+>/g, " ")
  )
    // Final whitespace cleanup
    .replace(/ {2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── HTML → CSV ────────────────────────────────────────────────────────────────

function htmlToCsv(html: string): string {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  if (!tables.length) tables.push(html); // fallback: treat whole input as table

  const allBlocks: string[] = [];

  for (const table of tables) {
    const rows: string[] = [];

    const caption = table.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
    if (caption) rows.push(`# ${stripInline(caption[1])}`);

    for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t[hd]>/gi)) {
        let text = stripInline(cell[2]).replace(/"/g, '""');
        if (cell[1] === "h") text = text.toUpperCase();
        cells.push(`"${text}"`);
      }
      if (cells.length) rows.push(cells.join(","));
    }

    if (rows.length) allBlocks.push(rows.join("\n"));
  }

  return allBlocks.join("\n\n").trim();
}

// ── HTML → JSON rows ──────────────────────────────────────────────────────────

function htmlToJsonRows(html: string): Array<string[]> {
  const rows: Array<string[]> = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (c) => stripInline(c[1])
    );
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// ── Response helpers ──────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  "*",
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
    headers: { "Content-Type": contentType, ...corsHeaders(), ...extra },
  });
}

// ── Format dispatcher ─────────────────────────────────────────────────────────

function formatOutput(rawHtml: string, format: string, isHtml: boolean): Response {
  switch (format) {
    case "json": {
      const rows = htmlToJsonRows(rawHtml);
      return respond(
        JSON.stringify({ total: rows.length, rows }, null, 2),
        200,
        "application/json; charset=utf-8"
      );
    }

    case "csv": {
      if (!isHtml)
        return respond("CSV format requires HTML content", 415, "text/plain; charset=utf-8");
      const csv = htmlToCsv(rawHtml);
      if (!csv)
        return respond("No table found for CSV", 404, "text/plain; charset=utf-8");
      return respond(csv, 200, "text/csv; charset=utf-8", {
        "Content-Disposition": 'attachment; filename="data.csv"',
      });
    }

    case "html":
      // Return escaped source so tags are visible — not rendered
      return respond(escapeHtml(rawHtml), 200, "text/plain; charset=utf-8");

    default: { // markdown
      const md = isHtml ? htmlToMarkdown(rawHtml) : rawHtml;
      return respond(md, 200, "text/markdown; charset=utf-8");
    }
  }
}

// ── Main Handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request): Promise<Response> {

    // CORS preflight
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

      // ── Validate ────────────────────────────────────────────────────────────
      if (!target)
        return respond("Missing `url` param", 400, "text/plain; charset=utf-8");

      if (!["markdown", "json", "html", "csv"].includes(format))
        return respond("`format` must be: markdown | json | html | csv", 400, "text/plain; charset=utf-8");

      let targetUrl: URL;
      try {
        targetUrl = new URL(target);
        if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error();
      } catch {
        return respond("Invalid `url` param", 400, "text/plain; charset=utf-8");
      }

      if (BLOCKED_HOSTS.test(targetUrl.hostname))
        return respond("Forbidden target", 403, "text/plain; charset=utf-8");

      // ── Forward request ──────────────────────────────────────────────────────
      const forwardHeaders = new Headers(request.headers);
      for (const h of ["host", "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cf-visitor"])
        forwardHeaders.delete(h);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      let remoteRes: Response;
      try {
        remoteRes = await fetch(targetUrl.toString(), {
          method:   request.method,
          headers:  forwardHeaders,
          body:     ["GET", "HEAD"].includes(request.method) ? undefined : request.body as BodyInit,
          redirect: "follow",
          signal:   controller.signal,
        });
      } catch (err) {
        return respond(`Fetch failed: ${err instanceof Error ? err.message : err}`, 502, "text/plain; charset=utf-8");
      } finally {
        clearTimeout(timer);
      }

      const contentType = remoteRes.headers.get("content-type") ?? "";
      const isHtml = contentType.includes("text/html");

      // ── Pass-through (no regex, no selector) ──────────────────────────────
      if (!regexParam && !selectorParam) {
        const headers = new Headers(remoteRes.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(remoteRes.body, {
          status:     remoteRes.status,
          statusText: remoteRes.statusText,
          headers,
        });
      }

      // ── Read + size guard ────────────────────────────────────────────────
      let buffer: ArrayBuffer;
      try {
        buffer = await remoteRes.arrayBuffer();
      } catch (err) {
        return respond(`Failed to read body: ${err instanceof Error ? err.message : err}`, 502, "text/plain; charset=utf-8");
      }

      if (buffer.byteLength > MAX_BYTES)
        return respond("Response too large (limit: 5 MB)", 413, "text/plain; charset=utf-8");

      const body = new TextDecoder().decode(buffer);

      // ── Selector branch ──────────────────────────────────────────────────
      if (selectorParam) {
        if (!isHtml)
          return respond("CSS selector requires an HTML response", 415, "text/plain; charset=utf-8");

        const matches = extractBySelector(body, selectorParam);
        if (!matches.length)
          return respond("No elements matched the selector", 404, "text/plain; charset=utf-8");

        // Join all matched elements; each separated by a blank line
        const rawHtml = matches.join("\n\n");
        return formatOutput(rawHtml, format, true);
      }

      // ── Regex branch ────────────────────────────────────────────────────
      const isTextBased =
        isHtml ||
        contentType.includes("xml") ||
        contentType.includes("text/plain");

      if (!isTextBased)
        return respond("Target did not return text-based content", 415, "text/plain; charset=utf-8");

      let filterRegex: RegExp;
      try {
        filterRegex = new RegExp(regexParam!, "gis");
      } catch {
        return respond("Invalid `regex` param", 400, "text/plain; charset=utf-8");
      }

      const matches = [...body.matchAll(filterRegex)];
      if (!matches.length)
        return respond("No regex matches found", 404, "text/plain; charset=utf-8");

      const rawHtml = matches
        .map((m) => (m[1] !== undefined ? m[1] : m[0]).trim())
        .filter(Boolean)
        .join("\n\n");

      return formatOutput(rawHtml, format, isHtml);

    } catch (err) {
      return respond(
        `Proxy error: ${err instanceof Error ? err.message : err}`,
        502,
        "text/plain; charset=utf-8"
      );
    }
  },
};
