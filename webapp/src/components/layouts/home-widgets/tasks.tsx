"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CheckSquare } from "lucide-react";
import { ChecklistItem } from "@/components/checklist-item";
import { PersonAvatar } from "@/components/person-avatar";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { openWidgetTasks, useTaskTick } from "@/components/widgets/tasks-widget";
import { isOverdue, type TaskSection } from "@/lib/tasks-widget-groups";
import { todayPerson } from "@/lib/todo-turns";
import { toLocalDateKey } from "@/lib/local-date";
import type { Todo } from "@/types/database";
import { CountBadge, HomeEmptyLine, HomeList, HomeListFrame, HomeRowGap, TARGET_H } from "./list-shared";
import type { HomeWidgetProps } from "./shared";

interface Entry {
  todo: Todo;
  section: TaskSection;
  /** The first entry of its section carries the section's label. */
  first: boolean;
}

const keyOf = (e: Entry) => e.todo.id;

/**
 * The open tasks, today's first, as many as fit, each ticked off in one tap
 * with the Home card's own mutation (and its "Who did it?" for a task worth
 * points, which opens over the layout). "+n" and the title open /todos.
 */
export function TasksHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("tasksWidget");
  const { todos, people, today } = useHomeDataContext();
  const todayStr = toLocalDateKey(new Date(today));
  const { toggle, picker } = useTaskTick(people, todayStr);

  const entries = useMemo<Entry[]>(() => {
    let last = "";
    return openWidgetTasks(todos, todayStr).map(({ section, todo }) => {
      const first = section !== last;
      last = section;
      return { todo, section, first };
    });
  }, [todos, todayStr]);

  const renderItem = ({ todo, section, first }: Entry) => {
    const person = people?.find((p) => p.id === todayPerson(todo, todayStr));
    const overdue = isOverdue(todo, todayStr);
    return (
      <HomeRowGap>
        {first && (
          <div className="mb-[0.2em] flex items-center gap-[0.5em]">
            <span className="text-[0.65em] font-semibold uppercase tracking-wide text-muted-foreground">
              {section === "today" ? t("today") : t("upcoming")}
            </span>
            <div className="h-px flex-1 bg-border/40" />
          </div>
        )}
        <ChecklistItem
          checked={false}
          onCheckedChange={() => toggle(todo)}
          compact
          color={person?.color}
          className={`${TARGET_H} gap-[0.5em] px-[0.6em] [&_label]:text-[0.9em] [&>span:last-child]:text-[1em]`}
          label={
            <span className="flex min-w-0 flex-col">
              <span className="break-words leading-snug">
                {todo.icon && <span className="mr-[0.35em]" aria-hidden="true">{todo.icon}</span>}
                {todo.title}
                {todo.points > 0 && <span className="ml-[0.5em] text-[0.8em] text-primary">⭐ {todo.points}</span>}
              </span>
              {overdue && <span className="text-[0.75em] text-destructive">{t("overdue")}</span>}
            </span>
          }
          meta={person ? <PersonAvatar name={person.name} color={person.color} avatarUrl={person.avatar_url} size="1.3em" /> : undefined}
        />
      </HomeRowGap>
    );
  };

  return (
    <>
      <HomeListFrame
        testId="home-widget-tasks"
        icon={CheckSquare}
        title={t("title")}
        href="/todos"
        badge={<CountBadge count={entries.length} />}
        editing={editing}
      >
        <HomeList items={entries} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("emptyState")} />} href="/todos" />
      </HomeListFrame>
      {picker}
    </>
  );
}
