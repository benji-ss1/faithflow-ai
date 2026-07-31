# PresentFlow — Icon System

## Library

- **lucide-react** — declared `^0.468.0` in `package.json`, **installed version 0.468.0** (verified from `node_modules/lucide-react/package.json`).
- Style baseline for lucide 0.468: 24×24 viewBox, 2px stroke, round caps/joins, no fill.
- 113 files in `src/` import from `lucide-react`; **124 unique icons** used.

## Unique icons with usage counts (import occurrences across files)

X (24), ChevronRight (19), Sparkles (16), BookOpen (14), Plus (14), Check (12), Trash2 (12), Monitor (10), Loader2 (10), ChevronDown (10), Music (10), Upload (9), Play (8), Image (8), CheckCircle2 (7), Sun (7), Lock (7), ChevronLeft (7), ExternalLink (7), AlertCircle (7), Type (7), Eye (7), Radio (6), AlertTriangle (6), Search (6), Pencil (6), Send (6), Palette (5), FileText (5), Maximize2 (5), Mic (5), Square (5), RefreshCw (4), Timer (4), Zap (4), Layers (4), List (4), Download (3), Stethoscope (3), Info (3), XCircle (3), Presentation (3), Volume2 (3), Settings (3), MessageSquare (3), RefreshCcw (3), HelpCircle (3), Grid3x3 (3), Wand2 (3), ArrowLeft (2), MonitorPlay (2), Mail (2), Moon (2), Copy (2), GripVertical (2), Star (2), PlayCircle (2), ShieldCheck (2), Bot (2), Wifi (2), WifiOff (2), Circle (2), MicOff (2), ArrowRight (2), Archive (2), EyeOff (2), Activity (2), Bookmark (2), Save (2), ListOrdered (2), Pause (2), SkipForward (2), LayoutGrid (2), Music4 (1), FolderOpen (1), ImageIcon (1), FileSpreadsheet (1), FileCode2 (1), Boxes (1), MoreVertical (1), UserPlus (1), MailCheck (1), MailWarning (1), Users2 (1), Book (1), LoaderCircle (1), ShieldAlert (1), FileMusic (1), FileStack (1), Edit3 (1), Terminal (1), Globe (1), PanelRightClose (1), PanelRightOpen (1), FlaskConical (1), Link2 (1), Paperclip (1), Eraser (1), MoreHorizontal (1), Video (1), Languages (1), BarChart3 (1), KeyRound (1), Shield (1), Copyright (1), Megaphone (1), Wrench (1), SkipBack (1), CalendarPlus (1), Ear (1), PartyPopper (1), Quote (1), ChevronUp (1), ListMusic (1), History (1), Filter (1), RotateCcw (1), MonitorOff (1), ScreenShare (1), BookOpenText (1), FolderInput (1), Library (1), Rocket (1), Building2 (1)

Most brand-characteristic in-product icons: **Sparkles** (AI features), **BookOpen** (Bible), **Music** (songs), **Monitor/MonitorPlay** (projector outputs), **Radio/Mic** (live listening), **Play** (echoes the logo mark).

## Custom SVGs

- **No standalone .svg files exist anywhere in the repo.**
- One notable inline SVG: the animated **"flow mesh"** on auth screens (`src/components/auth/AuthShell.tsx` ~line 123-158) — flowing wave paths with an animated repeating linearGradient (`#ffb861 → #ff6a1f → #a874d6`), screen-blended for a glow. This is the closest thing to a proprietary brand graphic in code and is worth recreating as a marketing asset.
- Small decorative inline SVGs/CSS art elsewhere (waveform bars `.ff-wave-bar` are pure CSS divs, not SVG).
