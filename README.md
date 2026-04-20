<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ee53b1ec-0db7-4156-9a7d-225f612d736a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. (Optional) Set the `GEMINI_API_KEY` in `.env.local` if you use Gemini features
3. Connect Google Sheet via Apps Script (append-only):
   - See `apps-script/README.md`
   - Put the deployed Web App URL into `.env.local`:

```bash
VITE_GAS_URL="https://script.google.com/macros/s/XXXX/exec"
```

4. Run the app:
   `npm run dev`
