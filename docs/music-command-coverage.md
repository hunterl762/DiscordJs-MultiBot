# Music command coverage

The repair intentionally keeps the existing command-facing local music manager API unchanged. Existing play/playlist queueing, stop, skip, pause, resume, queue display, volume, shuffle and loop commands continue to operate against the same player and queue objects. The change is isolated to the installed play-dl implementation and diagnostics.
