# Moving workflows between accounts and installs

A workflow travels as one JSON file. Export it from the editor, import it
anywhere — another account, another project, or a self-hosted install.

## Import a workflow

**From the home screen.** The **Import JSON** button sits beside "Jump back in".
Pick a file and the workflow is created and opened. It lands in your default
project, "My Recent Flows", which is created for you the first time anything
needs it.

**From the editor.** The toolbar's **Import** menu reads the same files, from a
file or from the clipboard, and offers one extra choice a blank home screen
cannot:

| Choice | What happens |
|---|---|
| Import as New | A new workflow, exactly like the home-screen button |
| Add to Current | The imported nodes are merged onto the canvas you have open, to the right of what is already there |

Both surfaces accept a plain export and the wrapped tutorial format
(`{ meta, workflow }`), so a file from `backend/seeds` imports like any other.

Every import is named after the file with **(Imported)** appended, so a copy
never looks like the original it came from.

## Export a workflow

The editor toolbar's **Export** menu writes the file, in one of two shapes:

| Choice | What is in the file |
|---|---|
| With Assets | The graph plus the characters, objects and locations it references, inlined |
| Template Only | The graph alone, with generated results and other transient content stripped |

Save the workflow first. Export reads the stored version, not the canvas.

## What crosses over, and what does not

**Entities are re-created under you.** A bundle exported *With Assets* carries
its characters, objects and locations. The import creates them in your own
account and re-points the nodes at the new rows, so the chips on the canvas
resolve to entities you own rather than to someone else's ids.

**Reachable media is copied.** Images, video and audio the importing install can
fetch are copied onto its own storage, so the workflow stops depending on the
instance it came from. The success message says how many files were copied.

**Unreachable media is reported, not silently dropped.** Media only the
exporting install can serve — a private self-hosted instance, for example —
stays pointing where it was, and the import warns you and names the nodes. Those
nodes will not run until the file is re-uploaded on this install.

**Storage limits can decline entities.** If your quota has no room, the workflow
still lands and the import says which entities it could not create. Chips bound
to those arrive unresolvable.

## Doing it from code

The same operation over REST, with the file's contents as `workflow_json`:

```http
POST /v1/workflows/import
{ "projectId": "<project uuid>", "workflow_json": { "version": 1, "name": "...", "nodes": [], "edges": [] } }
```

The response carries the new workflow plus an `importReport` describing what
happened to the media: how many files were `rehosted`, which were `unreachable`,
and which were `skipped`. The SDK exposes it as `client.workflows.import(...)` —
see the [SDK Reference](./sdk-reference.md).
