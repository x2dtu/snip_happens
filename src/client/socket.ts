"use client";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) socket = io({ autoConnect: true });
  return socket;
}

/** Per-tab session id, so each tab is its own player and a refresh rejoins your seat. */
export function getToken(): string {
  let t = sessionStorage.getItem("snip-token");
  if (!t) {
    t = crypto.randomUUID();
    sessionStorage.setItem("snip-token", t);
  }
  return t;
}

export function getName(): string {
  return localStorage.getItem("snip-name") ?? "";
}

export function setName(name: string) {
  localStorage.setItem("snip-name", name);
}

export function emitAck<T = { ok?: boolean; error?: string }>(event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve) => getSocket().emit(event, payload, (res: T) => resolve(res)));
}
