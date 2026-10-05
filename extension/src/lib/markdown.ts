import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

const TIMESTAMP_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

/**
 * Render model markdown to sanitized HTML with clickable [mm:ss] timestamps.
 * Code/pre content is left untouched.
 */
export function renderMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown ?? "", { async: false }) as string;
  // Never emit unsanitized model output. In Chrome DOMPurify is always
  // supported; this guard protects unusual/embedded environments.
  if (typeof window === "undefined" || !DOMPurify.isSupported) {
    return `<pre class="md-escaped">${escapeHtml(markdown ?? "")}</pre>`;
  }
  const sanitized = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
  });
  if (typeof DOMParser === "undefined") return sanitized;
  return linkifyTimestamps(sanitized);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function linkifyTimestamps(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (TIMESTAMP_RE.test(text.data) && !isInsideCode(text)) {
      targets.push(text);
    }
    TIMESTAMP_RE.lastIndex = 0;
    node = walker.nextNode();
  }
  for (const target of targets) {
    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    const value = target.data;
    TIMESTAMP_RE.lastIndex = 0;
    let match = TIMESTAMP_RE.exec(value);
    while (match) {
      if (match.index > lastIndex) {
        fragment.appendChild(doc.createTextNode(value.slice(lastIndex, match.index)));
      }
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "ts-link";
      button.dataset.ts = match[1];
      button.textContent = match[1];
      fragment.appendChild(button);
      lastIndex = match.index + match[0].length;
      match = TIMESTAMP_RE.exec(value);
    }
    if (lastIndex < value.length) {
      fragment.appendChild(doc.createTextNode(value.slice(lastIndex)));
    }
    target.parentNode?.replaceChild(fragment, target);
  }
  return doc.body.innerHTML;
}

function isInsideCode(node: Node): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (parent.tagName === "CODE" || parent.tagName === "PRE") return true;
    parent = parent.parentElement;
  }
  return false;
}
