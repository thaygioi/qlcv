## Apps Script backend (Google Sheet = database, append-only)

### 1) Create the Sheet
- Create a Google Sheet (any name).
- Copy its **Spreadsheet ID** from the URL.

### 2) Create Apps Script
- Go to `Extensions → Apps Script`
- Paste `Code.gs` content from this folder

### 3) Set Script Property
- In Apps Script: `Project Settings → Script Properties`
- Add:
  - `SHEET_ID` = `<your spreadsheet id>`

### 4) Deploy as Web App
- `Deploy → New deployment → Web app`
- **Execute as**: Me
- **Who has access**: Anyone with the link
- Copy the Web App URL (ends with `/exec`)

### 5) Connect frontend
- Put the URL into `.env.local`:

```bash
VITE_GAS_URL="https://script.google.com/macros/s/XXXX/exec"
```

### Notes
- The script appends all updates into an `events` tab, so **history is never deleted**.
- The app reads current state by folding the event log.

