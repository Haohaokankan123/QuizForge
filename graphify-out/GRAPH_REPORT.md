# Graph Report - .  (2026-06-07)

## Corpus Check
- Corpus is ~43,575 words - fits in a single context window. You may not need a graph.

## Summary
- 279 nodes · 570 edges · 12 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Input & Timed Quiz|Input & Timed Quiz]]
- [[_COMMUNITY_Quiz Player & Grading|Quiz Player & Grading]]
- [[_COMMUNITY_Dashboard & History|Dashboard & History]]
- [[_COMMUNITY_Generate Page & API|Generate Page & API]]
- [[_COMMUNITY_Navigation & Auth Guard|Navigation & Auth Guard]]
- [[_COMMUNITY_Landing & Flashcards|Landing & Flashcards]]
- [[_COMMUNITY_AI Quiz Engine (Groq)|AI Quiz Engine (Groq)]]
- [[_COMMUNITY_Share Links|Share Links]]
- [[_COMMUNITY_YouTube Transcript|YouTube Transcript]]
- [[_COMMUNITY_File Extraction|File Extraction]]
- [[_COMMUNITY_App Layout & Theme|App Layout & Theme]]

## God Nodes (most connected - your core abstractions)
1. `Quiz` - 27 edges
2. `cn()` - 26 edges
3. `UserAnswer` - 15 edges
4. `Card` - 13 edges
5. `Button` - 11 edges
6. `Badge()` - 10 edges
7. `collectQuestions()` - 8 edges
8. `HistoryRow()` - 7 edges
9. `computeStats()` - 7 edges
10. `generateQuiz()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `AccountControl()` --calls--> `cn()`  [EXTRACTED]
  src/components/AppNav.tsx → src/lib/cn.ts
- `FlashcardDeckProps` --references--> `Quiz`  [EXTRACTED]
  src/components/FlashcardDeck.tsx → src/lib/types.ts
- `Flashcard()` --calls--> `cn()`  [EXTRACTED]
  src/components/FlashcardDeck.tsx → src/lib/cn.ts
- `FaceShell()` --calls--> `cn()`  [EXTRACTED]
  src/components/FlashcardDeck.tsx → src/lib/cn.ts
- `QuizRow` --references--> `Quiz`  [EXTRACTED]
  src/lib/quizzes.ts → src/lib/types.ts

## Import Cycles
- None detected.

## Communities (12 total, 0 thin omitted)

### Community 0 - "Input & Timed Quiz"
Cohesion: 0.07
Nodes (42): FileResult, InputPicker(), InputPickerProps, SourceType, TabId, TABS, TranscriptResult, YoutubeResponse (+34 more)

### Community 1 - "Quiz Player & Grading"
Cohesion: 0.07
Nodes (22): StoredResult, gradeAnswer(), normalize(), QUESTION_TYPE_LABEL, QuestionInputProps, QuizPlayerProps, tokenize(), TimedQuizProps (+14 more)

### Community 2 - "Dashboard & History"
Cohesion: 0.09
Nodes (33): capitalize(), DashboardPage(), difficultyVariant(), EASE, formatDateTime(), formatShortDate(), formatWeekday(), HistoryRow() (+25 more)

### Community 3 - "Generate Page & API"
Cohesion: 0.08
Nodes (18): COUNT_PRESETS, DIFFICULTY_OPTIONS, LOADING_PHASES, QUESTION_TYPE_OPTIONS, POST(), readJsonBody(), VALID_DIFFICULTIES, VALID_SOURCE_TYPES (+10 more)

### Community 4 - "Navigation & Auth Guard"
Cohesion: 0.10
Nodes (8): AccountControl(), AccountState, NAV_ITEMS, NavItem, AuthState, Mode, MODE_OPTIONS, createClient()

### Community 5 - "Landing & Flashcards"
Cohesion: 0.11
Nodes (12): EASE, FEATURES, riseItem, staggerParent, STEPS, EASE, FaceShell(), Flashcard() (+4 more)

### Community 6 - "AI Quiz Engine (Groq)"
Cohesion: 0.22
Nodes (18): buildPrompt(), callGroq(), collectQuestions(), conceptKey(), difficultyExamples(), difficultyGuide(), generateQuiz(), generateQuizFromChunks() (+10 more)

### Community 7 - "Share Links"
Cohesion: 0.22
Nodes (9): base64ToUtf8(), buildShareUrl(), decodeQuizFromParam(), encodeQuizToParam(), fromUrlSafe(), toUrlSafe(), utf8ToBase64(), ShareContent() (+1 more)

### Community 8 - "YouTube Transcript"
Cohesion: 0.30
Nodes (11): CaptionTrack, decodeEntities(), errorResponse(), extractVideoId(), fetchCaptionText(), fetchPlayerResponse(), fetchTracksFromWatchPage(), fetchTranscript() (+3 more)

### Community 9 - "File Extraction"
Cohesion: 0.43
Nodes (7): detectSourceType(), extractFromDocx(), extractFromPdf(), extractFromTxt(), extractText(), FileSourceType, normalizeAndCap()

### Community 10 - "App Layout & Theme"
Cohesion: 0.29
Nodes (3): jakarta, metadata, viewport

## Knowledge Gaps
- **55 isolated node(s):** `VALID_TYPES`, `VALID_DIFFICULTIES`, `VALID_SOURCE_TYPES`, `CaptionTrack`, `EASE` (+50 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Quiz` connect `Quiz Player & Grading` to `Input & Timed Quiz`, `Dashboard & History`, `Generate Page & API`, `Navigation & Auth Guard`, `Landing & Flashcards`, `AI Quiz Engine (Groq)`, `Share Links`?**
  _High betweenness centrality (0.142) - this node is a cross-community bridge._
- **Why does `cn()` connect `Input & Timed Quiz` to `Quiz Player & Grading`, `Dashboard & History`, `Navigation & Auth Guard`, `Landing & Flashcards`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `Card` connect `Input & Timed Quiz` to `Quiz Player & Grading`, `Dashboard & History`, `Generate Page & API`, `Navigation & Auth Guard`, `Landing & Flashcards`, `Share Links`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `VALID_TYPES`, `VALID_DIFFICULTIES`, `VALID_SOURCE_TYPES` to the rest of the system?**
  _55 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Input & Timed Quiz` be split into smaller, more focused modules?**
  _Cohesion score 0.07337526205450734 - nodes in this community are weakly interconnected._
- **Should `Quiz Player & Grading` be split into smaller, more focused modules?**
  _Cohesion score 0.07419712070874862 - nodes in this community are weakly interconnected._
- **Should `Dashboard & History` be split into smaller, more focused modules?**
  _Cohesion score 0.09059233449477352 - nodes in this community are weakly interconnected._