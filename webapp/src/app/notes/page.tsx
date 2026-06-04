"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  StickyNote,
  Plus,
  Trash2,
  Check,
  X,
  Loader2,
  Search,
  Pin,
  Edit3,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { toast } from "sonner";
import {
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useKeyboardShortcuts,
  useSwipeNavigation,
} from "@/hooks";
import { formatDistanceToNow, format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import type { Note } from "@/types/database";

// DB has pinned column but generated types may not include it
type NoteWithPinned = Note & { pinned?: boolean };

function NotesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <GlassCard key={i} className="p-5">
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4 mb-4" />
          <Skeleton className="h-3 w-1/3" />
        </GlassCard>
      ))}
    </div>
  );
}

export default function NotesPage() {
  useKeyboardShortcuts();
  useSwipeNavigation();

  const t = useTranslations("notes");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  const { data: notes, isLoading, error, refetch } = useNotes();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const newNoteRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isAdding && newNoteRef.current) {
      newNoteRef.current.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      // Place cursor at end
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editingId]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    try {
      await createNote.mutateAsync(newContent.trim());
      setNewContent("");
      setIsAdding(false);
      toast.success(t("toastCreated"));
    } catch {
      toast.error(t("toastCreateFailed"));
    }
  };

  const handleStartEdit = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    try {
      await updateNote.mutateAsync({ id: editingId, content: editContent.trim() });
      setEditingId(null);
      setEditContent("");
      toast.success(t("toastUpdated"));
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteNoteId) return;
    try {
      await deleteNote.mutateAsync(deleteNoteId);
      toast.success(t("toastDeleted"));
    } catch {
      toast.error(t("toastDeleteFailed"));
    } finally {
      setDeleteNoteId(null);
    }
  };

  const handleTogglePin = async (note: NoteWithPinned) => {
    try {
      await updateNote.mutateAsync({ id: note.id, pinned: !note.pinned });
      toast.success(note.pinned ? t("toastUnpinned") : t("toastPinned"));
    } catch {
      toast.error(t("toastPinFailed"));
    }
  };

  // Filter notes by search query
  const filteredNotes = useMemo(() => {
    const allNotes = (notes || []) as NoteWithPinned[];
    if (!searchQuery.trim()) return allNotes;
    const query = searchQuery.toLowerCase();
    return allNotes.filter((n) => n.content.toLowerCase().includes(query));
  }, [notes, searchQuery]);

  // Sort: pinned first, then by created_at descending
  const sortedNotes = useMemo(() => {
    return [...filteredNotes].sort((a, b) => {
      if ((a.pinned || false) !== (b.pinned || false)) return a.pinned ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filteredNotes]);

  const pinnedCount = ((notes || []) as NoteWithPinned[]).filter((n) => n.pinned).length;

  return (
    <TooltipProvider>
      <main id="main-content" className="min-h-screen relative overflow-hidden">
        <div className="fixed inset-0 bg-gradient-to-b from-background via-background to-month-primary/5 pointer-events-none" />

        <div className="relative z-10 p-4 md:p-8 max-w-6xl mx-auto safe-area-inset">
          <PageHeader
            icon={StickyNote}
            title={t("title")}
            backHref="/"
            className="mb-8"
            subtitle={
              <>
                {t("subtitleCount", { count: (notes || []).length })}
                {pinnedCount > 0 && (
                  <span className="text-month-primary"> · {t("subtitlePinned", { count: pinnedCount })}</span>
                )}
              </>
            }
            actions={
              <Button
                variant="month"
                size="sm"
                className="gap-2"
                onClick={() => setIsAdding(true)}
              >
                <Plus className="size-4" />
                {t("newButton")}
              </Button>
            }
          />

          {/* Search */}
          {!isLoading && !error && (notes || []).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="mb-6"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                    onClick={() => setSearchQuery("")}
                    aria-label={tCommon("searchClear")}
                  >
                    <X className="size-3.5" />
                  </Button>
                )}
              </div>
              {searchQuery && (
                <p className="text-xs text-muted-foreground mt-2 px-1">
                  {t("searchResults", { count: filteredNotes.length, query: searchQuery })}
                </p>
              )}
            </motion.div>
          )}

          {/* New note input */}
          <AnimatePresence>
            {isAdding && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                className="mb-6 overflow-hidden"
              >
                <GlassCard className="p-4 ring-2 ring-month-primary/30">
                  <textarea
                    ref={newNoteRef}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleAdd();
                      }
                      if (e.key === "Escape") {
                        setIsAdding(false);
                        setNewContent("");
                      }
                    }}
                    placeholder={t("writePlaceholder")}
                    className="w-full bg-transparent border-none outline-none text-sm resize-none min-h-[6rem]"
                    rows={4}
                    aria-label={t("newNoteAria")}
                  />
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                    <span className="text-[11px] text-muted-foreground">
                      {t("saveHint")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsAdding(false);
                          setNewContent("");
                        }}
                      >
                        {tCommon("cancel")}
                      </Button>
                      <Button
                        variant="month"
                        size="sm"
                        onClick={handleAdd}
                        disabled={!newContent.trim() || createNote.isPending}
                      >
                        {createNote.isPending ? (
                          <Loader2 className="size-4 animate-spin mr-2" />
                        ) : (
                          <Check className="size-4 mr-2" />
                        )}
                        {tCommon("save")}
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Content */}
          {error ? (
            <GlassCard className="p-8">
              <ErrorState
                onRetry={refetch}
                message={t("errorMessage")}
              />
            </GlassCard>
          ) : isLoading ? (
            <NotesSkeleton />
          ) : sortedNotes.length === 0 ? (
            <GlassCard className="p-8">
              {searchQuery ? (
                <EmptyState
                  icon={Search}
                  title={t("emptySearchTitle")}
                  description={t("emptySearchDescription", { query: searchQuery })}
                  action={{
                    label: tCommon("searchClear"),
                    onClick: () => setSearchQuery(""),
                  }}
                />
              ) : (
                <EmptyState
                  icon={StickyNote}
                  title={t("emptyTitle")}
                  description={t("emptyDescription")}
                  action={{
                    label: t("emptyAction"),
                    onClick: () => setIsAdding(true),
                  }}
                />
              )}
            </GlassCard>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {sortedNotes.map((note, index) => {
                  const isEditing = editingId === note.id;

                  return (
                    <motion.div
                      key={note.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <GlassCard
                        className={`group relative p-5 transition-all hover:bg-white/[0.06] ${
                          note.pinned ? "ring-1 ring-month-primary/20" : ""
                        } ${isEditing ? "ring-2 ring-month-primary/40" : ""}`}
                      >
                        {/* Pin indicator */}
                        {note.pinned && !isEditing && (
                          <div className="absolute top-3 right-3">
                            <Pin className="size-3.5 text-month-primary/60 fill-month-primary/60" />
                          </div>
                        )}

                        {isEditing ? (
                          /* Edit mode */
                          <div>
                            <textarea
                              ref={editRef}
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                  e.preventDefault();
                                  handleSaveEdit();
                                }
                                if (e.key === "Escape") {
                                  setEditingId(null);
                                  setEditContent("");
                                }
                              }}
                              className="w-full bg-transparent border-none outline-none text-sm resize-none min-h-[6rem]"
                              rows={4}
                              aria-label={t("editAria")}
                            />
                            <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-border/30">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditContent("");
                                }}
                              >
                                <X className="size-3.5 mr-1" />
                                {tCommon("cancel")}
                              </Button>
                              <Button
                                variant="month"
                                size="sm"
                                onClick={handleSaveEdit}
                                disabled={!editContent.trim() || updateNote.isPending}
                              >
                                {updateNote.isPending ? (
                                  <Loader2 className="size-3.5 animate-spin mr-1" />
                                ) : (
                                  <Check className="size-3.5 mr-1" />
                                )}
                                {tCommon("save")}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          /* View mode */
                          <>
                            <p className="text-base leading-relaxed whitespace-pre-line mb-4 pr-6">
                              {note.content}
                            </p>
                            <div className="flex items-center justify-between">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(note.created_at), {
                                      addSuffix: true,
                                      locale: dateLocale,
                                    })}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{format(new Date(note.created_at), "PPPp", { locale: dateLocale })}</p>
                                </TooltipContent>
                              </Tooltip>

                              {/* Actions */}
                              <div className="flex items-center gap-0.5 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={`size-9 ${note.pinned ? "text-month-primary" : ""}`}
                                      onClick={() => handleTogglePin(note)}
                                      aria-label={note.pinned ? t("unpinAria") : t("pinAria")}
                                    >
                                      <Pin className={`size-4 ${note.pinned ? "fill-current" : ""}`} />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{note.pinned ? t("unpinTooltip") : t("pinTooltip")}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-9"
                                      onClick={() => handleStartEdit(note)}
                                      aria-label={t("editAria")}
                                    >
                                      <Edit3 className="size-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tCommon("edit")}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-9 text-destructive hover:text-destructive"
                                      onClick={() => setDeleteNoteId(note.id)}
                                      aria-label={t("deleteAria")}
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tCommon("delete")}</TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          </>
                        )}
                      </GlassCard>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => { if (!open) setDeleteNoteId(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("deleteDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleConfirmDelete}
                disabled={deleteNote.isPending}
              >
                {deleteNote.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : null}
                {tCommon("delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </TooltipProvider>
  );
}
