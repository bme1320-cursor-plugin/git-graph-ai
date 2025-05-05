# TODO - Git IntelliDiff Enhancement

This document outlines the tasks required to enhance the Git Graph extension with AI-powered diff analysis and UI improvements, as described in `项目书.md`.

## Phase 1: Basic AI Integration Setup

-   [ ] **Backend (Python AI Service):**
    -   [ ] Create a new directory `ai_service` at the project root.
    -   [ ] Set up a basic Python HTTP server (e.g., using Flask or FastAPI) within `ai_service/server.py`.
    -   [ ] Define a simple API endpoint (e.g., `/analyze_diff`) that accepts diff data (e.g., two text snippets) and returns placeholder AI analysis (e.g., a dummy summary string).
    -   [ ] Create `ai_service/requirements.txt` listing Python dependencies (e.g., `flask`).
    -   [ ] Add instructions to `README.md` on how to manually start the Python server for development.
-   [ ] **Backend (TypeScript Extension):**
    -   [ ] Create a new service `src/aiService.ts` (or modify `src/dataSource.ts`) to handle communication with the Python AI server via HTTP requests.
    -   [ ] Modify `src/dataSource.ts` (`getCommitDetails`, `getCommitComparison` or similar) to call the AI service when fetching diff information for text files.
    -   [ ] Update relevant data types (e.g., `GitCommitDetails`, `GitCommitComparisonData` in `src/types.ts`) to include an optional field for AI analysis results (e.g., `aiAnalysis: { summary: string } | null`).
    -   [ ] Modify `src/gitGraphView.ts` to pass the fetched AI analysis data to the frontend Webview via `postMessage`.
-   [ ] **Frontend (Webview):**
    -   [ ] Update frontend type definitions (`web/global.d.ts`) to match the new data structure including `aiAnalysis`.
    *   [ ] Modify `web/main.ts` message listener to receive `aiAnalysis` data.
    *   [ ] Update the commit details/comparison rendering logic in `web/main.ts` to display the placeholder AI summary in a dedicated section.
    *   [ ] Add basic styling for the AI analysis section in `web/styles/main.css` or a relevant CSS file.

## Phase 2: UI/UX Enhancements

-   [ ] Review the existing UI (Commit List, Commit Details View, Graph Styling, Buttons, Dropdowns) in the Webview (`web/`).
-   [ ] Identify specific areas for UI improvement based on Apple's design principles (simplicity, clarity, whitespace, typography).
-   [ ] Implement UI changes by modifying HTML generation in `web/main.ts` (and potentially other `web/*.ts` files) and adjusting CSS in `web/styles/`.
    -   [ ] Example: Refine commit details view layout.
    -   [ ] Example: Update button styles.
    -   [ ] Example: Improve graph line/node appearance.
-   [ ] (Optional) If icons are needed for new UI elements, design simple, clean SVGs.

## Phase 3: Implement Core AI Features

-   [ ] **AI Model/API Selection:** Decide whether to use an external LLM API or a local model (requires discussion based on `项目书.md` priorities and user constraints).
-   [ ] **Backend (Python AI Service):**
    -   [ ] Implement the actual AI logic in `ai_service/server.py` to:
        -   Analyze the diff input.
        -   Generate a concise summary of changes.
        -   (Optional) Identify semantic differences for highlighting.
    -   [ ] Update the API response to return the real analysis.
-   [ ] **Frontend (Webview):**
    -   [ ] Update the display logic in `web/main.ts` to present the real AI summary.
    -   [ ] (Optional) Implement highlighting of semantic differences based on AI output.

## Phase 4: Binary File Diff (Image Focus)

-   [ ] **Backend (TypeScript/Python):**
    -   [ ] Choose an image processing library (e.g., `sharp` in Node.js or `Pillow` in Python). Add to dependencies.
    -   [ ] Modify `src/dataSource.ts` or `ai_service/server.py` to:
        -   Detect image file changes in diffs.
        -   Fetch both versions of the image file content.
        -   Implement image comparison logic (e.g., generating a visual diff image or providing data for frontend comparison).
    -   [ ] Update data types and communication logic to handle image diff results.
-   [ ] **Frontend (Webview):**
    -   [ ] Modify `web/main.ts` to receive and display image diffs (e.g., side-by-side view, overlay slider). Update HTML/CSS accordingly.

## Phase 5: Testing & Refinement

-   [ ] Test AI analysis accuracy and relevance.
-   [ ] Test UI responsiveness and visual appeal across different themes.
-   [ ] Test image diff functionality.
-   [ ] Refactor code for clarity and maintainability.
-   [ ] Add comments and documentation where needed. 