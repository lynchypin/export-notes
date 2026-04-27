# export-notes

A small interactive CLI that exports incident notes from a PagerDuty instance into a multi-sheet Excel workbook.

## What it does

1. Asks for your PagerDuty API key on first run and stores it locally in a gitignored `.env` file.
2. Asks whether you want to group notes by **Service** or **Team**.
3. Lists every service or team your API key can see.
4. Lets you multi-select the entities you care about (Space to toggle, Enter to confirm).
5. Fetches every incident for each selected entity, then every note on every incident.
6. Resolves the user who posted each note.
7. Writes a single `.xlsx` file with one sheet per selected service/team. Each sheet contains:
   - **Timestamp**
   - **Note**
   - **Posted By**
   - **Incident Title**
8. Prints the absolute path to the generated file.

## Requirements

- Node.js 18 or newer (uses native `fetch`).
- A PagerDuty REST API key with read access to incidents, services, teams and users.

## Setup

```bash
git clone https://github.com/lynchypin/export-notes.git
cd export-notes
npm install
```

## Usage

```bash
npm start
```

Or run directly with Node:

```bash
node gather-notes.mjs
```

On first run you will be prompted for your PagerDuty API key. It will be saved to a local `.env` file (gitignored) so you do not have to enter it again.

## Output

A timestamped Excel file is written to the project directory, for example:

```
pagerduty-notes-2026-04-27T20-56-19.xlsx
```

Generated workbooks are gitignored.

## API key

Generate a PagerDuty REST API key at: **PagerDuty -> Integrations -> API Access Keys -> Create New API Key**.

A read-only key is sufficient. The key is only ever sent to `https://api.pagerduty.com` over HTTPS as an `Authorization: Token token=...` header.

## License

[MIT](LICENSE)
