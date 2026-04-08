# Troubleshooting

This page provides solutions to common issues.

**Q: Why do I still see YAML warnings in the Obsidian Properties panel?**

**A:** BibLib patches the structured `author` field so it can be edited directly in Properties with an inline chip editor. Other nested CSL structures are still constrained by Obsidian's native metadata parser and may need to be edited in Source Mode.

**Q: The Zotero Connector integration is not working.**

**A:** Check the following:
1.  The feature is only available on Obsidian Desktop.
2.  The "Enable Zotero Connector" setting must be on.
3.  The Zotero Desktop application must be completely closed.
4.  Ensure no other application is using the same port (default 23119).
5.  Check that your firewall is not blocking the connection.

**Q: My custom frontmatter template for an array is not creating a proper YAML list.**

**A:** To create a valid YAML list, the template must start with `[` and end with `]`, and items should be properly quoted and separated by commas.

**Q: Attachments are not being found during bulk import.**

**A:**
1.  If importing from Zotero, ensure you selected "Export Files" during the export process.
2.  The `.bib` file and the associated `files` folder must be located inside your Obsidian vault before starting the import.
3.  In the bulk import modal, set "Attachment handling" to `Import attachments to vault`.

**Q: The "Edit Literature Note" command is not available.**

**A:** This command is only available when a literature note is the active file. Ensure the note has the correct literature note tag in its frontmatter.

**Q: How do I edit complex CSL fields like authors?**

**A:** Use the patched `author` field in Obsidian's Properties view for authors. It supports inline chip editing: click a chip to edit, `×` to remove, `+` to add, `Enter` to confirm, `Esc` to cancel, and click away to collapse the active form. For other complex CSL fields, edit the YAML directly in Source Mode. The stored `author` field remains a CSL array of objects:
```yaml
author:
  - family: Smith
    given: Alice
  - family: Jones
    given: Bob
```