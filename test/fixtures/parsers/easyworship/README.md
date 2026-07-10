# EasyWorship fixtures

**No parseable fixture is shipped.**

EasyWorship 6/7 store their library in Firebird database files
(`SongsDB.db`, `MediaDB.db`, `SchedulesDB.db`). Firebird is not plain
SQLite — it needs a native driver we do not depend on. Fabricating a
`.db` file would produce meaningless bytes that the parser could never
accept, so we don't ship one.

EasyWorship 2009's `.ews` schedule format is likewise undocumented
binary and can't be constructed by hand.

The parser is detection-only. Its tests assert stub behaviour directly
by feeding a fake `SongsDB.db` buffer of arbitrary bytes and verifying
that the result lands in `skipped[]` with a clear reason.
