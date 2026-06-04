"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations, useLocale } from "next-intl";
import {
  StickyNote,
  Plus,
  Trash2,
  Check,
  X,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import Link from "next/link";
import { useNotes, useCreateNote, useDeleteNote } from "@/hooks";
import { formatDistanceToNow } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

interface NotesWidgetProps {
  maxItems?: number;
  className?: string;
}

function NotesWidgetSkeleton() {
  const t = useTranslations("notesWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-3/4 rounded-lg" />
      </CardContent>
    </Card>
  );
}

export function NotesWidget({
  maxItems = 4,
  className = "",
}: NotesWidgetProps) {
  const t = useTranslations("notesWidget");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const { data: notes, isLoading, isError } = useNotes();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAdding]);

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

  if (isLoading) {
    return <NotesWidgetSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl font-medium">
            <span className="p-1.5 rounded-lg bg-month-primary/10">
              <StickyNote className="size-5 text-month-primary" strokeWidth={1.5} />
            </span>
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <StickyNote className="size-8 mb-2 text-destructive/40" />
            <p className="text-sm">{t("errorMessage")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const allNotes = notes || [];
  const displayNotes = showAll ? allNotes : allNotes.slice(0, maxItems);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      >
        <Card className={`accent-border-top h-full ${className}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl font-medium">
                <span className="p-1.5 rounded-lg bg-month-primary/10">
                  <StickyNote className="size-5 text-month-primary" strokeWidth={1.5} />
                </span>
                {t("title")}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => setIsAdding(true)}
                      aria-label={t("newNoteAria")}
                    >
                      <Plus className="size-4 text-muted-foreground" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("newNoteTooltip")}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/notes"
                      className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
                    aria-label={t("viewAllAria")}
                    >
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("viewAllTooltip")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Add note input */}
            <AnimatePresence>
              {isAdding && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-3 overflow-hidden"
                >
                  <div className="rounded-xl border border-month-primary/30 bg-month-primary/5 p-2">
                    <textarea
                      ref={inputRef}
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleAdd();
                        }
                        if (e.key === "Escape") {
                          setIsAdding(false);
                          setNewContent("");
                        }
                      }}
                      placeholder={t("writePlaceholder")}
                      className="w-full bg-transparent border-none outline-none text-sm resize-none min-h-[3rem]"
                      rows={2}
                      aria-label={t("newNoteInputAria")}
                    />
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => {
                          setIsAdding(false);
                          setNewContent("");
                        }}
                        aria-label={tCommon("cancel")}
                      >
                        <X className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-month-primary hover:text-month-primary"
                        onClick={handleAdd}
                        disabled={!newContent.trim() || createNote.isPending}
                        aria-label={t("saveAria")}
                      >
                        {createNote.isPending ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Notes list */}
            <motion.div
              variants={container}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-2"
            >
              {displayNotes.map((note) => {
                const isExpanded = expandedNoteId === note.id;
                return (
                  <motion.div
                    key={note.id}
                    variants={item}
                    className="group flex items-start gap-2 rounded-lg px-2.5 py-2 -mx-1 transition-colors hover:bg-accent/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50 focus-visible:ring-offset-1"
                    onClick={() => setExpandedNoteId(isExpanded ? null : note.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedNoteId(isExpanded ? null : note.id); } }}
                    aria-expanded={isExpanded}
                    aria-label={t("noteContentAria", { snippet: note.content.slice(0, 50) })}
                  >
                    <div className={`w-1 rounded-full bg-month-primary/30 shrink-0 mt-0.5 transition-all ${isExpanded ? "h-full min-h-[1.5rem]" : "h-6"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-relaxed whitespace-pre-line ${isExpanded ? "" : "line-clamp-2"}`}>
                        {note.content}
                      </p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                        {formatDistanceToNow(new Date(note.created_at), {
                          addSuffix: true,
                          locale: dateLocale,
                        })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => { e.stopPropagation(); setDeleteNoteId(note.id); }}
                      aria-label={t("deleteAria")}
                    >
                      <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </motion.div>
                );
              })}

              {displayNotes.length === 0 && !isAdding && (
                <button
                  onClick={() => setIsAdding(true)}
                  className="flex flex-col items-center justify-center py-6 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <StickyNote className="size-8 mb-2 text-month-primary/20" />
                  <p className="text-sm">{t("emptyAction")}</p>
                </button>
              )}
            </motion.div>

            {allNotes.length > maxItems && (
              <button
                onClick={() => setShowAll(!showAll)}
                className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-border/30 text-sm text-month-primary/60 hover:text-month-primary transition-colors w-full cursor-pointer"
              >
                <span>{showAll ? t("showLess") : t("moreCount", { count: allNotes.length - maxItems })}</span>
                <ChevronRight className={`size-3 transition-transform ${showAll ? "rotate-90" : ""}`} />
              </button>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => { if (!open) setDeleteNoteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialogDescription")}
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
    </TooltipProvider>
  );
}

export { NotesWidgetSkeleton };
