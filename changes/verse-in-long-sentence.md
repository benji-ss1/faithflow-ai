---
headline: "Psalm a 100 verse 5" now works, and verses said inside a longer sentence project again
audience: operator
version: 0.1.527
date: 2026-09-24
highlights:
  - When someone says "Psalm 100 verse 5", the transcript sometimes comes back as "Psalm a 100 verse 5" with an extra word in the middle. That used to be missed completely. It now finds the verse, and so does "Psalm 100 a 5".
  - A verse said in the middle of a longer sentence now goes to the screen. Saying "the bible says in Psalm 100 verse 5 that the Lord is good" would show the verse in the panel but never project it, because a longer sentence scored lower overall even when the verse itself was heard perfectly clearly.
  - Verses are now judged on how clearly the verse words themselves were heard, instead of how clearly the whole sentence was heard.
  - Saying a verse out loud ("John 3 verse 16") now counts the same as the written form ("John 3:16"). The spoken way was being treated as less certain even though it is clearer.
  - Nothing has been made easier to trigger: if any word in the verse itself was heard poorly, it still will not go to the screen on its own.
---
