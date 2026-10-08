Turn Changes summarizes the files an agent changed in each turn. A card in the conversation lists changed files and line counts. Open it to review that turn's diff, browse its file tree, edit a source file in the panel, or undo the whole turn after confirmation. The interface is in Chinese.

The plugin supports Paseo 0.8 through 0.11 on both the app and daemon. Browser desktop and compact layouts have been tested; native Android and iOS have not. Each daemon keeps its own settings and history.

By default, Codex uses a native turn diff when the host exposes one, otherwise it falls back to structured edit records. Other providers use edit records. Native Codex diffs need the optional host integration described in the repository; the plugin does not apply a host patch. The source can be configured per provider in the plugin settings. Shell writes without structured edit records can be missed.

For Codex, the plugin also reads local session logs from the provider's configured `CODEX_HOME` or `~/.codex` to recover file changes omitted from edit records. Undo is refused when records are incomplete, files have changed afterward, paths are outside the working directory or inside `.git`, or an agent is running in an overlapping directory. It does not restore renames, binary files, symlinks, or permission-only changes, and it does not modify Git staging, commits, or branches. Saving in the source editor checks for changes since the file was opened.

Records contain before and after file text. They are stored on the daemon host under the Paseo home's `plugin-data/turn-changes` directory, or `PASEO_TURN_CHANGES_HOME`, using owner-only file permissions. History is not cleaned up automatically and remains after uninstalling. The plugin makes no network requests.
