import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { renderTurkish } from "../test-utils";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

function stubNotes(initial = [{ id: "note-1", content: "Quest 02 purchased Beat Saber", revision: 1, createdAt: "2026-10-23T08:00:00Z", updatedAt: "2026-10-23T08:00:00Z" }]) {
  let notes = initial;
  let failure: number | null = null;
  let hold: Promise<void> | null = null;
  let loseResponse = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (!url.startsWith("/api/notes")) {
      return json(url === "/api/devices" ? { devices: [], serverTime: new Date().toISOString() }
        : url === "/api/games" ? { games: [] } : { entries: 0, fetchedAt: null });
    }
    if (hold && init?.method === "POST") await hold;
    if (failure) return json({ error: failure === 409 ? "note_conflict" : "failed" }, failure);
    if (!init?.method) return json({ notes });
    const body = JSON.parse(String(init.body));
    if (init.method === "POST") {
      const existing = notes.find((note) => note.id === body.requestId);
      if (existing) return json({ note: existing });
      const note = { id: body.requestId ?? "new-note", content: body.content.trim(), revision: 1, createdAt: "2026-10-23T09:00:00Z", updatedAt: "2026-10-23T09:00:00Z" };
      notes = [note, ...notes];
      if (loseResponse) { loseResponse = false; throw new TypeError("Connection lost after commit"); }
      return json({ note }, 201);
    }
    const id = url.split("/").pop();
    if (init.method === "PUT") {
      const note = { ...notes.find((n) => n.id === id)!, content: body.content.trim(), revision: body.revision + 1 };
      notes = notes.map((n) => n.id === id ? note : n);
      return json({ note });
    }
    notes = notes.filter((n) => n.id !== id);
    return json({ deleted: id });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", class { close() {} });
  return { fetchMock, fail: (status: number | null) => { failure = status; }, holdSave: (pending: Promise<void>) => { hold = pending; }, removeAll: () => { notes = []; }, loseNextResponse: () => { loseResponse = true; } };
}

async function openPanel() {
  fireEvent.click(screen.getByRole("link", { name: "Notes" }));
  const panel = await screen.findByRole("region", { name: "Notes" });
  await within(panel).findByText("Quest 02 purchased Beat Saber");
  return within(panel);
}

