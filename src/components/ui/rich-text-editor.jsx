import { useId, useMemo } from "react";
import ReactQuill from "react-quill";
import { Redo2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import "react-quill/dist/quill.snow.css";
import "./rich-text-editor.css";

const EMPTY_EDITOR_VALUES = new Set([
  "",
  "<p><br></p>",
  "<p></p>",
  "<div><br></div>",
]);

const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "I",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

const FORMATS = [
  "header",
  "bold",
  "italic",
  "underline",
  "list",
  "bullet",
  "link",
];

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export function isRichTextHtml(value) {
  return /<\/?(?:p|div|br|strong|b|em|i|u|h[1-3]|ul|ol|li|a|blockquote)\b/i.test(
    String(value ?? ""),
  );
}

export function plainTextToRichHtml(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

export function listToRichHtml(items, ordered = false) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (values.length === 0) return "";
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${values
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("")}</${tag}>`;
}

function isSafeLink(href) {
  const value = String(href ?? "").trim();
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("/") || value.startsWith(".")) {
    return true;
  }
  try {
    const parsed = new URL(value, "https://legispulse.invalid");
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function sanitizeRichTextHtml(value) {
  const html = String(value ?? "").trim();
  if (EMPTY_EDITOR_VALUES.has(html)) return "";
  if (typeof DOMParser === "undefined") return html;

  const documentValue = new DOMParser().parseFromString(html, "text/html");
  for (const element of [...documentValue.body.querySelectorAll("*")]) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }

    const href = element.tagName === "A" ? element.getAttribute("href") : null;
    for (const attribute of [...element.attributes]) {
      element.removeAttribute(attribute.name);
    }

    if (element.tagName === "A") {
      if (!isSafeLink(href)) {
        element.replaceWith(...element.childNodes);
        continue;
      }
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  return documentValue.body.innerHTML.trim();
}

export function richTextHasContent(value) {
  const html = String(value ?? "");
  if (EMPTY_EDITOR_VALUES.has(html.trim())) return false;
  if (typeof DOMParser !== "undefined") {
    const documentValue = new DOMParser().parseFromString(html, "text/html");
    return Boolean(documentValue.body.textContent?.replace(/\u00a0/g, " ").trim());
  }
  return Boolean(html.replace(/<[^>]*>/g, "").trim());
}

function undoChange() {
  this.quill.history.undo();
}

function redoChange() {
  this.quill.history.redo();
}

function EditorToolbar({ id }) {
  return (
    <div id={id} className="rich-text-editor__toolbar">
      <span className="ql-formats">
        <button type="button" className="ql-undo" title="Undo" aria-label="Undo">
          <Undo2 />
        </button>
        <button type="button" className="ql-redo" title="Redo" aria-label="Redo">
          <Redo2 />
        </button>
      </span>
      <span className="ql-formats">
        <select className="ql-header" defaultValue="" title="Text style" aria-label="Text style">
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
          <option value="">Normal</option>
        </select>
      </span>
      <span className="ql-formats">
        <button type="button" className="ql-bold" title="Bold" aria-label="Bold" />
        <button type="button" className="ql-italic" title="Italic" aria-label="Italic" />
        <button type="button" className="ql-underline" title="Underline" aria-label="Underline" />
      </span>
      <span className="ql-formats">
        <button
          type="button"
          className="ql-list"
          value="bullet"
          title="Bulleted list"
          aria-label="Bulleted list"
        />
        <button
          type="button"
          className="ql-list"
          value="ordered"
          title="Numbered list"
          aria-label="Numbered list"
        />
      </span>
      <span className="ql-formats">
        <button type="button" className="ql-link" title="Add link" aria-label="Add link" />
        <button
          type="button"
          className="ql-clean"
          title="Clear formatting"
          aria-label="Clear formatting"
        />
      </span>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 120,
  className,
}) {
  const reactId = useId();
  const toolbarId = `rich-editor-toolbar-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const modules = useMemo(
    () => ({
      toolbar: {
        container: `#${toolbarId}`,
        handlers: {
          undo: undoChange,
          redo: redoChange,
        },
      },
      history: {
        delay: 500,
        maxStack: 100,
        userOnly: true,
      },
      clipboard: {
        matchVisual: false,
      },
    }),
    [toolbarId],
  );

  return (
    <div
      className={cn("rich-text-editor", className)}
      style={{ "--rich-editor-min-height": `${minHeight}px` }}
    >
      <EditorToolbar id={toolbarId} />
      <ReactQuill
        theme="snow"
        value={value || ""}
        onChange={(nextValue) =>
          onChange(EMPTY_EDITOR_VALUES.has(nextValue.trim()) ? "" : nextValue)
        }
        modules={modules}
        formats={FORMATS}
        placeholder={placeholder}
        preserveWhitespace
      />
    </div>
  );
}

export function RichTextContent({ value, emptyText = "Not yet provided.", className }) {
  const safeHtml = sanitizeRichTextHtml(value);
  if (!richTextHasContent(safeHtml)) {
    return <p className="text-slate-400 italic text-sm">{emptyText}</p>;
  }
  return (
    <div
      className={cn("rich-text-content", className)}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
