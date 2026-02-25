import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "./api.ts";

export function useMe() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => auth.me(),
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => auth.logout(),
    onSuccess: () => {
      qc.setQueryData(["auth", "me"], { user: null });
    },
  });
}
