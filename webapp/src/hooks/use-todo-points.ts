"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useFamilyStore } from "@/stores/family-store";

interface Award {
  person_id: string;
  points: number;
}

export function useTodoPoints() {
  const familyId = useFamilyStore((state) => state.family?.id);
  return useQuery({
    queryKey: ["todo-point-awards", familyId],
    enabled: Boolean(familyId),
    queryFn: async () => {
      if (!familyId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("todo_point_awards")
        .select("person_id,points")
        .eq("family_id", familyId);
      if (error) throw error;
      return (data ?? []) as Award[];
    },
  });
}
