import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketsList } from "./tickets-list.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TicketsList", () => {
  it("renders the tickets returned by /api/tickets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json([
        { id: 1, name: "demo-ticket", gitBranch: "feature/demo-ticket", services: ["api", "web", "postgres"] },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TicketsList />);
    expect(screen.getByRole("status")).toBeInTheDocument();

    expect(await screen.findByRole("rowheader", { name: "demo-ticket" })).toBeInTheDocument();
    expect(screen.getByText("feature/demo-ticket")).toBeInTheDocument();
    expect(screen.getByText("api, web, postgres")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/tickets", expect.anything());
  });

  it("shows the empty state when there are no tickets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));

    render(<TicketsList />);

    expect(await screen.findByText("No tickets found.")).toBeInTheDocument();
  });

  it("shows the error state when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })));

    render(<TicketsList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
  });

  it("shows the error state when the network request rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));

    render(<TicketsList />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
