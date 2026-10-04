import type { Command, Experiment, Frame, Scene, WorldState } from '../types';

export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === 'string'
        ? data.detail
        : 'The request could not be completed. Check the experiment format and values.',
    );
  }
  return response.json() as Promise<T>;
}
export const api = {
  create: (seed: number, scene: Scene) =>
    request<{ id: string; state: WorldState }>('/sessions', { seed, scene }),
  state: (id: string) => request<WorldState>(`/sessions/${id}`),
  scene: (id: string, seed: number, scene: Scene) =>
    request<WorldState>(`/sessions/${id}/scene`, { seed, scene }),
  command: (id: string, cmd: Command) => request<WorldState>(`/sessions/${id}/commands`, cmd),
  history: (id: string) => request<{ frames: Frame[] }>(`/sessions/${id}/history`),
  export: (id: string) => request<Experiment>(`/sessions/${id}/export`),
  restore: (id: string, value: unknown) => request<WorldState>(`/sessions/${id}/restore`, value),
};
export function openStream(id: string) {
  return new WebSocket(
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${id}`,
  );
}
