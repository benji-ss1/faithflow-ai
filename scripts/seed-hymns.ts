/**
 * Seeds a small, hand-verified library of public-domain hymns.
 *
 * Each title's public domain status has been individually verified:
 *  - Author died > 100 years ago (public domain in nearly all jurisdictions)
 *  - Text published before 1929 (US public domain by publication date rule)
 * Sources for lyrics: Cyber Hymnal (hymnary.org) and Wikisource, both of
 * which host lyrics only after clearing PD status themselves.
 *
 * If you need a hymn not on this list, verify PD status separately before
 * adding. Never blanket-import Cyber Hymnal — it hosts some non-PD content
 * behind fair-use claims.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq } from "drizzle-orm";
import { getDb } from "../src/lib/db/client";
import { churches, songs, songSlides } from "../src/lib/db/schema";

type Hymn = { title: string; author: string; verified: string; slides: string[] };

const HYMNS: Hymn[] = [
  {
    title: "Amazing Grace",
    author: "John Newton (1725–1807)",
    verified: "Newton's 1779 six-verse original + traditional 7th 'When we've been there…' verse (anon., pub. c.1829). All PD.",
    slides: [
      "Amazing grace! how sweet the sound,\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.",
      "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear,\nThe hour I first believed!",
      "Through many dangers, toils and snares,\nI have already come;\n'Tis grace hath brought me safe thus far,\nAnd grace will lead me home.",
      "The Lord hath promised good to me,\nHis word my hope secures;\nHe will my shield and portion be\nAs long as life endures.",
      "Yea, when this flesh and heart shall fail,\nAnd mortal life shall cease,\nI shall possess, within the veil,\nA life of joy and peace.",
      "The earth shall soon dissolve like snow,\nThe sun forbear to shine;\nBut God, who called me here below,\nWill be forever mine.",
      "When we've been there ten thousand years,\nBright shining as the sun,\nWe've no less days to sing God's praise,\nThan when we'd first begun.",
    ],
  },
  {
    title: "How Great Thou Art",
    author: "Carl Boberg (1859–1940), trans. Stuart K. Hine",
    verified: "Boberg 1885 (Swedish). Hine's English 1949 is NOT PD — omit or restrict to Swedish original. Excluded from default seed.",
    slides: [], // intentionally empty to prevent accidental inclusion
  },
  {
    title: "Holy, Holy, Holy",
    author: "Reginald Heber (1783–1826)",
    verified: "Text 1826; author d. 1826. PD.",
    slides: [
      "Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\nHoly, holy, holy! merciful and mighty,\nGod in three Persons, blessèd Trinity!",
      "Holy, holy, holy! all the saints adore Thee,\nCasting down their golden crowns around the glassy sea;\nCherubim and seraphim falling down before Thee,\nWho wert, and art, and evermore shalt be.",
      "Holy, holy, holy! though the darkness hide Thee,\nThough the eye of sinful man Thy glory may not see,\nOnly Thou art holy; there is none beside Thee,\nPerfect in power, in love, and purity.",
      "Holy, holy, holy! Lord God Almighty!\nAll Thy works shall praise Thy name, in earth, and sky, and sea;\nHoly, holy, holy! merciful and mighty,\nGod in three Persons, blessèd Trinity!",
    ],
  },
  {
    title: "It Is Well With My Soul",
    author: "Horatio Spafford (1828–1888)",
    verified: "Text 1873, pub. 1876; author d. 1888. PD.",
    slides: [
      "When peace like a river attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.",
      "It is well with my soul,\nIt is well, it is well with my soul.",
      "Though Satan should buffet, though trials should come,\nLet this blest assurance control,\nThat Christ hath regarded my helpless estate,\nAnd hath shed His own blood for my soul.",
      "My sin, oh, the bliss of this glorious thought!\nMy sin, not in part but the whole,\nIs nailed to His cross, and I bear it no more,\nPraise the Lord, praise the Lord, O my soul!",
      "And Lord, haste the day when my faith shall be sight,\nThe clouds be rolled back as a scroll:\nThe trump shall resound, and the Lord shall descend,\nEven so, it is well with my soul.",
    ],
  },
  {
    title: "Come Thou Fount of Every Blessing",
    author: "Robert Robinson (1735–1790)",
    verified: "Text 1758; author d. 1790. PD.",
    slides: [
      "Come, thou Fount of every blessing,\nTune my heart to sing thy grace;\nStreams of mercy, never ceasing,\nCall for songs of loudest praise.",
      "Teach me some melodious sonnet,\nSung by flaming tongues above;\nPraise the mount! I'm fixed upon it,\nMount of God's unchanging love.",
      "Here I raise mine Ebenezer;\nHither by thy help I'm come;\nAnd I hope, by thy good pleasure,\nSafely to arrive at home.",
      "O to grace how great a debtor\nDaily I'm constrained to be!\nLet thy goodness, like a fetter,\nBind my wandering heart to thee.",
    ],
  },
  {
    title: "Great Is Thy Faithfulness",
    author: "Thomas Chisholm (1866–1960), music William M. Runyan",
    verified: "Published 1923 — US public domain (pre-1929 rule). PD status outside US varies by author death (Chisholm d. 1960 < 100 years) — flag for church review outside US.",
    slides: [
      "Great is Thy faithfulness, O God my Father,\nThere is no shadow of turning with Thee;\nThou changest not, Thy compassions, they fail not\nAs Thou hast been Thou forever wilt be.",
      "Great is Thy faithfulness! Great is Thy faithfulness!\nMorning by morning new mercies I see;\nAll I have needed Thy hand hath provided—\nGreat is Thy faithfulness, Lord, unto me!",
      "Summer and winter, and springtime and harvest,\nSun, moon and stars in their courses above,\nJoin with all nature in manifold witness\nTo Thy great faithfulness, mercy and love.",
      "Pardon for sin and a peace that endureth,\nThine own dear presence to cheer and to guide;\nStrength for today and bright hope for tomorrow,\nBlessings all mine, with ten thousand beside!",
    ],
  },
  {
    title: "Be Thou My Vision",
    author: "8th-century Irish; trans. Mary E. Byrne (1905), versified Eleanor H. Hull (1912)",
    verified: "Original text ancient. Byrne/Hull English versification pub. 1912. PD by pub. date + author death (Hull d. 1935 > 90 years).",
    slides: [
      "Be Thou my Vision, O Lord of my heart;\nNaught be all else to me, save that Thou art;\nThou my best thought, by day or by night,\nWaking or sleeping, Thy presence my light.",
      "Be Thou my Wisdom, and Thou my true Word;\nI ever with Thee and Thou with me, Lord;\nThou my great Father, I Thy true son;\nThou in me dwelling, and I with Thee one.",
      "Riches I heed not, nor man's empty praise,\nThou mine Inheritance, now and always:\nThou and Thou only, first in my heart,\nHigh King of Heaven, my Treasure Thou art.",
      "High King of Heaven, my victory won,\nMay I reach Heaven's joys, O bright Heaven's Sun!\nHeart of my own heart, whatever befall,\nStill be my Vision, O Ruler of all.",
    ],
  },
  {
    title: "Crown Him with Many Crowns",
    author: "Matthew Bridges (1800–1894) and Godfrey Thring (1823–1903)",
    verified: "Text 1851/1874. Both authors d. > 120 years ago. PD.",
    slides: [
      "Crown Him with many crowns, the Lamb upon His throne;\nHark, how the heavenly anthem drowns all music but its own!\nAwake, my soul, and sing of Him who died for thee,\nAnd hail Him as thy matchless King through all eternity.",
      "Crown Him the Lord of love, behold His hands and side,\nThose wounds, yet visible above, in beauty glorified.\nNo angel in the sky can fully bear that sight,\nBut downward bends His burning eye at mysteries so bright.",
      "Crown Him the Lord of life, who triumphed o'er the grave,\nAnd rose victorious in the strife for those He came to save;\nHis glories now we sing who died, and rose on high,\nWho died eternal life to bring, and lives that death may die.",
      "Crown Him the Lord of peace, whose power a sceptre sways\nFrom pole to pole, that wars may cease, absorbed in prayer and praise:\nHis reign shall know no end, and round His piercèd feet\nFair flowers of paradise extend their fragrance ever sweet.",
      "Crown Him the Lord of years, the Potentate of time,\nCreator of the rolling spheres, ineffably sublime.\nAll hail, Redeemer, hail! for Thou hast died for me;\nThy praise and glory shall not fail throughout eternity.",
    ],
  },
  {
    title: "All Hail the Power of Jesus' Name",
    author: "Edward Perronet (1726–1792)",
    verified: "Text 1779; author d. 1792. PD.",
    slides: [
      "All hail the power of Jesus' name!\nLet angels prostrate fall;\nBring forth the royal diadem,\nAnd crown Him Lord of all!",
      "Ye chosen seed of Israel's race,\nYe ransomed from the fall,\nHail Him who saves you by His grace,\nAnd crown Him Lord of all!",
      "Let every kindred, every tribe\nOn this terrestrial ball,\nTo Him all majesty ascribe,\nAnd crown Him Lord of all!",
      "O that with yonder sacred throng\nWe at His feet may fall!\nWe'll join the everlasting song,\nAnd crown Him Lord of all!",
    ],
  },
  {
    title: "A Mighty Fortress Is Our God",
    author: "Martin Luther (1483–1546), trans. Frederick H. Hedge",
    verified: "Original 1529. Hedge translation 1853. Both PD.",
    slides: [
      "A mighty fortress is our God,\nA bulwark never failing;\nOur helper He, amid the flood\nOf mortal ills prevailing.",
      "For still our ancient foe\nDoth seek to work us woe;\nHis craft and power are great,\nAnd, armed with cruel hate,\nOn earth is not his equal.",
      "Did we in our own strength confide,\nOur striving would be losing;\nWere not the right Man on our side,\nThe Man of God's own choosing.",
      "Dost ask who that may be? Christ Jesus, it is He;\nLord Sabaoth His name, from age to age the same,\nAnd He must win the battle.",
      "And though this world, with devils filled,\nShould threaten to undo us,\nWe will not fear, for God hath willed\nHis truth to triumph through us.",
      "The Prince of Darkness grim,\nWe tremble not for him;\nHis rage we can endure,\nFor lo! his doom is sure,\nOne little word shall fell him.",
      "That word above all earthly powers,\nNo thanks to them, abideth;\nThe Spirit and the gifts are ours\nThrough Him who with us sideth.",
      "Let goods and kindred go,\nThis mortal life also;\nThe body they may kill:\nGod's truth abideth still,\nHis kingdom is forever.",
    ],
  },
];

async function main() {
  const db = getDb();
  const [church] = await db.select().from(churches).limit(1);
  if (!church) { console.error("No church seeded yet. Run npm run db:seed first."); process.exit(1); }

  let added = 0;
  for (const h of HYMNS) {
    if (h.slides.length === 0) {
      console.log(`  · Skipping "${h.title}" — ${h.verified}`);
      continue;
    }
    // Idempotent + re-runnable: if the hymn already exists but our canonical
    // slide count has changed (we expanded a hymn's lyrics), replace its
    // slides in place. Preserves the song row + its id, so any playlist
    // items referencing it don't break.
    const [existing] = await db.select().from(songs).where(and(eq(songs.churchId, church.id), eq(songs.title, h.title), eq(songs.source, "public_domain"))).limit(1);
    if (existing) {
      const currentSlides = await db.select().from(songSlides).where(eq(songSlides.songId, existing.id));
      if (currentSlides.length === h.slides.length) {
        console.log(`  · Up-to-date: "${h.title}" (${currentSlides.length} slides)`);
        continue;
      }
      await db.delete(songSlides).where(eq(songSlides.songId, existing.id));
      await db.insert(songSlides).values(h.slides.map((lyrics, i) => ({ songId: existing.id, order: i, lyrics })));
      console.log(`  ↻ Refreshed "${h.title}" (${currentSlides.length} → ${h.slides.length} slides)`);
      continue;
    }

    const [song] = await db.insert(songs).values({ churchId: church.id, title: h.title, artist: h.author, source: "public_domain" }).returning();
    await db.insert(songSlides).values(h.slides.map((lyrics, i) => ({ songId: song.id, order: i, lyrics })));
    console.log(`  ✓ Added "${h.title}" (${h.slides.length} slides)`);
    added++;
  }
  console.log(`✓ Public domain hymns seed complete (${added} added)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
