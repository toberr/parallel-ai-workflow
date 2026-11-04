"use client";

import { useEffect, useState } from "react";
import type { components } from "../lib/api-types.generated.ts";

type Ticket = components["schemas"]["Ticket"];

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; tickets: Ticket[] };

export function TicketsList() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/tickets", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const tickets = (await response.json()) as Ticket[];
        setState({ status: "ready", tickets });
      } catch {
        // An aborted request means the component was unmounted: do not set state.
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") {
    return <p role="status">Loading tickets…</p>;
  }
  if (state.status === "error") {
    return <p role="alert">The tickets could not be loaded.</p>;
  }
  if (state.tickets.length === 0) {
    return <p>No tickets found.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
    <table style={{ borderCollapse: "collapse", textAlign: "left" }}>
      <caption>Tickets</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Branch</th>
          <th scope="col">Services</th>
        </tr>
      </thead>
      <tbody>
        {state.tickets.map((ticket) => (
          <tr key={ticket.id}>
            <th scope="row">{ticket.name}</th>
            <td>{ticket.gitBranch}</td>
            <td>{ticket.services.join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
