# BibLib for Obsidian

BibLib is an Obsidian plugin for managing bibliographic references. Each reference is stored as a Markdown note with metadata in YAML frontmatter using the [CSL-JSON](https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html) format. There is no database — references are plain text files in your vault, editable with any text editor and compatible with Git.

Looking for a command-line workflow? See [biblib-cli](https://github.com/callumalpass/biblib-cli).

> [!IMPORTANT]
> This repository currently includes personal modifications on top of upstream BibLib for a real-world vault workflow. In particular, the Obsidian Properties view is patched so the structured CSL `author` field can be edited inline as chips instead of falling back to raw YAML.

> [!NOTE]
> For detailed documentation, see the [docs site](https://callumalpass.github.io/obsidian-biblib)

![Screenshot of biblib Obsidian plugin](https://github.com/callumalpass/obsidian-biblib/blob/main/screenshots/create-lit-note.gif?raw=true)

## Overview

References are stored as Markdown files with CSL-JSON metadata in YAML frontmatter. Because they are ordinary Obsidian notes, they can be linked, tagged, searched, and organized like any other note in your vault.

Metadata can be fetched automatically via DOI, ISBN, PubMed ID, arXiv ID, or URL. The Zotero browser connector can send references directly to Obsidian (desktop only). Bibliography files can be exported in CSL-JSON or BibTeX format for use with Pandoc.

## Installation

1. Open Obsidian Settings > Community Plugins
2. Search for "BibLib"
3. Install and enable the plugin

## Basic Usage

### Creating a Reference

1. Open command palette (`Ctrl/Cmd + P`)
2. Run "BibLib: Create Literature Note"
3. Either fill in fields manually or use "Lookup" with a DOI/ISBN/URL
4. Click "Create Note"

### Importing from Browser

1. Enable the Zotero Connector in settings (requires closing Zotero desktop app)
2. Click the Zotero browser extension on any webpage
3. BibLib opens a modal with the reference data pre-filled

### Generating Bibliography Files

Run "BibLib: Build bibliography" to create `bibliography.json` (CSL-JSON) or "BibLib: Export bibliography as BibTeX" to create `bibliography.bib`. These files can be used with Pandoc for citation formatting.

## Data Format

BibLib stores reference metadata in YAML frontmatter using CSL-JSON structure:

```yaml
---
id: smith2023
type: article-journal
title: Example Article Title
author:
  - family: Smith
    given: Alice
  - family: Jones
    given: Bob
container-title: Journal of Examples
issued:
  date-parts:
    - [2023, 6, 15]
DOI: 10.1234/example
tags:
  - literature_note
---
```

> [!NOTE]
> Use the standard CSL `author` field. In this customized build, BibLib patches Obsidian's Properties UI so structured authors can be edited inline there as chips. Other nested CSL fields may still need Source Mode.

## Structured author editing

The `author` property remains a proper CSL array of objects in frontmatter, but in Properties it is rendered with an inline editor:

- click an author chip to edit it
- click `×` to remove an author
- click `+` to add an author
- `Enter` confirms the current inline edit
- `Esc` cancels the current inline edit
- clicking away collapses the inline editor; partially entered values are saved, while empty add-forms are dismissed

This keeps the stored YAML standards-compliant while making day-to-day editing much less awkward.

## Settings

### File Organization
- **Attachment folder**: Where PDFs are stored
- **Literature note location**: Where reference notes are created
- **Filename template**: Pattern for filenames (e.g., `@{{citekey}}`)

### Templates
- **Note content template**: Structure for new notes
- **Custom frontmatter fields**: Additional YAML fields with templated values
- **Citekey template**: Pattern for generating citekeys (e.g., `{{authors_family.0|lowercase}}{{year}}`)

### Zotero Connector (Desktop Only)
- **Port**: Default 23119 (same as Zotero)
- Requires Zotero desktop app to be closed

### Bibliography Export
- **bibliography.json path**: Location for CSL-JSON output
- **bibliography.bib path**: Location for BibTeX output

## Template Syntax

BibLib uses Handlebars-style templates:

- **Variables**: `{{title}}`, `{{year}}`, `{{DOI}}`
- **Nested access**: `{{author.0.family}}`
- **Formatters**: `{{title|lowercase}}`, `{{authors_family.0|abbr3}}`
- **Conditionals**: `{{#DOI}}Has DOI{{/DOI}}`

### Citekey Rules

Generated citekeys follow Pandoc conventions:
- Must start with letter, digit, or underscore
- Can contain alphanumerics and `:.#$%&-+?<>~/`

## License

MIT
