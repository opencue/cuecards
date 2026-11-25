import { useQuery } from "@tanstack/react-query";
import { fetcher } from "./fetcher";
import type { PublicProfile } from "./public-profiles";

export function usePublicProfileRoster() {
  return useQuery({
    queryKey: ["public-profile-roster"],
    queryFn: () => fetcher<PublicProfile[]>("/profile-roster"),
    staleTime: Infinity,
    retry: false,
  });
}
