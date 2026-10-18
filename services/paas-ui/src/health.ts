export type Health = "up" | "down";

export async function checkHealth(signal?: AbortSignal): Promise<Health> {
  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(4000)])
        : AbortSignal.timeout(4000),
    });
    return response.status === 200 ? "up" : "down";
  } catch {
    return "down";
  }
}
