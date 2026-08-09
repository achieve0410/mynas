import { useQuery } from "@tanstack/react-query";

import { api } from "../api";

export const useVolumeHealth = (volumeId: string) => {
  const health = useQuery({
    enabled: volumeId.length > 0,
    queryFn: () => api.getVolumeHealth(volumeId),
    queryKey: ["volume-health", volumeId],
  });

  if (volumeId.length === 0) {
    return { canWrite: false, health, reason: "Enter a mirror volume before writing." };
  }
  if (health.isPending) {
    return { canWrite: false, health, reason: "Checking mirror health before enabling writes." };
  }
  if (health.isError) {
    return { canWrite: false, health, reason: "Mirror health is unavailable. Writes are paused." };
  }
  if (health.data.status === "degraded") {
    const members = health.data.unavailable.join(", ");
    return {
      canWrite: false,
      health,
      reason: `Mirror degraded${members.length > 0 ? `: ${members} unavailable` : ""}. Writes are paused.`,
    };
  }
  return { canWrite: true, health, reason: "Both mirror members are healthy." };
};
