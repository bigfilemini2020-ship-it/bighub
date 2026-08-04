# AI Education Room MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. This local run will execute inline.

**Goal:** Build a browser-openable MVP for AI education room workflows: posts, reactions, comments, contest submissions, resources, questions, and progress.

**Architecture:** Keep domain behavior in `app-state.js` so it can be tested with Node and reused by the browser UI. Keep `app.js` focused on rendering, events, and `localStorage` persistence. Use no backend and no package install.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node built-in test/assert runner.

## Global Constraints

- No backend.
- No dependency install.
- Browser can open `index.html` directly.
- Persist demo data with `localStorage`.
- Videos/files are stored as external links only.
- Reactions/comments/submissions auto-complete the relevant post for that user.

---

## Task 1: Domain State Logic

**Files:**
- Create: `app-state.test.js`
- Create: `app-state.js`

**Interfaces:**
- Produces `createInitialState(now)`, `addPost(state, input, now)`, `addReaction(state, input, now)`, `addComment(state, input, now)`, `addSubmission(state, input, now)`, `addResource(state, input, now)`, `addQuestion(state, input, now)`, `addAnswer(state, input, now)`, `toggleQuestionStatus(state, questionId)`, `getPostCompletion(state, postId)`.

- [x] Write failing tests for default state, reaction auto-completion, comment auto-completion, submission auto-completion, resource search data, and question resolution.
- [ ] Implement minimal immutable state helpers.
- [ ] Run tests.

## Task 2: Browser UI

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `app.js`

**Interfaces:**
- Consumes global `EducationState` from `app-state.js`.
- Persists state under `ai-education-room-state-v1`.

- [ ] Build app shell with nav tabs: Feed, Resources, Questions, Progress.
- [ ] Add current user selector.
- [ ] Add post form for notice, quest, contest.
- [ ] Render feed cards with link embeds, stickers, comments, contest submissions.
- [ ] Render resources with search.
- [ ] Render questions with answers and resolved toggle.
- [ ] Render progress by member and by post.

## Task 3: Verification

**Files:**
- Use all created files.

- [ ] Run `node --test app-state.test.js`.
- [ ] Run `node --check app-state.js`.
- [ ] Run `node --check app.js`.
- [ ] Confirm `index.html` references expected assets.
