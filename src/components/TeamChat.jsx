import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  MessageCircle,
  Send,
  Trash2,
  Info,
  Smile,
  Paperclip,
  Image as ImageIcon,
  FileText,
  X,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

// ─── Constants ───────────────────────────────────────────────────────────────
const DELETE_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 1)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7)
    return d.toLocaleDateString([], {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function senderName(msg) {
  return msg.profiles?.name || msg.profiles?.email || "Unknown";
}

function initials(msg) {
  return (senderName(msg)[0] ?? "?").toUpperCase();
}

const AVATAR_COLOURS = [
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-purple-100 text-purple-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];
function avatarColour(userId) {
  let hash = 0;
  for (let i = 0; i < (userId?.length ?? 0); i++)
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function canDelete(msg) {
  if (!msg.created_at) return false;
  return Date.now() - new Date(msg.created_at).getTime() < DELETE_WINDOW_MS;
}

function isImage(type) {
  return IMAGE_TYPES.includes(type);
}

// ─── Attachment Preview (in message bubble) ──────────────────────────────────

function AttachmentBubble({ msg, isOwn }) {
  const url = msg.attachment_url;
  const name = msg.attachment_name || "file";
  const type = msg.attachment_type || "";
  const size = msg.attachment_size;

  if (!url) return null;

  if (isImage(type)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={name}
          className="rounded-lg max-w-[240px] max-h-[200px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
          loading="lazy"
        />
      </a>
    );
  }

  const handleDownload = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(url, "_blank");
    }
  };

  return (
    <div
      className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border ${
        isOwn
          ? "border-indigo-300/50 bg-indigo-700 text-white hover:bg-indigo-800"
          : "border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200"
      } transition-colors cursor-pointer`}
      onClick={() => window.open(url, "_blank")}
    >
      <FileText
        className={`w-5 h-5 shrink-0 ${isOwn ? "text-indigo-200" : "text-slate-500"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate">{name}</p>
        {size && (
          <p
            className={`text-xs ${isOwn ? "text-indigo-200" : "text-slate-500"}`}
          >
            {formatFileSize(size)}
          </p>
        )}
      </div>
      <button
        onClick={handleDownload}
        className={`p-1 rounded hover:bg-black/10 transition-colors ${isOwn ? "text-indigo-100" : "text-slate-600"}`}
        title="Download"
      >
        <Download className="w-4 h-4 shrink-0" />
      </button>
    </div>
  );
}

// ─── Pending File Preview (compose area) ─────────────────────────────────────

function PendingAttachment({ file, onRemove }) {
  const isImg = isImage(file.type);
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
      {isImg ? (
        <ImageIcon className="w-4 h-4 text-blue-500 shrink-0" />
      ) : (
        <FileText className="w-4 h-4 text-slate-500 shrink-0" />
      )}
      <span className="truncate flex-1 text-slate-700">{file.name}</span>
      <span className="text-xs text-slate-400 shrink-0">
        {formatFileSize(file.size)}
      </span>
      <button
        onClick={onRemove}
        className="p-0.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function TeamChat({ teamId }) {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Force re-render every 30s so delete buttons appear/disappear at the right time
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  const cacheKey = ["teamChat", teamId, authUser?.id];

  // ── Load messages ─────────────────────────────────────────────────────────
  const { data: messages = [], isLoading } = useQuery({
    queryKey: cacheKey,
    queryFn: () => api.entities.TeamChat.getMessages(teamId),
    enabled: !!teamId && !!authUser?.id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  // ── Realtime ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!teamId || !authUser?.id) return;
    const channel = api.entities.TeamChat.subscribeToMessages(
      teamId,
      async (newMsg) => {
        const current = queryClient.getQueryData(cacheKey) ?? [];
        if (current.some((m) => m.id === newMsg.id)) return;
        const enriched = await api.entities.TeamChat.enrichMessage(
          newMsg,
          teamId,
        ).catch(() => ({ ...newMsg, profiles: null }));
        queryClient.setQueryData(cacheKey, (prev = []) => {
          if (prev.some((m) => m.id === enriched.id)) return prev;
          return [...prev, enriched];
        });
      },
    );
    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, authUser?.id, queryClient]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFileSelect = useCallback((file) => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setSendError("File must be under 10 MB.");
      return;
    }
    setPendingFile(file);
    setSendError("");
  }, []);

  const onFileInputChange = (e) => {
    handleFileSelect(e.target.files?.[0]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Drag & drop ───────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !pendingFile) || sending) return;
    setSending(true);
    setSendError("");
    setShowEmoji(false);

    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      team_id: teamId,
      user_id: authUser?.id,
      message: text,
      created_at: new Date().toISOString(),
      profiles: {
        name: authUser?.email?.split("@")[0],
        email: authUser?.email,
      },
      attachment_url: pendingFile ? URL.createObjectURL(pendingFile) : null,
      attachment_name: pendingFile?.name ?? null,
      attachment_type: pendingFile?.type ?? null,
      attachment_size: pendingFile?.size ?? null,
      _optimistic: true,
    };
    queryClient.setQueryData(cacheKey, (prev = []) => [...prev, optimistic]);
    setDraft("");
    const fileToUpload = pendingFile;
    setPendingFile(null);

    try {
      let attachment = null;
      if (fileToUpload) {
        attachment = await api.entities.TeamChat.uploadFile(
          teamId,
          fileToUpload,
        );
      }
      const saved = await api.entities.TeamChat.sendMessage(
        teamId,
        text || "",
        attachment,
      );
      queryClient.setQueryData(cacheKey, (prev = []) =>
        prev.map((m) => (m.id === tempId ? saved : m)),
      );
    } catch (err) {
      setSendError(err?.message ?? "Failed to send message.");
      queryClient.setQueryData(cacheKey, (prev = []) =>
        prev.filter((m) => m.id !== tempId),
      );
      setDraft(text);
      setPendingFile(fileToUpload);
    } finally {
      setSending(false);
    }
  }, [draft, pendingFile, sending, teamId, authUser, queryClient, cacheKey]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (msgId) => {
    queryClient.setQueryData(cacheKey, (prev = []) =>
      prev.filter((m) => m.id !== msgId),
    );
    try {
      await api.entities.TeamChat.deleteMessage(msgId);
    } catch {
      queryClient.invalidateQueries({ queryKey: cacheKey });
    }
  };

  // ── Emoji ─────────────────────────────────────────────────────────────────
  const onEmojiSelect = (emoji) => {
    setDraft((d) => d + emoji.native);
    textareaRef.current?.focus();
  };

  // Close emoji picker on outside click
  const emojiRef = useRef(null);
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmoji]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card
      className="flex flex-col relative"
      style={{ height: "520px" }}
      ref={dropZoneRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-indigo-50/90 border-2 border-dashed border-indigo-400 rounded-xl flex flex-col items-center justify-center pointer-events-none">
          <ImageIcon className="w-10 h-10 text-indigo-500 mb-2" />
          <p className="text-indigo-600 font-medium text-sm">
            Drop file to attach
          </p>
        </div>
      )}

      <CardHeader className="pb-3 border-b border-slate-200 shrink-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="w-5 h-5 text-indigo-500" />
          Team Chat
          <span className="ml-auto flex items-center gap-1 text-xs font-normal text-slate-400">
            <Info className="w-3.5 h-3.5" />
            Messages expire after 2½ weeks
          </span>
        </CardTitle>
      </CardHeader>

      {/* Message list */}
      <CardContent className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageCircle className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-slate-400 text-sm">No messages yet.</p>
            <p className="text-slate-400 text-xs mt-1">
              Start a conversation with your team!
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isOwn = msg.user_id === authUser?.id;
          const showHeader =
            idx === 0 || messages[idx - 1]?.user_id !== msg.user_id;
          const deletable = isOwn && !msg._optimistic && canDelete(msg);

          return (
            <div
              key={msg.id}
              className={`flex gap-2.5 group ${isOwn ? "flex-row-reverse" : ""}`}
            >
              {/* Avatar */}
              <div className="w-8 shrink-0">
                {showHeader && (
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${avatarColour(msg.user_id)}`}
                  >
                    {initials(msg)}
                  </div>
                )}
              </div>

              {/* Bubble + meta */}
              <div
                className={`max-w-[72%] space-y-0.5 ${isOwn ? "items-end" : "items-start"} flex flex-col`}
              >
                {showHeader && (
                  <div
                    className={`flex items-baseline gap-2 text-xs text-slate-500 ${isOwn ? "flex-row-reverse" : ""}`}
                  >
                    <span className="font-medium text-slate-700">
                      {isOwn ? "You" : senderName(msg)}
                    </span>
                    <span>{formatTime(msg.created_at)}</span>
                  </div>
                )}

                <div
                  className={`flex items-end gap-1.5 ${isOwn ? "flex-row-reverse" : ""}`}
                >
                  <div className="space-y-1.5">
                    {/* Attachment */}
                    {msg.attachment_url && (
                      <AttachmentBubble msg={msg} isOwn={isOwn} />
                    )}

                    {/* Text bubble */}
                    {msg.message && (
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                          isOwn
                            ? "bg-indigo-600 text-white rounded-tr-sm"
                            : "bg-slate-100 text-slate-900 rounded-tl-sm"
                        } ${msg._optimistic ? "opacity-70" : ""}`}
                      >
                        {msg.message}
                      </div>
                    )}
                  </div>

                  {/* Delete — only within 2 minutes */}
                  {deletable && (
                    <button
                      onClick={() => handleDelete(msg.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"
                      title="Delete message (within 2 min)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {!showHeader && (
                  <span
                    className={`text-[10px] text-slate-400 ${isOwn ? "text-right" : ""}`}
                  >
                    {formatTime(msg.created_at)}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </CardContent>

      {/* Input area */}
      <div className="shrink-0 border-t border-slate-200 px-4 py-3 space-y-2">
        {sendError && <p className="text-xs text-red-600">{sendError}</p>}

        {/* Pending file preview */}
        {pendingFile && (
          <PendingAttachment
            file={pendingFile}
            onRemove={() => setPendingFile(null)}
          />
        )}

        {/* Emoji picker */}
        {showEmoji && (
          <div ref={emojiRef} className="absolute bottom-20 left-4 z-50">
            <Picker
              data={data}
              onEmojiSelect={onEmojiSelect}
              theme="light"
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={2}
            />
          </div>
        )}

        <div className="flex gap-2 items-end">
          {/* Emoji toggle */}
          <button
            type="button"
            onClick={() => setShowEmoji((s) => !s)}
            className={`p-2 rounded-lg transition-colors ${
              showEmoji
                ? "bg-indigo-100 text-indigo-600"
                : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            }`}
            title="Emoji"
          >
            <Smile className="w-5 h-5" />
          </button>

          {/* File attach */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Attach file or image"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={onFileInputChange}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.json"
          />

          {/* Text input */}
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSendError("");
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send)"
            className="flex-1 min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
          />

          {/* Send */}
          <Button
            onClick={handleSend}
            disabled={(!draft.trim() && !pendingFile) || sending}
            size="icon"
            className="bg-indigo-600 hover:bg-indigo-700 h-10 w-10 shrink-0"
          >
            {sending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
