"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { User, Calendar, CheckSquare, GraduationCap, X } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { PersonAvatar } from "@/components/person-avatar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePeople, useTodos, useEvents } from "@/hooks";
import type { Person, Todo, Event } from "@/types/database";
import { format, startOfDay, addDays, endOfDay, isAfter } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";

interface FamilyMembersProps {
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function isEmojiAvatar(avatar: string | null): boolean {
  if (!avatar) return false;
  return !avatar.startsWith("http") && !avatar.startsWith("data:");
}

function isImageAvatar(avatar: string | null): boolean {
  if (!avatar) return false;
  return avatar.startsWith("http") || avatar.startsWith("data:");
}

function MemberSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Skeleton className="size-16 rounded-full" />
      <Skeleton className="h-4 w-12" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

function FamilyMembersSkeleton() {
  return (
    <div className="flex items-center justify-center gap-6">
      <MemberSkeleton />
      <MemberSkeleton />
      <MemberSkeleton />
    </div>
  );
}

export function FamilyMembers({ className = "" }: FamilyMembersProps) {
  const t = useTranslations("familyMembers");
  const { data: people, isLoading: loadingPeople } = usePeople();
  const { data: todos } = useTodos();

  // Only fetch upcoming events (today + next 7 days)
  const today = startOfDay(new Date());
  const weekFromNow = endOfDay(addDays(today, 7));
  const { data: events } = useEvents(today.toISOString(), weekFromNow.toISOString());

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);

  // Filter to only show events that haven't ended yet
  const upcomingEvents = events?.filter((e) => {
    const eventEnd = e.end_at ? new Date(e.end_at) : new Date(e.start_at);
    return isAfter(eventEnd, new Date());
  });

  if (loadingPeople) {
    return <FamilyMembersSkeleton />;
  }