describe("persistent admin notes", () => {
  it("opens Notes as a separate page from the top navigation and follows history changes", async () => {
    stubNotes();
    render(<App />);
    const navigation = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(navigation).getByRole("link", { name: "Headsets" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument();
    await openPanel();
    expect(within(navigation).getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe("#/notes");
    expect(screen.queryByRole("region", { name: "Headsets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Notes" })).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, "", "/#/");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("region", { name: "Headsets" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Notes" })).not.toBeInTheDocument();
  });

  it("opens a direct Notes URL and preserves an edit when visiting Headsets", async () => {
    window.history.replaceState(null, "", "/#/notes");
    stubNotes();
    render(<App />);
    const panel = within(await screen.findByRole("region", { name: "Notes" }));
    await panel.findByText("Quest 02 purchased Beat Saber");
    fireEvent.click(panel.getByRole("button", { name: "Edit" }));
    fireEvent.change(panel.getByLabelText("Edit note"), { target: { value: "Unsaved edit across pages" } });
    fireEvent.click(screen.getByRole("link", { name: "Headsets" }));
    await screen.findByRole("region", { name: "Headsets" });
    fireEvent.click(screen.getByRole("link", { name: "Notes" }));
    await screen.findByRole("region", { name: "Notes" });
    expect(screen.getByLabelText("Edit note")).toHaveValue("Unsaved edit across pages");
  });

  it("adds and edits a note, filters the list, and deletes only after confirmation", async () => {
    stubNotes();
    render(<App />);
    const panel = await openPanel();
    fireEvent.change(panel.getByLabelText("Note"), { target: { value: "Quest 01 has Breachers\nNew headset strap" } });
    fireEvent.click(panel.getByRole("button", { name: "Add note" }));
    const added = await panel.findByText(/Quest 01 has Breachers New headset strap/, { selector: "p" });
    expect(added.textContent).toBe("Quest 01 has Breachers\nNew headset strap");
    expect(panel.getByLabelText("Note")).toHaveValue("");
    const newCard = panel.getByText(/Quest 01 has Breachers/).closest("article")!;
    fireEvent.click(within(newCard).getByRole("button", { name: "Edit" }));
    fireEvent.change(panel.getByLabelText("Edit note"), { target: { value: "Quest 01 purchased Walkabout" } });
    fireEvent.click(panel.getByRole("button", { name: "Save changes" }));
    await panel.findByText("Quest 01 purchased Walkabout");
    fireEvent.change(panel.getByLabelText("Search notes"), { target: { value: "walkabout" } });
    expect(panel.queryByText("Quest 02 purchased Beat Saber")).not.toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Delete" }));
    expect(panel.getByText("Quest 01 purchased Walkabout")).toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Keep note" }));
    expect(panel.getByText("Quest 01 purchased Walkabout")).toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Delete" }));
    fireEvent.click(panel.getByRole("button", { name: "Delete note" }));
    await waitFor(() => expect(panel.queryByText("Quest 01 purchased Walkabout")).not.toBeInTheDocument());
  });

  it("retains an unsaved draft across failed saves, refreshes, and page navigation", async () => {
    const server = stubNotes();
    render(<App />);
    let panel = await openPanel();
    fireEvent.change(panel.getByLabelText("Note"), { target: { value: "Do not lose this purchase" } });
    server.fail(500);
    fireEvent.click(panel.getByRole("button", { name: "Add note" }));
    await panel.findByRole("alert");
    expect(panel.getByLabelText("Note")).toHaveValue("Do not lose this purchase");
    server.fail(null);
    fireEvent.click(panel.getByRole("button", { name: "Refresh notes" }));
    await waitFor(() => expect(panel.getByRole("button", { name: "Refresh notes" })).toBeEnabled());
    fireEvent.click(screen.getByRole("link", { name: "Headsets" }));
    await screen.findByRole("region", { name: "Headsets" });
    panel = await openPanel();
    expect(panel.getByLabelText("Note")).toHaveValue("Do not lose this purchase");
  });

  it("retains edits when another browser changed the note", async () => {
    const server = stubNotes();
    render(<App />);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Edit" }));
    fireEvent.change(panel.getByLabelText("Edit note"), { target: { value: "My unsaved correction" } });
    server.fail(409);
    fireEvent.click(panel.getByRole("button", { name: "Save changes" }));
    expect(await panel.findByRole("alert")).toHaveTextContent(/changed elsewhere/i);
    expect(panel.getByLabelText("Edit note")).toHaveValue("My unsaved correction");
  });

  it("keeps the editor accessible after refresh if another browser deleted the note", async () => {
    const server = stubNotes();
    render(<App />);
    const panel = await openPanel();
    fireEvent.click(panel.getByRole("button", { name: "Edit" }));
    fireEvent.change(panel.getByLabelText("Edit note"), { target: { value: "Keep this draft even if the saved note disappears" } });
    server.removeAll();
    fireEvent.click(panel.getByRole("button", { name: "Refresh notes" }));
    await waitFor(() => expect(panel.getByRole("button", { name: "Refresh notes" })).toBeEnabled());
    expect(panel.getByLabelText("Edit note")).toHaveValue("Keep this draft even if the saved note disappears");
  });

  it("disables duplicate saves while the request is pending", async () => {
    const server = stubNotes();
    let finish!: () => void;
    server.holdSave(new Promise<void>((resolve) => { finish = resolve; }));
    render(<App />);
    const panel = await openPanel();
    fireEvent.change(panel.getByLabelText("Note"), { target: { value: "Single purchase record" } });
    fireEvent.click(panel.getByRole("button", { name: "Add note" }));
    expect(panel.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(panel.getByLabelText("Note")).toBeDisabled();
    finish();
    await panel.findByText("Single purchase record");
    expect(panel.getAllByRole("article")).toHaveLength(2);
  });

  it("retains compose and edit drafts through reauthentication", async () => {
    const server = stubNotes();
    render(<App />);
    const panel = await openPanel();
    fireEvent.change(panel.getByLabelText("Note"), { target: { value: "Unsaved purchase" } });
    fireEvent.click(panel.getByRole("button", { name: "Edit" }));
    fireEvent.change(panel.getByLabelText("Edit note"), { target: { value: "Unsaved correction" } });
    server.fail(401);
    fireEvent.click(panel.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "Enter the admin key" });
    fireEvent.change(screen.getByLabelText("Admin key"), { target: { value: "valid-test-key" } });
    server.fail(null);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    fireEvent.click(await screen.findByRole("link", { name: "Notes" }));
    expect(await screen.findByLabelText("Edit note")).toHaveValue("Unsaved correction");
    expect(screen.getByLabelText("Note")).toHaveValue("Unsaved purchase");
  });

  it("retries a lost save response without duplicating the saved purchase", async () => {
    const server = stubNotes();
    render(<App />);
    const panel = await openPanel();
    fireEvent.change(panel.getByLabelText("Note"), { target: { value: "One purchase only" } });
    server.loseNextResponse();
    fireEvent.click(panel.getByRole("button", { name: "Add note" }));
    await panel.findByRole("alert");
    expect(panel.getByLabelText("Note")).toHaveValue("One purchase only");
    fireEvent.click(panel.getByRole("button", { name: "Add note" }));
    await panel.findByText("One purchase only", { selector: "p" });
    fireEvent.click(panel.getByRole("button", { name: "Refresh notes" }));
    await waitFor(() => expect(panel.getByRole("button", { name: "Refresh notes" })).toBeEnabled());
    expect(panel.getAllByText("One purchase only", { selector: "p" })).toHaveLength(1);
    expect(panel.getAllByRole("article")).toHaveLength(2);
  });

  it("offers retry on load failure and redirects expired credentials to the key prompt", async () => {
    const server = stubNotes();
    server.fail(500);
    render(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Notes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/load/i);
    server.fail(401);
    fireEvent.click(screen.getByRole("button", { name: "Refresh notes" }));
    await screen.findByRole("heading", { name: "Enter the admin key" });
  });

  it("uses Turkish labels and renders user content as literal text", async () => {
    stubNotes([{ id: "note-1", content: "<img src=x onerror=alert(1)>\nQuest 02 gözlük", revision: 1, createdAt: "2026-10-23T08:00:00Z", updatedAt: "2026-10-23T08:00:00Z" }]);
    renderTurkish(<App />);
    fireEvent.click(screen.getByRole("link", { name: "Notlar" }));
    const panel = within(await screen.findByRole("region", { name: "Notlar" }));
    expect(screen.getByRole("navigation", { name: "Ana gezinme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gözlükler" })).toBeInTheDocument();
    await panel.findByText(/<img src=x onerror=alert\(1\)>/);
    expect(panel.queryByRole("img")).not.toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Not ekle" })).toBeDisabled();
    expect(panel.getByLabelText("Not")).toBeInTheDocument();
  });
});
