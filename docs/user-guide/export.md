# Export a transcript

Use **Export transcript** to download the selected session as an HTML file.

![Exported Leyline transcript with session metadata and rendered messages](/screenshots/export.png)

*The export places session metadata above a standalone transcript view.*

## Download the export

1. Open a non-empty session.
2. Select **Export transcript** in the workbench header.
3. Open the downloaded `.html` file.

The file name starts with `leyline-` and uses the session title when possible.

## Read export metadata

The export header contains:

- Session title.
- Project name.
- Project path.
- Message count.
- Context token count.
- Modified time.

The token value is the latest available context usage. It is not a total of all tokens used across the session.

## Read export content

The export includes rendered Markdown, assistant thoughts, collapsed tool rows, skill rows, subagent results, and attached images.

Tool rows render their previews when you expand them. Exported runtime event rows are omitted.

Images and transcript data are embedded in the HTML. File, diff, and patch previews load their renderer from `esm.sh` when expanded. Those previews require network access.

## Use the responsive layout

The export changes to a compact layout below 820 pixels. Metadata uses two columns, and message padding decreases.

The HTML also respects the system reduced-motion preference.

## Share an inline export

A server can open the export inline by using the inline disposition URL. When public sharing is configured, Leyline adds canonical, Open Graph, and Twitter metadata.

The share metadata contains the title, project name, message count, page URL, and a configured preview image. The normal header action downloads the file.