  if (!people || people.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center">
          <User className="size-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("emptyState")}
        </p>
      </div>
    );
  }

  const getMemberStatus = (personId: string) => {
    const personTodos = todos?.filter(
      (t) => t.person_id === personId && !t.completed
    );
    // Check event's person_id first, then fall back to calendar's person_id
    const personEvents = upcomingEvents?.filter(
      (e) => (e.person_id || e.calendar?.person_id) === personId
    );
    return {
      todos: personTodos?.length || 0,
      events: personEvents?.length || 0,
    };
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.4 },
    },
  };

  const item = {
    hidden: { opacity: 0, scale: 0.92 },
    show: { opacity: 1, scale: 1, transition: { duration: 0.22 } },
  };

  return (
    <TooltipProvider>
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className={`flex items-center justify-center gap-4 md:gap-6 ${className}`}
      >
        {people.map((member) => {
          const status = getMemberStatus(member.id);

          return (
            <Tooltip key={member.id}>
              <TooltipTrigger asChild>
                <motion.div
                  variants={item}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSelectedPerson(member)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedPerson(member); } }}
                  role="button"
                  tabIndex={0}
                  aria-label={t("detailsAria", { name: member.name })}
                  className="flex flex-col items-center gap-2 cursor-pointer group"
                >
                  <PersonAvatar
                    name={member.name}
                    color={member.color}
                    avatarUrl={member.avatar_url}
                    size={64}
                    className="transition-transform [transition-duration:120ms] group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  />
                  <span className="text-sm font-medium text-foreground/90 group-hover:text-foreground transition-colors">
                    {member.name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {status.events === 0 && status.todos === 0
                      ? t("statusNothing")
                      : [
                          status.events > 0 ? t("statusEvents", { count: status.events }) : null,
                          status.todos > 0 ? t("statusTasks", { count: status.todos }) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">
                  {t("summaryTooltip", { events: status.events, todos: status.todos })}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </motion.div>

      {/* Person Details Dialog */}
      <PersonDetailsDialog
        person={selectedPerson}
        todos={todos?.filter((t) => t.person_id === selectedPerson?.id && !t.completed) || []}
        events={upcomingEvents?.filter((e) => (e.person_id || e.calendar?.person_id) === selectedPerson?.id) || []}
        onClose={() => setSelectedPerson(null)}
      />
    </TooltipProvider>
  );
}

interface PersonDetailsDialogProps {
  person: Person | null;
  todos: Todo[];
  events: Event[];
  onClose: () => void;
}

function PersonDetailsDialog({ person, todos, events, onClose }: PersonDetailsDialogProps) {
  const t = useTranslations("familyMembers");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  if (!person) return null;

  return (
    <Dialog open={!!person} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        {/* Colored header banner */}
        <div
          className="relative px-6 pt-6 pb-4"
          style={{
            background: `linear-gradient(135deg, ${person.color}20, ${person.color}08)`,
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-4">
              <Avatar
                className="size-14 ring-2 ring-white/20 shadow-lg"
                style={{
                  border: `3px solid ${person.color}`,
                  backgroundColor: `${person.color}20`,
                }}
              >
                {person.avatar_url && isImageAvatar(person.avatar_url) ? (
                  <AvatarImage src={person.avatar_url} alt={person.name} />
                ) : null}
                <AvatarFallback
                  className="text-xl font-medium"
                  style={{
                    backgroundColor: `${person.color}20`,
                    color: person.color,
                  }}
                >
                  {person.avatar_url && isEmojiAvatar(person.avatar_url) ? (
                    <span className="text-3xl">{person.avatar_url}</span>
                  ) : (
                    getInitials(person.name)
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-xl" style={{ color: person.color }}>{person.name}</span>
                {person.is_child && (
                  <Badge variant="outline" className="w-fit mt-1 text-xs" style={{ borderColor: `${person.color}40`, color: person.color }}>
                    <GraduationCap className="size-3 mr-1" />
                    {t("childBadge")}
                  </Badge>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

          {/* Summary stats */}
          <div className="flex gap-3 mt-4">
            <div
              className="flex-1 rounded-xl px-3 py-2 text-center"
              style={{ backgroundColor: `${person.color}15` }}
            >
              <p className="text-lg font-semibold" style={{ color: person.color }}>{events.length}</p>
              <p className="text-[11px] text-muted-foreground">{t("statEvents")}</p>
            </div>
            <div
              className="flex-1 rounded-xl px-3 py-2 text-center"
              style={{ backgroundColor: `${person.color}15` }}
            >
              <p className="text-lg font-semibold" style={{ color: person.color }}>{todos.length}</p>
              <p className="text-[11px] text-muted-foreground">{t("statTodos")}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-6 pb-6 pt-2">
          {/* Todos */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-2">
              <CheckSquare className="size-3.5" />
              {t("openTodosHeading")}
            </h3>
            {todos.length === 0 ? (
              <p className="text-sm text-muted-foreground/60 italic">{t("todosEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {todos.slice(0, 5).map((todo) => (
                  <li key={todo.id} className="text-sm flex items-center gap-2.5 py-0.5">
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: person.color }}
                    />
                    <span className="truncate">{todo.title}</span>
                  </li>
                ))}
                {todos.length > 5 && (
                  <li className="text-xs text-muted-foreground pl-[18px]">
                    {t("moreCount", { count: todos.length - 5 })}
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Events */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-2">
              <Calendar className="size-3.5" />
              {t("upcomingEventsHeading")}
            </h3>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground/60 italic">{t("eventsEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {events.slice(0, 5).map((event) => (
                  <li key={event.id} className="text-sm flex items-center gap-2.5 py-0.5">
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: person.color }}
                    />
                    <span className="truncate flex-1">{event.title}</span>
                    {event.start_at && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {format(new Date(event.start_at), "d. MMM", { locale: dateLocale })}
                      </span>
                    )}
                  </li>
                ))}
                {events.length > 5 && (
                  <li className="text-xs text-muted-foreground pl-[18px]">
                    {t("moreCount", { count: events.length - 5 })}
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
