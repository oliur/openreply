"use client";

/**
 * Rich text editor for email bodies.
 *
 * A small TipTap editor: paragraphs, bold, italic, one heading level, lists
 * and links. It produces plain HTML that any mail client renders, and nothing
 * else — no images, tables or embeds, so what the team writes here is what the
 * lead receives.
 */

import { useEffect, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useI18n } from "@/lib/i18n/provider";

/** True when a stored body was written with this editor rather than typed as text. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value);
}

/** Older plain-text bodies become paragraphs so the editor shows them as written. */
export function plainTextToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs transition-colors ${
        active
          ? "bg-accent/15 text-accent"
          : "text-muted hover:bg-surface hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function LinkControls({ editor }: { editor: Editor }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");

  function apply() {
    const trimmed = url.trim();
    if (!trimmed) return;
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setUrl("");
    setOpen(false);
  }

  if (editor.isActive("link")) {
    return (
      <ToolbarButton
        active
        title={t("Remove link")}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        {t("Remove link")}
      </ToolbarButton>
    );
  }

  if (!open) {
    return (
      <ToolbarButton title={t("Link")} onClick={() => setOpen(true)}>
        {t("Link")}
      </ToolbarButton>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        type="url"
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={t("Paste a link and press Enter")}
        className="w-56 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground focus:border-accent/40 focus:outline-none"
      />
      <ToolbarButton title={t("Add link")} onClick={apply}>
        {t("Add link")}
      </ToolbarButton>
    </span>
  );
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? "" : editor.getHTML());
    },
  });

  // Edit mode loads the campaign after the editor mounts; push the stored body
  // in when it arrives (and only then, so typing is never interrupted).
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.isEmpty ? "" : editor.getHTML();
    if (value !== current) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) {
    return <div className="min-h-[200px] rounded-lg border border-border bg-surface" />;
  }

  return (
    <div className="rounded-lg border border-border bg-surface focus-within:border-accent/40">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <ToolbarButton
          active={editor.isActive("bold")}
          title={t("Bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          title={t("Italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          title={t("Heading")}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("bulletList")}
          title={t("Bullet list")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • {t("List")}
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          title={t("Numbered list")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. {t("List")}
        </ToolbarButton>
        <LinkControls editor={editor} />
      </div>
      <EditorContent
        editor={editor}
        className="px-3 py-2 text-sm text-foreground [&_.ProseMirror]:min-h-[180px] [&_.ProseMirror]:outline-none [&_.ProseMirror_p]:my-1.5 [&_.ProseMirror_h2]:my-2 [&_.ProseMirror_h2]:text-base [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_ul]:my-1.5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:my-1.5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_a]:text-accent [&_.ProseMirror_a]:underline [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-zinc-500 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
