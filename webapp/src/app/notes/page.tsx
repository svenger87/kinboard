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
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FAB } from "@/components/fab";
import { noteStyle } from "@/lib/note-style";
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
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";
import { showUndoToast } from "@/lib/undo-toast";
import {
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  useKeyboardShortcuts,
  useSwipeNavigation,
  usePeople,
  queryKeys,
} from "@/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import type { Note } from "@/types/database";

// DB has pinned column and person_id but generated types may not include them yet
type NoteWithPinned = Note & { pinned?: boolean; person_id?: string | null };

function NotesSkeleton() {
  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="break-inside-avoid mb-4 p-5">
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4 mb-4" />
          <Skeleton className="h-3 w-1/3" />
        </Card>
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
  const { data: people } = usePeople();
  const queryClient = useQueryClient();
  const { family } = useFamilyStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newAuthor, setNewAuthor] = useState<string>("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editAuthor, setEditAuthor] = useState<string>("none");
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
      await createNote.mutateAsync({
        content: newContent.trim(),
        person_id: newAuthor === "none" ? null : newAuthor,
      });
      setNewContent("");
      setNewAuthor("none");
      setIsAdding(false);
      toast.success(t("toastCreated"));
    } catch {
      toast.error(t("toastCreateFailed"));
    }
  };

  const handleStartEdit = (note: NoteWithPinned) => {
    setEditingId(note.id);
    setEditContent(note.content);
    setEditAuthor(note.person_id ?? "none");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    try {
      await updateNote.mutateAsync({
        id: editingId,
        content: editContent.trim(),
        person_id: editAuthor === "none" ? null : editAuthor,
      });
      setEditingId(null);
      setEditContent("");
      setEditAuthor("none");
      toast.success(t("toastUpdated"));
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteNoteId) return;
    const noteSnapshot = (notes as NoteWithPinned[] | undefined)?.find(
      (n) => n.id === deleteNoteId
    );
    try {
      await deleteNote.mutateAsync(deleteNoteId);
      if (noteSnapshot) {
        showUndoToast({
          message: t("toastDeleted"),
          undoLabel: tCommon("undo"),
          errorMessage: tCommon("undoFailed"),
          onUndo: async () => {
            const supabase = createClient();

            const { error } = await (supabase as any).from("notes").insert(noteSnapshot);
            if (error) throw error;
            if (family?.id) {
              queryClient.invalidateQueries({ queryKey: queryKeys.notes(family.id) });
            }
          },
        });
      } else {
        toast.success(t("toastDeleted"));
      }
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
      <main id="main-content" className="min-h-page relative overflow-hidden">
        <div className="page-gradient" />

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
                  <span className="text-primary"> · {t("subtitlePinned", { count: pinnedCount })}</span>
                )}
              </>
            }
            actions={
              <Button
                variant="default"
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
                <Card className="p-4 ring-2 ring-primary/30">
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
                        setNewAuthor("none");
                      }
                    }}
                    placeholder={t("writePlaceholder")}
                    className="w-full bg-transparent border-none outline-none text-sm resize-none min-h-[6rem]"
                    rows={4}
                    aria-label={t("newNoteAria")}
                  />
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground hidden sm:block">
                        {t("saveHint")}
                      </span>
                      {people && people.length > 0 && (
                        <Select value={newAuthor} onValueChange={setNewAuthor}>
                          <SelectTrigger className="h-7 text-xs w-36 gap-1">
                            <SelectValue placeholder={t("authorLabel")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("authorNone")}</SelectItem>
                            {people.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className="inline-block rounded-full shrink-0"
                                    style={{ width: 10, height: 10, backgroundColor: p.color }}
                                  />
                                  {p.name}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsAdding(false);
                          setNewContent("");
                          setNewAuthor("none");
                        }}
                      >
                        {tCommon("cancel")}
                      </Button>
                      <Button
                        variant="default"
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
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Content */}
          {error ? (
            <Card className="p-8">
              <ErrorState
                onRetry={refetch}
                message={t("errorMessage")}
              />
            </Card>
          ) : isLoading ? (
            <NotesSkeleton />
          ) : sortedNotes.length === 0 ? (
            <Card className="p-8">
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
            </Card>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="columns-1 sm:columns-2 lg:columns-3 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {sortedNotes.map((note) => {
                  const isEditing = editingId === note.id;
                  const style = noteStyle(note.id);

                  return (
                    <div
                      key={note.id}
                      className="break-inside-avoid mb-4"
                      style={{ transform: isEditing ? undefined : `rotate(${style.rotateDeg}deg)` }}
                    >
                      <Card
                        className={`group relative border-transparent p-5 elev-md transition-shadow ${
                          note.pinned ? "ring-1 ring-primary/30" : ""
                        } ${isEditing ? "ring-2 ring-primary/40" : ""}`}
                        style={{ backgroundColor: isEditing ? undefined : style.tintVar }}
                      >
                        {/* Pin indicator */}
                        {note.pinned && !isEditing && (
                          <div className="absolute top-3 right-3">
                            <Pin className="size-3.5 text-primary/70 fill-primary/70" />
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
                                  setEditAuthor("none");
                                }
                              }}
                              className="w-full bg-transparent border-none outline-none text-sm resize-none min-h-[6rem]"
                              rows={4}
                              aria-label={t("editAria")}
                            />
                            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/30">
                              {people && people.length > 0 && (
                                <Select value={editAuthor} onValueChange={setEditAuthor}>
                                  <SelectTrigger className="h-7 text-xs w-36 gap-1">
                                    <SelectValue placeholder={t("authorLabel")} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">{t("authorNone")}</SelectItem>
                                    {people.map((p) => (
                                      <SelectItem key={p.id} value={p.id}>
                                        <span className="flex items-center gap-1.5">
                                          <span
                                            className="inline-block rounded-full shrink-0"
                                            style={{ width: 10, height: 10, backgroundColor: p.color }}
                                          />
                                          {p.name}
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <div className="flex items-center gap-2 ml-auto">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditingId(null);
                                  setEditContent("");
                                  setEditAuthor("none");
                                }}
                              >
                                <X className="size-3.5 mr-1" />
                                {tCommon("cancel")}
                              </Button>
                              <Button
                                variant="default"
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
                          </div>
                        ) : (
                          /* View mode */
                          <>
                            <p className="text-base leading-relaxed whitespace-pre-line mb-4 pr-6">
                              {note.content}
                            </p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                {(() => {
                                  const author = note.person_id
                                    ? people?.find((p) => p.id === note.person_id)
                                    : undefined;
                                  return author ? (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                                      <span
                                        className="inline-block rounded-full shrink-0"
                                        style={{ width: 10, height: 10, backgroundColor: author.color }}
                                      />
                                      <span className="truncate">{author.name}</span>
                                    </span>
                                  ) : null;
                                })()}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      {format(new Date(note.created_at), "d. MMM yyyy", { locale: dateLocale })}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{format(new Date(note.created_at), "PPPp", { locale: dateLocale })}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-0.5 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={`size-9 ${note.pinned ? "text-primary" : ""}`}
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
                      </Card>
                    </div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {/* Mobile add FAB */}
        <FAB
          icon={Plus}
          onClick={() => setIsAdding(true)}
          ariaLabel={t("fabAria")}
          className="sm:hidden"
        />

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
