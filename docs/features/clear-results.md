# Clear results

After a run, every node on the canvas shows what it produced. When you want to
change the workflow — a different prompt, another image, a new model — those
old results sit beside your edits and it is hard to tell what is fresh.

**Clear results** takes the canvas back to how it looked before anything ran,
in one click. It is the eraser button on the canvas tool bar, right above
**Undo**.

## What it removes

Everything a *run* left on the canvas:

- generated images, videos, audio, text and lists, including each node's
  history of earlier takes
- "completed" and "failed" marks, error messages, progress
- the cells of a List column that is **connected** to another node (those cells
  are filled by runs; columns you typed yourself are not touched)

## What it never touches

Everything *you* put on the canvas:

- prompts, settings, connections, labels and sticky notes
- files you uploaded, and a Video URL node's downloaded video
- Character, Object, Creature, Location, Face and Scene cards — their images
  and variations belong to the library entity, not to a run
- a generated **script** — you rewrite it scene by scene, so it is treated as
  your document (run the node again if you want a new one)
- a trained character model (LoRA)
- composition and 3D-scene plans, which you can edit by hand after a run
- nodes that belong to a Film Director pipeline

One thing to know: if you edited a generated **text** by hand (a transcript,
lyrics, an AI answer), the edit lives inside that result and is cleared with
it. Undo brings it back while the editor is open.

Nothing is deleted from your account. Generated files stay in **My Library**
and the **Media Library**, and past runs stay in the **Executions** tab. Clear
results only cleans the canvas.

## Getting it back

The clear is a single step in the editor's history, so any of these brings
every result back exactly as it was:

- the **Undo** button on the confirmation message that appears after clearing
- the **Undo** button on the tool bar
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> (<kbd>⌘</kbd>+<kbd>Z</kbd> on a Mac)

Undo history lasts as long as the editor stays open. After you reload the page
or leave the workflow, the clear is permanent for the canvas (the files are
still in your library).

## Good to know

- The button is dimmed when there is nothing to clear.
- It does nothing while a run is in progress — wait for the run to finish, or
  stop it, and clear afterwards.
- A cleared canvas stays cleared when you come back to it. If you start a new
  run and close the editor before it finishes, that run's results still appear
  the next time you open the workflow, as they always do.
